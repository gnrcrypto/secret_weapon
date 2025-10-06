"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallet = exports.provider = exports.waitForTransaction = exports.startProviderMonitoring = exports.nonceManager = exports.getWalletBalance = exports.getWalletAddress = exports.getSigner = exports.initializeSigner = exports.getWebSocketProvider = exports.getProvider = exports.initializeProviders = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const winston_1 = __importDefault(require("winston"));
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
// Enhanced provider with health monitoring
class MonitoredProvider {
    url;
    name;
    isWebSocket;
    bearerToken;
    provider;
    health;
    healthCheckInterval = null;
    reconnectAttempts = 0;
    maxReconnectAttempts = 5;
    constructor(url, name, isWebSocket = false, bearerToken) {
        this.url = url;
        this.name = name;
        this.isWebSocket = isWebSocket;
        this.bearerToken = bearerToken;
        this.provider = this.createProvider();
        this.health = {
            isHealthy: false,
            latency: 0,
            blockNumber: 0,
            lastCheck: new Date(),
        };
        this.startHealthCheck();
    }
    createProvider() {
        const network = ethers_1.Network.from(config_1.Config.network.chainId);
        if (this.isWebSocket) {
            const wsProvider = new ethers_1.WebSocketProvider(this.url, network);
            // Setup WebSocket event handlers
            wsProvider.websocket.on('error', (error) => {
                logger.error(`WebSocket error for ${this.name}:`, error);
                this.handleProviderError();
            });
            wsProvider.websocket.on('close', () => {
                logger.warn(`WebSocket closed for ${this.name}, attempting reconnect...`);
                this.handleProviderError();
            });
            return wsProvider;
        }
        else {
            // HTTP provider with optional Bearer token
            if (this.bearerToken) {
                const fetchRequest = new ethers_1.FetchRequest(this.url);
                fetchRequest.setHeader('Authorization', `Bearer ${this.bearerToken}`);
                return new ethers_1.JsonRpcProvider(fetchRequest, network, {
                    staticNetwork: true,
                    batchMaxCount: 10,
                    polling: true,
                    pollingInterval: config_1.Config.network.blockPollingInterval,
                });
            }
            else {
                return new ethers_1.JsonRpcProvider(this.url, network, {
                    staticNetwork: true,
                    batchMaxCount: 10,
                    polling: true,
                    pollingInterval: config_1.Config.network.blockPollingInterval,
                });
            }
        }
    }
    async checkHealth() {
        try {
            const start = Date.now();
            const blockNumber = await this.provider.getBlockNumber();
            const latency = Date.now() - start;
            this.health = {
                isHealthy: true,
                latency,
                blockNumber,
                lastCheck: new Date(),
            };
            // Reset reconnect attempts on successful health check
            if (this.reconnectAttempts > 0) {
                logger.info(`Provider ${this.name} recovered after ${this.reconnectAttempts} attempts`);
                this.reconnectAttempts = 0;
            }
        }
        catch (error) {
            logger.error(`Health check failed for ${this.name}:`, error);
            this.health.isHealthy = false;
            this.handleProviderError();
        }
    }
    startHealthCheck() {
        // Initial health check
        this.checkHealth();
        // Schedule periodic health checks
        this.healthCheckInterval = setInterval(() => {
            this.checkHealth();
        }, 10000); // Check every 10 seconds
    }
    async handleProviderError() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`Max reconnection attempts reached for ${this.name}`);
            this.health.isHealthy = false;
            return;
        }
        this.reconnectAttempts++;
        const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        logger.info(`Reconnecting ${this.name} in ${backoff}ms (attempt ${this.reconnectAttempts})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        try {
            if (this.isWebSocket) {
                // For WebSocket, destroy and recreate
                await this.provider.destroy();
            }
            this.provider = this.createProvider();
            await this.checkHealth();
        }
        catch (error) {
            logger.error(`Reconnection failed for ${this.name}:`, error);
            this.handleProviderError();
        }
    }
    getProvider() {
        return this.provider;
    }
    getHealth() {
        return { ...this.health };
    }
    isHealthy() {
        return this.health.isHealthy &&
            this.health.latency < 5000 && // Less than 5 second latency
            (Date.now() - this.health.lastCheck.getTime()) < 30000; // Checked within last 30 seconds
    }
    async destroy() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        if (this.isWebSocket) {
            await this.provider.destroy();
        }
    }
}
// Fallback provider manager
class ProviderManager {
    providers = [];
    fallbackProvider = null;
    primaryProvider = null;
    constructor() {
        this.setupProviders();
    }
    setupProviders() {
        // Setup primary provider with Blockdaemon support
        const primaryUrl = this.constructProviderUrl(config_1.Config.network.rpcUrl);
        const blockdaemonKey = process.env.BLOCKDAEMON_API_KEY;
        this.primaryProvider = new MonitoredProvider(primaryUrl, blockdaemonKey ? 'Blockdaemon' : 'Primary', primaryUrl.startsWith('ws'), blockdaemonKey);
        this.providers.push(this.primaryProvider);
        if (blockdaemonKey) {
            logger.info('Primary provider configured with Blockdaemon authentication');
        }
        // Setup backup provider if available
        if (config_1.Config.network.rpcUrlBackup) {
            const backupUrl = this.constructProviderUrl(config_1.Config.network.rpcUrlBackup);
            const backupProvider = new MonitoredProvider(backupUrl, 'Backup', backupUrl.startsWith('ws'));
            this.providers.push(backupProvider);
        }
        // Setup providers from API keys
        if (config_1.Config.providers.alchemyKey) {
            const alchemyUrl = `https://polygon-mainnet.g.alchemy.com/v2/${config_1.Config.providers.alchemyKey}`;
            this.providers.push(new MonitoredProvider(alchemyUrl, 'Alchemy', false));
        }
        if (config_1.Config.providers.infuraKey) {
            const infuraUrl = `https://polygon-mainnet.infura.io/v3/${config_1.Config.providers.infuraKey}`;
            this.providers.push(new MonitoredProvider(infuraUrl, 'Infura', false));
        }
        if (config_1.Config.providers.quicknodeEndpoint) {
            this.providers.push(new MonitoredProvider(config_1.Config.providers.quicknodeEndpoint, 'QuickNode', config_1.Config.providers.quicknodeEndpoint.startsWith('ws')));
        }
        // Create fallback provider with healthy providers
        this.updateFallbackProvider();
    }
    constructProviderUrl(url) {
        // Add API keys if they're referenced in the URL
        return url
            .replace('{INFURA_KEY}', config_1.Config.providers.infuraKey || '')
            .replace('{ALCHEMY_KEY}', config_1.Config.providers.alchemyKey || '');
    }
    updateFallbackProvider() {
        const healthyProviders = this.providers
            .filter(p => p.isHealthy())
            .map(p => ({
            provider: p.getProvider(),
            weight: 1,
            priority: this.providers.indexOf(p) + 1,
            stallTimeout: 2000,
        }));
        if (healthyProviders.length === 0) {
            logger.error('No healthy providers available!');
            return;
        }
        this.fallbackProvider = new ethers_1.FallbackProvider(healthyProviders, config_1.Config.network.chainId);
        logger.info(`Fallback provider updated with ${healthyProviders.length} healthy providers`);
    }
    getProvider() {
        // Periodically update fallback provider
        this.updateFallbackProvider();
        // Prefer fallback provider if multiple are healthy
        if (this.fallbackProvider && this.providers.filter(p => p.isHealthy()).length > 1) {
            return this.fallbackProvider;
        }
        // Otherwise return the first healthy provider
        const healthyProvider = this.providers.find(p => p.isHealthy());
        if (healthyProvider) {
            return healthyProvider.getProvider();
        }
        // Last resort: return primary even if unhealthy
        logger.warn('No healthy providers, using primary provider');
        return this.primaryProvider.getProvider();
    }
    getWebSocketProvider() {
        const wsProvider = this.providers.find(p => p.isHealthy() && p.getProvider() instanceof ethers_1.WebSocketProvider);
        return wsProvider ? wsProvider.getProvider() : null;
    }
    async getHealthReport() {
        const report = {};
        for (const provider of this.providers) {
            const name = this.providers.indexOf(provider) === 0 ? 'primary' : `backup_${this.providers.indexOf(provider)}`;
            report[name] = provider.getHealth();
        }
        return report;
    }
    async destroy() {
        await Promise.all(this.providers.map(p => p.destroy()));
    }
    // ADD THESE MISSING METHODS:
    initialize() {
        // Already initialized in constructor
    }
    startMonitoring() {
        // Health monitoring is already running via MonitoredProvider instances
    }
    stopMonitoring() {
        // Stop all provider health checks
        this.providers.forEach(provider => {
            provider.destroy();
        });
    }
    async switchProvider() {
        // Try to find a healthy provider
        const healthyProvider = this.providers.find(p => p.isHealthy());
        if (healthyProvider) {
            logger.info('Switched to healthy provider');
            return true;
        }
        return false;
    }
}
// Singleton instance
let providerManager = null;
// Initialize provider manager
const initializeProviders = () => {
    if (!providerManager) {
        providerManager = new ProviderManager();
        logger.info('Provider manager initialized');
    }
};
exports.initializeProviders = initializeProviders;
// Get the current best provider
const getProvider = () => {
    if (!providerManager) {
        (0, exports.initializeProviders)();
    }
    return providerManager.getProvider();
};
exports.getProvider = getProvider;
// Get WebSocket provider for subscriptions
const getWebSocketProvider = () => {
    if (!providerManager) {
        (0, exports.initializeProviders)();
    }
    return providerManager.getWebSocketProvider();
};
exports.getWebSocketProvider = getWebSocketProvider;
// Wallet management
let signer = null;
// Initialize signer
const initializeSigner = () => {
    if (signer)
        return signer;
    const provider = (0, exports.getProvider)();
    if (config_1.Config.wallet.privateKey) {
        signer = new ethers_1.Wallet(config_1.Config.wallet.privateKey, provider);
        logger.info(`Wallet initialized from private key: ${signer.address}`);
    }
    else if (config_1.Config.wallet.mnemonic) {
        const hdWallet = ethers_1.Wallet.fromPhrase(config_1.Config.wallet.mnemonic, provider);
        signer = new ethers_1.Wallet(hdWallet.privateKey, provider);
        logger.info(`Wallet initialized from mnemonic: ${signer.address}`);
    }
    if (!signer) {
        throw new Error('No private key or mnemonic provided');
    }
    return signer;
};
exports.initializeSigner = initializeSigner;
// Get signer instance
const getSigner = () => {
    if (!signer) {
        return (0, exports.initializeSigner)();
    }
    return signer;
};
exports.getSigner = getSigner;
// Get wallet address
const getWalletAddress = () => {
    const wallet = (0, exports.getSigner)();
    return wallet.address;
};
exports.getWalletAddress = getWalletAddress;
// Get wallet balance
const getWalletBalance = async () => {
    const provider = (0, exports.getProvider)();
    const address = (0, exports.getWalletAddress)();
    return await provider.getBalance(address);
};
exports.getWalletBalance = getWalletBalance;
// Nonce management for high-frequency trading
class NonceManager {
    baseNonce = null;
    nonceOffset = 0;
    lastReset = Date.now();
    resetInterval = 60000; // Reset every minute
    pendingNonces = new Set();
    async getNonce() {
        const now = Date.now();
        // Reset nonce periodically or if too many pending
        if (!this.baseNonce ||
            now - this.lastReset > this.resetInterval ||
            this.pendingNonces.size > 50) {
            await this.resetNonce();
        }
        const nonce = this.baseNonce + this.nonceOffset;
        this.nonceOffset++;
        this.pendingNonces.add(nonce);
        return nonce;
    }
    async resetNonce() {
        const provider = (0, exports.getProvider)();
        const address = (0, exports.getWalletAddress)();
        this.baseNonce = await provider.getTransactionCount(address, 'pending');
        this.nonceOffset = 0;
        this.lastReset = Date.now();
        this.pendingNonces.clear();
        logger.debug(`Nonce reset to ${this.baseNonce}`);
    }
    releaseNonce(nonce) {
        this.pendingNonces.delete(nonce);
    }
    async confirmNonce(nonce) {
        this.pendingNonces.delete(nonce);
        // If this was the base nonce, increment for next use
        if (nonce === this.baseNonce) {
            this.baseNonce++;
            this.nonceOffset = Math.max(0, this.nonceOffset - 1);
        }
    }
    // ADD THIS MISSING METHOD:
    releaseAllNonces() {
        this.pendingNonces.clear();
        this.baseNonce = null;
        this.nonceOffset = 0;
    }
}
// Export nonce manager instance
exports.nonceManager = new NonceManager();
// Provider health monitoring
const startProviderMonitoring = () => {
    setInterval(async () => {
        if (!providerManager)
            return;
        const health = await providerManager.getHealthReport();
        const healthyCount = Object.values(health).filter(h => h.isHealthy).length;
        if (healthyCount === 0) {
            logger.error('CRITICAL: All providers are unhealthy!');
        }
        else if (healthyCount === 1) {
            logger.warn('WARNING: Only one healthy provider remaining');
        }
        // Log detailed health metrics
        logger.debug('Provider health report:', health);
    }, 30000); // Check every 30 seconds
};
exports.startProviderMonitoring = startProviderMonitoring;
// Utility function to wait for transaction with timeout
const waitForTransaction = async (txHash, confirmations = 1, timeoutMs = 60000) => {
    const provider = (0, exports.getProvider)();
    return Promise.race([
        provider.waitForTransaction(txHash, confirmations),
        new Promise((resolve) => setTimeout(() => {
            logger.warn(`Transaction ${txHash} timed out after ${timeoutMs}ms`);
            resolve(null);
        }, timeoutMs)),
    ]);
};
exports.waitForTransaction = waitForTransaction;
// Export provider utilities - FIXED INTERFACE
exports.provider = {
    get: exports.getProvider,
    getWebSocket: exports.getWebSocketProvider,
    initialize: exports.initializeProviders,
    startMonitoring: exports.startProviderMonitoring,
    stopMonitoring: () => {
        if (providerManager) {
            providerManager.stopMonitoring();
        }
    },
    switchProvider: async () => {
        if (providerManager) {
            return providerManager.switchProvider();
        }
        return false;
    }
};
// Export wallet utilities - FIXED INTERFACE
exports.wallet = {
    getSigner: exports.getSigner,
    getAddress: exports.getWalletAddress,
    getBalance: exports.getWalletBalance,
    initialize: exports.initializeSigner,
    // FIX: Use getter for address to make it dynamic
    get address() { return (0, exports.getWalletAddress)(); }
};
// Initialize on module load in production
if (config_1.Config.execution.mode === 'live') {
    (0, exports.initializeProviders)();
    (0, exports.initializeSigner)();
    (0, exports.startProviderMonitoring)();
}
//# sourceMappingURL=polygonProvider.js.map