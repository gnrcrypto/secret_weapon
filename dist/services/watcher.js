"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketWatcher = void 0;
exports.createWatcher = createWatcher;
const config_1 = require("../config");
const pathfinder_1 = require("../arb/pathfinder");
const simulator_1 = require("../arb/simulator");
const strategy_1 = require("../arb/strategy");
const executor_1 = require("../exec/executor");
const riskManager_1 = require("../risk/riskManager");
const polygonProvider_1 = require("../providers/polygonProvider");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
const events_1 = require("events");
const p_queue_1 = __importDefault(require("p-queue"));
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'market-watcher' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
class MarketWatcher extends events_1.EventEmitter {
    isRunning = false;
    startTime = Date.now();
    lastBlockProcessed = 0;
    totalOpportunitiesFound = 0;
    totalTradesExecuted = 0;
    totalProfitGenerated = 0;
    blockQueue;
    watchInterval = null;
    wsProvider = null;
    constructor(_dataSource) {
        super();
        // _dataSource is accepted for API compatibility but not required by this implementation.
        this.blockQueue = new p_queue_1.default({ concurrency: 1, timeout: 30000 });
        this.setupEventListeners();
    }
    setupEventListeners() {
        const riskManager = (0, riskManager_1.getRiskManager)();
        // RiskManager implements EventEmitter so .on is available
        if (riskManager && typeof riskManager.on === 'function') {
            riskManager.on('circuit-breaker-triggered', (reason) => {
                logger.error(`Circuit breaker triggered: ${reason}`);
                this.pause();
            });
            riskManager.on('daily-limit-reached', (limitType, current, limit) => {
                logger.warn(`Daily limit reached - ${limitType}: ${current}/${limit}`);
            });
        }
    }
    async start() {
        if (this.isRunning) {
            logger.warn('Watcher already running');
            return;
        }
        logger.info('Starting market watcher...');
        this.isRunning = true;
        this.startTime = Date.now();
        const pathfinder = (0, pathfinder_1.getPathfinder)();
        await pathfinder.initialize();
        const currentProvider = polygonProvider_1.provider.get();
        this.lastBlockProcessed = await currentProvider.getBlockNumber();
        if (config_1.Config.features.enableMevProtection) {
            await this.startWebSocketWatcher();
        }
        else {
            this.startPollingWatcher();
        }
        logger.info(`Market watcher started at block ${this.lastBlockProcessed}`);
        this.emit('status-update', this.getStatus());
    }
    async startWebSocketWatcher() {
        this.wsProvider = (0, polygonProvider_1.getWebSocketProvider)();
        if (!this.wsProvider) {
            logger.warn('WebSocket provider not available, falling back to polling');
            this.startPollingWatcher();
            return;
        }
        this.wsProvider.on('block', async (blockNumber) => {
            await this.processBlock(blockNumber);
        });
        if (config_1.Config.features.enableMevProtection) {
            this.wsProvider.on('pending', async (txHash) => {
                await this.analyzePendingTransaction(txHash);
            });
        }
        logger.info('WebSocket watcher initialized');
    }
    startPollingWatcher() {
        const intervalMs = config_1.Config.monitoring.opportunityScanInterval || 30000;
        this.watchInterval = setInterval(async () => {
            try {
                const currentProvider = polygonProvider_1.provider.get();
                const currentBlock = await currentProvider.getBlockNumber();
                while (this.lastBlockProcessed < currentBlock) {
                    this.lastBlockProcessed++;
                    await this.processBlock(this.lastBlockProcessed);
                }
            }
            catch (error) {
                logger.error('Error in polling watcher:', error);
                this.emit('error', error);
            }
        }, intervalMs);
        logger.info(`Polling watcher initialized (interval: ${intervalMs}ms)`);
    }
    async processBlock(blockNumber) {
        const startTime = Date.now();
        await this.blockQueue.add(async () => {
            try {
                logger.debug(`Processing block ${blockNumber}`);
                const opportunities = await this.findOpportunities();
                const results = await this.executeOpportunities(opportunities);
                this.lastBlockProcessed = blockNumber;
                this.totalOpportunitiesFound += opportunities.length;
                this.totalTradesExecuted += results.executed;
                this.totalProfitGenerated += results.totalProfit;
                this.emit('block-processed', blockNumber);
                if (opportunities.length > 0) {
                    logger.info(`Block ${blockNumber}: Found ${opportunities.length} opportunities, executed ${results.executed}`);
                }
                const processingTime = Date.now() - startTime;
                if (processingTime > 1000) {
                    logger.warn(`Slow block processing: ${processingTime}ms for block ${blockNumber}`);
                }
            }
            catch (error) {
                logger.error(`Error processing block ${blockNumber}:`, error);
                this.emit('error', error);
            }
        });
    }
    async findOpportunities() {
        try {
            const pathfinder = (0, pathfinder_1.getPathfinder)();
            const simulator = (0, simulator_1.getSimulator)();
            const strategy = (0, strategy_1.getStrategy)();
            const paths = await pathfinder.enumeratePaths();
            if (paths.length === 0) {
                return [];
            }
            logger.debug(`Found ${paths.length} potential paths`);
            const simulations = await Promise.all(paths.map(async (path) => {
                try {
                    const inputAmount = path.type === 'triangular'
                        ? (0, math_1.toWei)('1000', 18)
                        : (0, math_1.toWei)('5000', 18);
                    return await simulator.simulatePathOnChain(path, inputAmount);
                }
                catch (error) {
                    logger.debug(`Simulation failed for path ${path.id}:`, error);
                    return null;
                }
            }));
            // Filter out failed simulations
            const validSimulations = simulations.filter((s) => s !== null && s.isProfitable);
            if (validSimulations.length === 0) {
                return [];
            }
            const opportunities = await strategy.selectTopOpportunities(validSimulations);
            opportunities.forEach(opp => {
                logger.info(`Opportunity found: ${opp.simulation.path.id} - Profit: ${opp.simulation.netProfitUsd.toFixed(2)} - Risk: ${opp.riskLevel}`);
                this.emit('opportunity-found', opp);
            });
            return opportunities;
        }
        catch (error) {
            logger.error('Error finding opportunities:', error);
            return [];
        }
    }
    async executeOpportunities(opportunities) {
        if (opportunities.length === 0) {
            return { executed: 0, totalProfit: 0 };
        }
        const executor = (0, executor_1.getExecutor)();
        const riskManager = (0, riskManager_1.getRiskManager)();
        const strategy = (0, strategy_1.getStrategy)();
        let executed = 0;
        let totalProfit = 0;
        for (const opportunity of opportunities) {
            try {
                const riskCheck = await riskManager.checkRisk(opportunity);
                if (!riskCheck.allowed) {
                    logger.warn(`Risk check failed: ${riskCheck.reasons ? riskCheck.reasons.join(', ') : 'unknown'}`);
                    continue;
                }
                if (!strategy.shouldExecute(opportunity)) {
                    logger.warn('Strategy rejected execution');
                    continue;
                }
                strategy.registerTradeExecution(opportunity.simulation.path.id);
                logger.info(`Executing trade: ${opportunity.simulation.path.id}`);
                const result = await executor.executeAtomicSwap(opportunity);
                await riskManager.updatePostTrade(result, opportunity);
                strategy.unregisterTrade(opportunity.simulation.path.id);
                if (result.success) {
                    executed++;
                    const profitUsd = parseFloat((0, math_1.fromWei)(result.actualProfit || BigInt(0))) * 0.8;
                    totalProfit += profitUsd;
                    logger.info(`Trade executed successfully: ${result.transactionHash} - Profit: ${profitUsd.toFixed(2)}`);
                    this.emit('trade-executed', result);
                }
                else {
                    logger.error(`Trade failed: ${result.error}`);
                }
            }
            catch (error) {
                logger.error(`Error executing opportunity:`, error);
                try {
                    strategy.unregisterTrade(opportunity.simulation.path.id);
                }
                catch { }
            }
        }
        return { executed, totalProfit };
    }
    async analyzePendingTransaction(txHash) {
        if (!config_1.Config.features.enableSandwichProtection) {
            return;
        }
        try {
            const currentProvider = polygonProvider_1.provider.get();
            const tx = await currentProvider.getTransaction(txHash);
            if (!tx || !tx.data)
                return;
            const isSwap = tx.data.includes('0x38ed1739') ||
                tx.data.includes('0x8803dbee') ||
                tx.data.includes('0x7ff36ab5');
            if (isSwap && tx.value && tx.value > (0, math_1.toWei)('100', 18)) {
                logger.debug(`Large swap detected in mempool: ${txHash}`);
                // TODO: Implement sandwich protection strategy
            }
        }
        catch (error) {
            logger.debug(`Failed to analyze pending tx ${txHash}:`, error);
        }
    }
    async stop() {
        if (!this.isRunning) {
            logger.warn('Watcher not running');
            return;
        }
        logger.info('Stopping market watcher...');
        this.isRunning = false;
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
        }
        if (this.wsProvider) {
            this.wsProvider.removeAllListeners();
            if (typeof this.wsProvider.destroy === 'function') {
                await this.wsProvider.destroy();
            }
            this.wsProvider = null;
        }
        await this.blockQueue.onIdle();
        logger.info('Market watcher stopped');
        this.emit('status-update', this.getStatus());
    }
    pause() {
        if (!this.isRunning)
            return;
        logger.info('Pausing market watcher');
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
        }
        if (this.wsProvider) {
            this.wsProvider.removeAllListeners('block');
            this.wsProvider.removeAllListeners('pending');
        }
        this.blockQueue.pause();
    }
    resume() {
        if (!this.isRunning) {
            logger.warn('Watcher not running, cannot resume');
            return;
        }
        logger.info('Resuming market watcher');
        this.blockQueue.start();
        if (this.wsProvider) {
            // reattach listeners
            this.startWebSocketWatcher().catch(() => { });
        }
        else {
            this.startPollingWatcher();
        }
    }
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastBlockProcessed: this.lastBlockProcessed,
            opportunitiesFound: this.totalOpportunitiesFound,
            tradesExecuted: this.totalTradesExecuted,
            profitGenerated: this.totalProfitGenerated,
            uptime: this.isRunning ? Date.now() - this.startTime : 0,
            memoryUsage: process.memoryUsage(),
        };
    }
    getPerformanceMetrics() {
        const uptime = Date.now() - this.startTime;
        const avgOpportunitiesPerHour = (this.totalOpportunitiesFound / (uptime / 3600000));
        const avgTradesPerHour = (this.totalTradesExecuted / (uptime / 3600000));
        const successRate = this.totalOpportunitiesFound > 0
            ? (this.totalTradesExecuted / this.totalOpportunitiesFound * 100)
            : 0;
        return {
            uptime: `${(uptime / 3600000).toFixed(2)} hours`,
            totalOpportunities: this.totalOpportunitiesFound,
            totalTrades: this.totalTradesExecuted,
            totalProfit: `${this.totalProfitGenerated.toFixed(2)}`,
            avgOpportunitiesPerHour: avgOpportunitiesPerHour.toFixed(2),
            avgTradesPerHour: avgTradesPerHour.toFixed(2),
            successRate: `${successRate.toFixed(1)}%`,
            queueSize: this.blockQueue.size,
            memoryUsageMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
        };
    }
}
exports.MarketWatcher = MarketWatcher;
/**
 * Factory helper used by other modules that expect a createWatcher function.
 * Returns an object exposing start/stop (wrapping the MarketWatcher instance).
 */
function createWatcher(dataSource) {
    const watcher = new MarketWatcher(dataSource);
    return {
        start: () => watcher.start(),
        stop: () => watcher.stop(),
        on: (event, handler) => watcher.on(event, handler),
        pause: () => watcher.pause(),
        resume: () => watcher.resume(),
        getStatus: () => watcher.getStatus(),
        getPerformanceMetrics: () => watcher.getPerformanceMetrics(),
    };
}
//# sourceMappingURL=watcher.js.map