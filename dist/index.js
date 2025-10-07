"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainOrchestrator = void 0;
const config_1 = require("./config");
const typeorm_1 = require("typeorm");
const polygonProvider_1 = require("./providers/polygonProvider");
const watcher_1 = require("./services/watcher");
const health_1 = require("./api/health");
const metrics_1 = require("./monitoring/metrics");
const riskManager_1 = require("./risk/riskManager");
// import { Ledger } from './accounting/ledger';
const trade_entity_1 = require("./database/entities/trade.entity");
const wallet_entity_1 = require("./database/entities/wallet.entity");
const token_entity_1 = require("./database/entities/token.entity");
const dex_entity_1 = require("./database/entities/dex.entity");
const winston_1 = __importDefault(require("winston"));
const ethers_1 = require("ethers");
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    defaultMeta: { service: 'main-orchestrator' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ level, message, timestamp }) => {
                return `${timestamp} [${level}]: ${message}`;
            })),
        }),
        new winston_1.default.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10485760,
            maxFiles: 5,
        }),
        new winston_1.default.transports.File({
            filename: 'logs/combined.log',
            maxsize: 10485760,
            maxFiles: 10,
        }),
    ],
});
/**
 * Main Orchestrator
 * Coordinates all components of the arbitrage bot
 */
class MainOrchestrator {
    dataSource;
    marketWatcher = null;
    // private ledger: Ledger | null = null;
    healthAPI = null;
    isRunning = false;
    startTime = Date.now();
    constructor() {
        // Setup database connection
        const dbUrl = new URL(config_1.Config.database.accountingDbUrl);
        this.dataSource = new typeorm_1.DataSource({
            type: 'postgres',
            host: dbUrl.hostname,
            port: parseInt(dbUrl.port || '5432'),
            username: dbUrl.username,
            password: dbUrl.password,
            database: dbUrl.pathname.slice(1), // Remove leading '/'
            entities: [trade_entity_1.TradeEntity, wallet_entity_1.WalletEntity, token_entity_1.TokenEntity, dex_entity_1.DexEntity],
            synchronize: process.env.NODE_ENV !== 'production',
            logging: config_1.Config.monitoring.logLevel === 'debug',
            poolSize: config_1.Config.database.poolSize,
        });
    }
    /**
     * Initialize all components
     */
    async initialize() {
        logger.info('🚀 Initializing Polygon Arbitrage Bot...');
        try {
            // 1. Initialize database
            logger.info('📊 Connecting to database...');
            await this.dataSource.initialize();
            logger.info('✅ Database connected');
            // 2. Initialize ledger
            // this.ledger = new Ledger(this.dataSource);
            // logger.info('✅ Ledger initialized');
            // 3. Initialize providers
            logger.info('🌐 Initializing blockchain providers...');
            polygonProvider_1.provider.initialize();
            polygonProvider_1.provider.startMonitoring();
            logger.info('✅ Providers initialized');
            // 4. Verify wallet
            await this.verifyWallet();
            // 5. Check and deploy smart contract
            await this.checkSmartContract();
            // 6. Initialize services
            logger.info('🔧 Starting services...');
            // Start metrics service
            const metricsService = (0, metrics_1.getMetricsService)();
            metricsService.start();
            logger.info('✅ Metrics service started');
            // Start health API
            this.healthAPI = new health_1.HealthAPI();
            this.healthAPI.start();
            logger.info('✅ Health API started');
            // Initialize market watcher
            this.marketWatcher = new watcher_1.MarketWatcher(this.dataSource);
            logger.info('✅ Market watcher initialized');
            // Setup event listeners
            this.setupEventListeners();
            logger.info('✨ Initialization complete!');
            this.displayStatus();
        }
        catch (error) {
            logger.error('❌ Initialization failed:', error);
            throw error;
        }
    }
    /**
     * Verify wallet configuration
     */
    async verifyWallet() {
        if ((0, config_1.isSimulationMode)()) {
            logger.info('📝 Running in SIMULATION mode - no real trades');
            return;
        }
        logger.info('💰 Verifying wallet...');
        const address = polygonProvider_1.wallet.getAddress();
        const balance = await polygonProvider_1.wallet.getBalance();
        const balanceEther = ethers_1.ethers.formatEther(balance);
        logger.info(`📍 Wallet Address: ${address}`);
        logger.info(`💎 MATIC Balance: ${balanceEther}`);
        // Check minimum balance
        const minBalance = ethers_1.ethers.parseEther('5'); // 5 MATIC minimum
        if (balance < minBalance) {
            if (config_1.Config.execution.mode === 'live') {
                throw new Error(`Insufficient balance: ${balanceEther} MATIC (minimum: 5 MATIC)`);
            }
            else {
                logger.warn('⚠️  Low balance warning');
            }
        }
        logger.info('✅ Wallet verified');
    }
    /**
     * Check and deploy smart contract if needed
     */
    async checkSmartContract() {
        if ((0, config_1.isSimulationMode)()) {
            logger.info('📝 Simulation mode - skipping contract check');
            return;
        }
        logger.info('📜 Checking smart contract...');
        // For now, just log a message about contract deployment
        // The actual ContractManager would be implemented separately
        logger.info('💡 Smart contract check skipped (ContractManager not implemented)');
        if (config_1.Config.flashloan.enabled) {
            logger.warn('⚠️  Flash loans require a deployed smart contract');
            logger.info('💡 Deploy with: npx hardhat deploy --network polygon');
        }
    }
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (!this.marketWatcher)
            return;
        // Market watcher events
        this.marketWatcher.on('opportunity-found', async (opportunity) => {
            logger.info(`💡 Opportunity: ${opportunity.simulation.path.id} - Profit: $${opportunity.simulation.netProfitUsd.toFixed(2)}`);
            // Update metrics
            const metrics = (0, metrics_1.getMetricsService)();
            metrics.recordOpportunity(opportunity.simulation.path.type, opportunity.simulation.path.dexes[0]);
        });
        this.marketWatcher.on('trade-executed', async (result) => {
            if (result.success) {
                logger.info(`✅ Trade successful: ${result.transactionHash}`);
            }
            else {
                logger.error(`❌ Trade failed: ${result.error}`);
            }
            // Update metrics
            const metrics = (0, metrics_1.getMetricsService)();
            metrics.recordTrade('unknown', // Should be passed in result
            'unknown', result.success, result.actualProfit ? parseFloat(ethers_1.ethers.formatEther(result.actualProfit)) * 0.8 : 0, result.gasUsed || BigInt(0), Date.now() - result.timestamp);
        });
        this.marketWatcher.on('error', (error) => {
            logger.error('❌ Watcher error:', error);
            const metrics = (0, metrics_1.getMetricsService)();
            metrics.recordError('watcher', 'high');
        });
        // Risk manager events
        const riskManager = (0, riskManager_1.getRiskManager)();
        riskManager.on('circuit-breaker-triggered', (reason) => {
            logger.error(`🚨 CIRCUIT BREAKER: ${reason}`);
            // Update metrics
            const metrics = (0, metrics_1.getMetricsService)();
            metrics.updateCircuitBreaker(true);
            metrics.recordError('circuit_breaker', 'critical');
            // Pause watcher
            if (this.marketWatcher) {
                this.marketWatcher.pause();
            }
        });
        riskManager.on('daily-limit-reached', (limitType, current, limit) => {
            logger.warn(`⚠️  Daily limit: ${limitType} - ${current}/${limit}`);
            const metrics = (0, metrics_1.getMetricsService)();
            metrics.recordError('daily_limit', 'medium');
        });
    }
    /**
     * Start the orchestrator
     */
    async start() {
        if (this.isRunning) {
            logger.warn('Bot already running');
            return;
        }
        try {
            await this.initialize();
            logger.info('🏁 Starting arbitrage bot...');
            // Start market watching
            if (this.marketWatcher) {
                await this.marketWatcher.start();
            }
            this.isRunning = true;
            this.startTime = Date.now();
            logger.info('');
            logger.info('='.repeat(60));
            logger.info('🤖 POLYGON ARBITRAGE BOT IS RUNNING');
            logger.info('='.repeat(60));
            logger.info(`Mode: ${config_1.Config.execution.mode.toUpperCase()}`);
            logger.info(`Time: ${new Date().toISOString()}`);
            logger.info('='.repeat(60));
            logger.info('');
            // Start periodic status updates
            this.startStatusUpdates();
        }
        catch (error) {
            logger.error('Failed to start bot:', error);
            await this.shutdown();
            throw error;
        }
    }
    /**
     * Display current status
     */
    displayStatus() {
        const riskManager = (0, riskManager_1.getRiskManager)();
        const riskMetrics = riskManager.getMetrics();
        logger.info('');
        logger.info('📈 Current Status:');
        logger.info('─'.repeat(40));
        logger.info(`Mode: ${config_1.Config.execution.mode}`);
        logger.info(`Circuit Breaker: ${riskMetrics.circuitBreakerActive ? '🔴 ACTIVE' : '🟢 OK'}`);
        logger.info(`Daily P&L: $${(riskMetrics.dailyProfit - riskMetrics.dailyLoss).toFixed(2)}`);
        logger.info(`Daily Trades: ${riskMetrics.dailyTrades}`);
        logger.info(`Enabled DEXes: ${config_1.Config.dex.enabledDexes.join(', ')}`);
        logger.info('─'.repeat(40));
        logger.info('');
    }
    /**
     * Start periodic status updates
     */
    startStatusUpdates() {
        setInterval(() => {
            if (!this.isRunning)
                return;
            const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60);
            if (this.marketWatcher) {
                const status = this.marketWatcher.getStatus();
                const performance = this.marketWatcher.getPerformanceMetrics();
                logger.info('');
                logger.info(`📊 Status Update (${uptime} min uptime)`);
                logger.info(`Opportunities: ${status.opportunitiesFound} | Trades: ${status.tradesExecuted} | Profit: ${status.profitGenerated.toFixed(2)}`);
                if (performance.memoryUsageMB && performance.queueSize !== undefined) {
                    logger.info(`Memory: ${performance.memoryUsageMB} MB | Queue: ${performance.queueSize}`);
                }
            }
        }, 60000); // Every minute
    }
    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('📛 Shutting down...');
        this.isRunning = false;
        // Stop market watcher
        if (this.marketWatcher) {
            await this.marketWatcher.stop();
        }
        // Close database
        if (this.dataSource.isInitialized) {
            await this.dataSource.destroy();
        }
        // Cleanup risk manager
        const riskManager = (0, riskManager_1.getRiskManager)();
        riskManager.destroy();
        logger.info('👋 Shutdown complete');
    }
}
exports.MainOrchestrator = MainOrchestrator;
// Signal handlers
const orchestrator = new MainOrchestrator();
process.on('SIGINT', async () => {
    logger.info('Received SIGINT');
    await orchestrator.shutdown();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM');
    await orchestrator.shutdown();
    process.exit(0);
});
process.on('uncaughtException', async (error) => {
    logger.error('Uncaught Exception:', error);
    await orchestrator.shutdown();
    process.exit(1);
});
process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await orchestrator.shutdown();
    process.exit(1);
});
// Start the bot
if (require.main === module) {
    orchestrator.start().catch((error) => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}
exports.default = orchestrator;
//# sourceMappingURL=index.js.map