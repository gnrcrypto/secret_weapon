"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.app = void 0;
// src/index.ts
const config_1 = require("./config");
const polygonProvider_1 = require("./providers/polygonProvider");
const winston_1 = __importDefault(require("winston"));
const ethers_1 = require("ethers");
const watcher_1 = require("./services/watcher");
const typeorm_1 = require("typeorm");
const trade_entity_1 = require("./database/entities/trade.entity");
const wallet_entity_1 = require("./database/entities/wallet.entity");
const token_entity_1 = require("./database/entities/token.entity");
const dex_entity_1 = require("./database/entities/dex.entity");
// ---------------- Logger Setup ----------------
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    defaultMeta: { service: 'polygon-arbitrage-bot' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple()),
        }),
        new winston_1.default.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        }),
        new winston_1.default.transports.File({
            filename: 'logs/combined.log',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 10,
        }),
    ],
});
exports.logger = logger;
// ---------------- Helpers ----------------
function logConfig() {
    logger.info('Configuration:', {
        mode: config_1.Config.execution.mode,
        network: config_1.Config.network.chainId,
        dexes: config_1.Config.dex.enabledDexes,
        minProfit: config_1.Config.execution.minProfitThresholdUsd,
    });
}
function isSimulationMode() {
    return config_1.Config.execution.mode === 'simulate';
}
// Helper to safely unwrap the provider
function unwrapProvider(p) {
    if (p && typeof p.get === 'function')
        return p.get();
    return p;
}
// ---------------- Graceful Shutdown ----------------
class ShutdownManager {
    shutdownCallbacks = [];
    isShuttingDown = false;
    register(callback) {
        this.shutdownCallbacks.push(callback);
    }
    async shutdown(signal) {
        if (this.isShuttingDown) {
            logger.warn('Shutdown already in progress');
            return;
        }
        this.isShuttingDown = true;
        logger.info(`Received ${signal}, initiating graceful shutdown...`);
        const shutdownTimeout = setTimeout(() => {
            logger.error('Shutdown timeout exceeded, forcing exit');
            process.exit(1);
        }, 30000);
        try {
            await Promise.all(this.shutdownCallbacks.map(callback => callback().catch(err => logger.error('Shutdown callback error:', err))));
            clearTimeout(shutdownTimeout);
            logger.info('Graceful shutdown completed');
            process.exit(0);
        }
        catch (error) {
            logger.error('Error during shutdown:', error);
            clearTimeout(shutdownTimeout);
            process.exit(1);
        }
    }
}
const shutdownManager = new ShutdownManager();
// ---------------- Main App ----------------
class ArbitrageBotApplication {
    isRunning = false;
    startTime = Date.now();
    watcher;
    dataSource = null;
    async initialize() {
        logger.info('='.repeat(50));
        logger.info('Polygon Arbitrage Bot Starting...');
        logger.info('='.repeat(50));
        logConfig();
        logger.info('Initializing providers...');
        if (typeof polygonProvider_1.provider.initialize === 'function')
            polygonProvider_1.provider.initialize();
        if (typeof polygonProvider_1.provider.startMonitoring === 'function')
            polygonProvider_1.provider.startMonitoring();
        if (!isSimulationMode()) {
            logger.info('Initializing wallet...');
            if (typeof polygonProvider_1.wallet.initialize === 'function')
                polygonProvider_1.wallet.initialize();
            const address = typeof polygonProvider_1.wallet.getAddress === 'function' ? await polygonProvider_1.wallet.getAddress() : polygonProvider_1.wallet.address;
            const balance = await polygonProvider_1.wallet.getBalance();
            logger.info(`Wallet Address: ${address}`);
            logger.info(`Wallet Balance: ${ethers_1.ethers.formatEther(balance)} MATIC`);
            const minBalance = ethers_1.ethers.parseEther('0.1');
            if (balance < minBalance) {
                logger.warn(`Low balance warning: ${ethers_1.ethers.formatEther(balance)} MATIC`);
                if (config_1.Config.execution.mode === 'live') {
                    throw new Error('Insufficient balance for live trading');
                }
            }
        }
        else {
            logger.info('Running in SIMULATION mode - no real transactions will be executed');
        }
        // Verify network
        try {
            const currentProvider = unwrapProvider(polygonProvider_1.provider);
            const network = await currentProvider.getNetwork();
            if (network.chainId !== BigInt(config_1.Config.network.chainId)) {
                throw new Error(`Wrong network: expected ${config_1.Config.network.chainId}, got ${network.chainId}`);
            }
            logger.info(`Connected to Polygon network (chainId: ${network.chainId})`);
        }
        catch (error) {
            logger.error('Failed to verify network connection:', error);
            if (config_1.Config.execution.mode === 'live')
                throw new Error('Network connection failed');
            logger.warn('Continuing in simulation mode despite network issues');
        }
        // Initialize TypeORM DB
        await this.initializeDatabase();
        // Initialize services (Ledger, Watcher, etc.)
        await this.initializeServices();
        // Register graceful shutdown
        this.registerShutdownHandlers();
        logger.info('Initialization complete ✅');
    }
    // ---------------- Real Database Connection ----------------
    async initializeDatabase() {
        logger.info('Initializing database connections...');
        this.dataSource = new typeorm_1.DataSource({
            type: 'sqlite',
            database: 'arbitrage.db',
            synchronize: true,
            logging: false,
            entities: [trade_entity_1.TradeEntity, wallet_entity_1.WalletEntity, token_entity_1.TokenEntity, dex_entity_1.DexEntity],
        });
        await this.dataSource.initialize();
        logger.info('Database connected successfully ✅');
    }
    // ---------------- Service Initialization ----------------
    async initializeServices() {
        logger.info('Initializing services...');
        if (this.dataSource) {
            this.watcher = (0, watcher_1.createWatcher)(this.dataSource);
            logger.info('Watcher service initialized with database');
        }
        else {
            logger.warn('No data source available, watcher not initialized');
        }
        logger.info('All services initialized');
    }
    registerShutdownHandlers() {
        shutdownManager.register(async () => {
            logger.info('Shutting down providers...');
            if (typeof polygonProvider_1.provider.stopMonitoring === 'function')
                polygonProvider_1.provider.stopMonitoring();
        });
        shutdownManager.register(async () => {
            logger.info('Shutting down services...');
            if (this.watcher && typeof this.watcher.stop === 'function')
                this.watcher.stop();
            if (this.dataSource && typeof this.dataSource.destroy === 'function')
                await this.dataSource.destroy();
        });
        shutdownManager.register(async () => {
            logger.info('Finalizing pending transactions...');
            if (polygonProvider_1.nonceManager && typeof polygonProvider_1.nonceManager.releaseAllNonces === 'function') {
                polygonProvider_1.nonceManager.releaseAllNonces();
            }
        });
    }
    // ---------------- Runtime ----------------
    async start() {
        if (this.isRunning) {
            logger.warn('Bot is already running');
            return;
        }
        try {
            await this.initialize();
            this.isRunning = true;
            logger.info('='.repeat(50));
            logger.info('Bot is now running!');
            logger.info(`Mode: ${config_1.Config.execution.mode.toUpperCase()}`);
            logger.info(`Start time: ${new Date().toISOString()}`);
            logger.info('='.repeat(50));
            await this.startServices();
            await this.runMainLoop();
        }
        catch (error) {
            logger.error('Failed to start bot:', error);
            throw error;
        }
    }
    async startServices() {
        if (this.watcher && typeof this.watcher.start === 'function') {
            this.watcher.start();
            logger.info('Watcher service started');
        }
    }
    async runMainLoop() {
        logger.info('Main arbitrage loop started');
        while (this.isRunning) {
            try {
                await this.checkSystemHealth();
                if ((Date.now() - this.startTime) % 30000 < 1000) {
                    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
                    logger.info(`Heartbeat - Uptime: ${uptime}s, Mode: ${config_1.Config.execution.mode}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                logger.error('Error in main loop:', error);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    async checkSystemHealth() {
        try {
            const currentProvider = unwrapProvider(polygonProvider_1.provider);
            await currentProvider.getBlockNumber();
        }
        catch (error) {
            logger.warn('Provider health check failed:', error);
            if (typeof polygonProvider_1.provider.switchProvider === 'function') {
                const switched = await polygonProvider_1.provider.switchProvider();
                if (switched)
                    logger.info('Successfully switched to backup provider');
            }
        }
        if (!isSimulationMode() && polygonProvider_1.wallet.getBalance) {
            try {
                const balance = await polygonProvider_1.wallet.getBalance();
                const balanceEth = parseFloat(ethers_1.ethers.formatEther(balance));
                if (balanceEth < 0.1) {
                    logger.error(`CRITICAL: Very low balance: ${balanceEth} MATIC`);
                }
            }
            catch (error) {
                logger.warn('Failed to check wallet balance:', error);
            }
        }
    }
    async stop() {
        logger.info('Stopping bot...');
        this.isRunning = false;
        if (this.watcher && typeof this.watcher.stop === 'function')
            this.watcher.stop();
    }
    getStatus() {
        return {
            isRunning: this.isRunning,
            uptime: Date.now() - this.startTime,
            mode: config_1.Config.execution.mode,
            startTime: new Date(this.startTime).toISOString(),
            walletAddress: polygonProvider_1.wallet.getAddress ? polygonProvider_1.wallet.getAddress() : polygonProvider_1.wallet.address,
        };
    }
}
// ---------------- Startup ----------------
const app = new ArbitrageBotApplication();
exports.app = app;
process.on('SIGINT', () => shutdownManager.shutdown('SIGINT'));
process.on('SIGTERM', () => shutdownManager.shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdownManager.shutdown('SIGHUP'));
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    shutdownManager.shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    shutdownManager.shutdown('unhandledRejection');
});
if (require.main === module) {
    app.start().catch((error) => {
        logger.error('Fatal error during startup:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map