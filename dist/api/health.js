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
exports.HealthAPI = void 0;
const express_1 = __importDefault(require("express"));
const config_1 = require("../config");
const executor_1 = require("../exec/executor");
const riskManager_1 = require("../risk/riskManager");
const strategy_1 = require("../arb/strategy");
const polygonProvider_1 = require("../providers/polygonProvider");
const winston_1 = __importDefault(require("winston"));
const ethers_1 = require("ethers");
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'health-api' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
class HealthAPI {
    app;
    isPaused = false;
    startTime = Date.now();
    constructor() {
        this.app = (0, express_1.default)();
        this.setupMiddleware();
        this.setupRoutes();
    }
    setupMiddleware() {
        this.app.use(express_1.default.json());
        // API key authentication
        this.app.use((req, res, next) => {
            const headerName = config_1.Config.security.apiKeyHeader?.toLowerCase() || 'x-api-key';
            const apiKey = req.headers[headerName];
            // Skip auth for GET /health
            if (req.path === '/health') {
                return next();
            }
            if (!apiKey || apiKey !== config_1.Config.security.apiKey) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        });
    }
    setupRoutes() {
        /**
         * Health check endpoint
         */
        this.app.get('/health', async (_req, res) => {
            try {
                const health = await this.getHealthStatus();
                const statusCode = health.isHealthy ? 200 : 503;
                res.status(statusCode).json(health);
            }
            catch (error) {
                res.status(503).json({
                    isHealthy: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        });
        /**
         * Detailed metrics endpoint
         */
        this.app.get('/metrics', async (_req, res) => {
            try {
                const metrics = await this.getDetailedMetrics();
                res.json(metrics);
            }
            catch (error) {
                res.status(500).json({ error: 'Failed to get metrics' });
            }
        });
        /**
         * Pause trading
         */
        this.app.post('/pause', (_req, res) => {
            this.isPaused = true;
            const riskManager = (0, riskManager_1.getRiskManager)();
            if (typeof riskManager.emergencyStop === 'function') {
                try {
                    riskManager.emergencyStop();
                }
                catch (e) { /* swallow */ }
            }
            logger.warn('Trading paused via API');
            res.json({ status: 'paused', message: 'Trading has been paused' });
        });
        /**
         * Resume trading
         */
        this.app.post('/resume', (_req, res) => {
            this.isPaused = false;
            logger.info('Trading resumed via API');
            res.json({ status: 'active', message: 'Trading has been resumed' });
        });
        /**
         * Simulate trade
         */
        this.app.post('/simulate', async (req, res) => {
            try {
                const { path, amount } = req.body;
                if (!path || !amount) {
                    return res.status(400).json({ error: 'Missing path or amount' });
                }
                // Import simulator dynamically to avoid circular dependencies
                const { getSimulator } = await Promise.resolve().then(() => __importStar(require('../arb/simulator')));
                const simulator = getSimulator();
                const result = await simulator.simulatePathOnChain(path, BigInt(amount));
                res.json({
                    isProfitable: result.isProfitable,
                    netProfitUsd: result.netProfitUsd,
                    priceImpact: result.priceImpact,
                    confidence: result.confidence,
                });
            }
            catch (error) {
                res.status(500).json({ error: 'Simulation failed' });
            }
        });
        /**
         * Get configuration
         */
        this.app.get('/config', (_req, res) => {
            // Return sanitized config
            const sanitized = {
                mode: config_1.Config.execution.mode,
                minProfit: config_1.Config.execution.minProfitThresholdUsd,
                maxTrade: config_1.Config.execution.maxTradeSizeUsd,
                slippage: config_1.Config.execution.slippageBps / 100,
                enabledDexes: config_1.Config.dex.enabledDexes,
                features: config_1.Config.features,
                risk: {
                    dailyLossLimit: config_1.Config.risk.dailyLossLimitUsd,
                    maxConsecutiveFailures: config_1.Config.risk.maxConsecutiveFailures,
                },
                addresses: config_1.ADDRESSES,
            };
            res.json(sanitized);
        });
        /**
         * Get wallet info
         */
        this.app.get('/wallet', async (_req, res) => {
            try {
                // wallet may be a utility object with methods or a simple object
                const address = typeof polygonProvider_1.wallet.getAddress === 'function'
                    ? await polygonProvider_1.wallet.getAddress()
                    : polygonProvider_1.wallet.address;
                const balance = typeof polygonProvider_1.wallet.getBalance === 'function'
                    ? await polygonProvider_1.wallet.getBalance()
                    : BigInt(0);
                res.json({
                    address,
                    balanceMatic: ethers_1.ethers.formatEther(balance),
                    network: config_1.Config.network.chainId,
                });
            }
            catch (error) {
                res.status(500).json({ error: 'Failed to get wallet info' });
            }
        });
        /**
         * Get risk status
         */
        this.app.get('/risk', (_req, res) => {
            const riskManager = (0, riskManager_1.getRiskManager)();
            if (typeof riskManager.getRiskReport === 'function') {
                return res.json(riskManager.getRiskReport());
            }
            // Fallback
            if (typeof riskManager.getMetrics === 'function') {
                return res.json(riskManager.getMetrics());
            }
            res.status(500).json({ error: 'Risk manager not available' });
        });
        /**
         * Get execution status
         */
        this.app.get('/execution', (_req, res) => {
            try {
                const executor = (0, executor_1.getExecutor)();
                const status = executor.getStatus();
                res.json(status);
            }
            catch (error) {
                res.status(500).json({ error: 'Executor not available' });
            }
        });
        /**
         * Get strategy metrics
         */
        this.app.get('/strategy', (_req, res) => {
            try {
                const strategy = (0, strategy_1.getStrategy)();
                const metrics = strategy.getMetrics();
                res.json(metrics);
            }
            catch (error) {
                res.status(500).json({ error: 'Strategy not available' });
            }
        });
        /**
         * Emergency stop
         */
        this.app.post('/emergency-stop', (_req, res) => {
            this.emergencyStop();
            res.json({ status: 'stopped', message: 'Emergency stop activated' });
        });
        /**
         * Get system logs
         */
        this.app.get('/logs', (req, res) => {
            const limit = parseInt(req.query.limit || '100', 10) || 100;
            const level = req.query.level || 'info';
            // This would typically read from a log file or database
            res.json({
                message: 'Log endpoint not fully implemented',
                limit,
                level,
            });
        });
    }
    /**
     * Get health status
     */
    async getHealthStatus() {
        const currentProvider = polygonProvider_1.provider.get();
        // Check provider connection
        let providerHealthy = false;
        let blockNumber = 0;
        try {
            blockNumber = await currentProvider.getBlockNumber();
            providerHealthy = blockNumber > 0;
        }
        catch (error) {
            logger.error('Provider health check failed:', error);
        }
        // Check risk manager
        const riskManager = (0, riskManager_1.getRiskManager)();
        const riskMetrics = typeof riskManager.getMetrics === 'function'
            ? riskManager.getMetrics()
            : {};
        // Check executor
        let execStatus = {};
        try {
            const executor = (0, executor_1.getExecutor)();
            execStatus = executor.getStatus();
        }
        catch {
            execStatus = {};
        }
        // Overall health
        const isHealthy = providerHealthy &&
            !(riskMetrics && riskMetrics.circuitBreakerActive) &&
            !this.isPaused;
        return {
            isHealthy,
            status: this.isPaused ? 'paused' : (isHealthy ? 'healthy' : 'unhealthy'),
            uptime: Date.now() - this.startTime,
            components: {
                provider: {
                    healthy: providerHealthy,
                    blockNumber,
                },
                riskManager: {
                    circuitBreaker: riskMetrics.circuitBreakerActive || false,
                    dailyLoss: riskMetrics.dailyLoss || 0,
                    consecutiveFailures: riskMetrics.consecutiveFailures || 0,
                },
                executor: {
                    ...execStatus,
                },
            },
            timestamp: new Date().toISOString(),
        };
    }
    /**
     * Get detailed metrics
     */
    async getDetailedMetrics() {
        const riskManager = (0, riskManager_1.getRiskManager)();
        let riskReport = {};
        try {
            riskReport = typeof riskManager.getRiskReport === 'function'
                ? riskManager.getRiskReport()
                : (typeof riskManager.getMetrics === 'function' ? riskManager.getMetrics() : {});
        }
        catch {
            riskReport = {};
        }
        let execStatus = {};
        try {
            const executor = (0, executor_1.getExecutor)();
            execStatus = executor.getStatus();
        }
        catch {
            execStatus = {};
        }
        let strategyMetrics = {};
        try {
            const strategy = (0, strategy_1.getStrategy)();
            strategyMetrics = strategy.getMetrics();
        }
        catch {
            strategyMetrics = {};
        }
        return {
            risk: riskReport,
            execution: execStatus,
            strategy: strategyMetrics,
            system: {
                uptime: Date.now() - this.startTime,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
            },
        };
    }
    /**
     * Emergency stop
     */
    emergencyStop() {
        logger.error('EMERGENCY STOP ACTIVATED');
        // Pause all operations
        this.isPaused = true;
        // Trigger risk manager circuit breaker
        const riskManager = (0, riskManager_1.getRiskManager)();
        if (typeof riskManager.emergencyStop === 'function') {
            try {
                riskManager.emergencyStop();
            }
            catch (e) { /* swallow */ }
        }
        // Cancel pending transactions
        try {
            const executor = (0, executor_1.getExecutor)();
            const pending = executor.getPendingTransactions();
            logger.info(`Cancelling ${pending.length} pending transactions`);
        }
        catch (e) {
            logger.warn('Executor not available to cancel pending transactions');
        }
    }
    /**
     * Start the API server
     */
    start(port) {
        const apiPort = port || config_1.Config.monitoring.healthCheckPort;
        this.app.listen(apiPort, () => {
            logger.info(`Health API started on port ${apiPort}`);
            logger.info(`Health check: http://localhost:${apiPort}/health`);
        });
    }
}
exports.HealthAPI = HealthAPI;
//# sourceMappingURL=health.js.map