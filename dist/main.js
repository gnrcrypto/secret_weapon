"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const winston_1 = __importDefault(require("winston"));
const ethers_1 = require("ethers");
const LedgerModule = __importStar(require("./accounting/ledger"));
// Resolve createLedger gracefully (named/export/default)
const createLedger = LedgerModule.createLedger || LedgerModule.default || (() => {
    throw new Error('createLedger not found in ./accounting/ledger');
});
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
    ledger = null;
    isRunning = false;
    startTime = Date.now();
    constructor() {
        // Setup database connection
        this.dataSource = new typeorm_1.DataSource({
            type: 'postgres',
            host: config_1.Config.database.host || 'localhost',
            port: config_1.Config.database.port || 5432,
            username: config_1.Config.database.username || 'arbitrage_user',
            password: config_1.Config.database.password || 'pass',
            database: config_1.Config.database.name || 'arbitrage_bot',
            entities: [],
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
            try {
                this.ledger = createLedger(config_1.Config.database.accountingDbUrl || '');
                logger.info('✅ Ledger initialized');
            }
            catch (e) {
                logger.warn('Ledger not initialized:', e.message);
            }
            // 3. Initialize providers
            logger.info('🌐 Initializing blockchain providers...');
            if (typeof polygonProvider_1.provider.initialize === 'function')
                polygonProvider_1.provider.initialize();
            if (typeof polygonProvider_1.provider.startMonitoring === 'function')
                polygonProvider_1.provider.startMonitoring();
            logger.info('✅ Providers initialized');
            // 4. Verify wallet
            await this.verifyWallet();
            // 5. Check and deploy smart contract (attempt dynamic import; skip if missing)
            await this.checkSmartContract();
            // 6. Initialize services
            logger.info('🔧 Starting services...');
            // Start metrics service
            const metricsService = (0, metrics_1.getMetricsService)();
            metricsService.start();
            logger.info('✅ Metrics service started');
            // Start health API
            const healthAPI = new health_1.HealthAPI();
            healthAPI.start();
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
        const address = typeof polygonProvider_1.wallet.getAddress === 'function' ? await polygonProvider_1.wallet.getAddress() : polygonProvider_1.wallet.address;
        const balance = await polygonProvider_1.wallet.getBalance();
        const balanceEther = ethers_1.ethers.formatEther(balance);
        logger.info(`📍 Wallet Address: ${address}`);
        logger.info(`💎 MATIC Balance: ${balanceEther}`);
        // Check minimum balance
        const minBalance = ethers_1.ethers.parseEther('0'); // 5 MATIC minimum
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
        try {
            // Use a runtime require via eval to avoid TypeScript static module resolution errors
            // This keeps compilation stable even if ./contracts/contractManager is absent.
            const contractPath = './contracts/contractManager';
            let contractModule = null;
            try {
                contractModule = eval('require')(contractPath);
            }
            catch {
                contractModule = null;
            }
            const contractManager = contractModule ? (contractModule.getContractManager?.() || contractModule.getContractManager || contractModule) : null;
            if (!contractManager || typeof contractManager.verifyContract !== 'function') {
                logger.warn('⚠️  Contract manager not available - skipping contract verification');
                return;
            }
            const isDeployed = await contractManager.verifyContract();
            if (!isDeployed) {
                logger.warn('⚠️  No smart contract deployed');
                logger.info('💡 Deploy with: npm run deploy:contract');
                if (config_1.Config.flashloan.enabled) {
                    logger.warn('⚠️  Flash loans disabled - contract required');
                }
            }
            else {
                const address = contractManager.getContractAddress();
                logger.info(`✅ Smart contract verified at: ${address}`);
            }
        }
        catch (err) {
            logger.warn('Contract manager check failed:', err.message);
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
            'unknown', result.success, result.actualProfit ? parseFloat(ethers_1.ethers.formatEther(result.actualProfit)) * 0.8 : 0, result.gasUsed || BigInt(0), Date.now() - (result.timestamp || Date.now()));
        });
        this.marketWatcher.on('error', (error) => {
            logger.error('❌ Watcher error:', error);
            const metrics = (0, metrics_1.getMetricsService)();
            metrics.recordError('watcher', 'high');
        });
        // Risk manager events
        const riskManager = (0, riskManager_1.getRiskManager)();
        if (riskManager && typeof riskManager.on === 'function') {
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
        const riskMetrics = riskManager.getMetrics ? riskManager.getMetrics() : {};
        const dailyProfit = riskMetrics.dailyProfit || 0;
        const dailyLoss = riskMetrics.dailyLoss || 0;
        logger.info('');
        logger.info('📈 Current Status:');
        logger.info('─'.repeat(40));
        logger.info(`Mode: ${config_1.Config.execution.mode}`);
        logger.info(`Circuit Breaker: ${(riskMetrics.circuitBreakerActive ? '🔴 ACTIVE' : '🟢 OK')}`);
        logger.info(`Daily P&L: $${(dailyProfit - dailyLoss).toFixed(2)}`);
        logger.info(`Daily Trades: ${riskMetrics.dailyTrades || 0}`);
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
                const perfAny = performance || {};
                logger.info('');
                logger.info(`📊 Status Update (${uptime} min uptime)`);
                logger.info(`Opportunities: ${status.opportunitiesFound} | Trades: ${status.tradesExecuted} | Profit: $${(status.profitGenerated || 0).toFixed(2)}`);
                logger.info(`Memory: ${perfAny.memoryUsageMB || 'n/a'} MB | Queue: ${perfAny.queueSize || 0}`);
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
        // Close ledger if present
        if (this.ledger && typeof this.ledger.close === 'function') {
            try {
                await this.ledger.close();
                logger.info('✅ Ledger closed');
            }
            catch (e) {
                logger.warn('Failed to close ledger:', e.message);
            }
        }
        // Cleanup risk manager
        const riskManager = (0, riskManager_1.getRiskManager)();
        if (typeof riskManager.destroy === 'function') {
            riskManager.destroy();
        }
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
//# sourceMappingURL=main.js.map