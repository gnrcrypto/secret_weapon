import { ethers, Wallet, JsonRpcProvider, WebSocketProvider, FallbackProvider, Network } from 'ethers';
import { Config } from '../config';
import winston from 'winston';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Provider health check interface
interface ProviderHealth {
  isHealthy: boolean;
  latency: number;
  blockNumber: number;
  lastCheck: Date;
}

// Enhanced provider with health monitoring
class MonitoredProvider {
  private provider: JsonRpcProvider | WebSocketProvider;
  private health: ProviderHealth;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  constructor(
    private url: string,
    private name: string,
    private isWebSocket: boolean = false
  ) {
    this.provider = this.createProvider();
    this.health = {
      isHealthy: false,
      latency: 0,
      blockNumber: 0,
      lastCheck: new Date(),
    };
    this.startHealthCheck();
  }
  
  private createProvider(): JsonRpcProvider | WebSocketProvider {
    const network = Network.from(Config.network.chainId);
    
    if (this.isWebSocket) {
      const wsProvider = new WebSocketProvider(this.url, network);
      
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
    } else {
      return new JsonRpcProvider(this.url, network, {
        staticNetwork: true,
        batchMaxCount: 10,
        polling: true,
        pollingInterval: Config.network.blockPollingInterval,
      });
    }
  }
  
  private async checkHealth(): Promise<void> {
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
    } catch (error) {
      logger.error(`Health check failed for ${this.name}:`, error);
      this.health.isHealthy = false;
      this.handleProviderError();
    }
  }
  
  private startHealthCheck(): void {
    // Initial health check
    this.checkHealth();
    
    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, 10000); // Check every 10 seconds
  }
  
  private async handleProviderError(): Promise<void> {
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
        await (this.provider as WebSocketProvider).destroy();
      }
      
      this.provider = this.createProvider();
      await this.checkHealth();
    } catch (error) {
      logger.error(`Reconnection failed for ${this.name}:`, error);
      this.handleProviderError();
    }
  }
  
  getProvider(): JsonRpcProvider | WebSocketProvider {
    return this.provider;
  }
  
  getHealth(): ProviderHealth {
    return { ...this.health };
  }
  
  isHealthy(): boolean {
    return this.health.isHealthy && 
           this.health.latency < 5000 && // Less than 5 second latency
           (Date.now() - this.health.lastCheck.getTime()) < 30000; // Checked within last 30 seconds
  }
  
  async destroy(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.isWebSocket) {
      await (this.provider as WebSocketProvider).destroy();
    }
  }
}

// Fallback provider manager
class ProviderManager {
  private providers: MonitoredProvider[] = [];
  private fallbackProvider: FallbackProvider | null = null;
  private primaryProvider: MonitoredProvider | null = null;
  
  constructor() {
    this.setupProviders();
  }
  
  private setupProviders(): void {
    // Setup primary provider
    const primaryUrl = this.constructProviderUrl(Config.network.rpcUrl);
    this.primaryProvider = new MonitoredProvider(
      primaryUrl,
      'Primary',
      primaryUrl.startsWith('ws')
    );
    this.providers.push(this.primaryProvider);
    
    // Setup backup provider if available
    if (Config.network.rpcUrlBackup) {
      const backupUrl = this.constructProviderUrl(Config.network.rpcUrlBackup);
      const backupProvider = new MonitoredProvider(
        backupUrl,
        'Backup',
        backupUrl.startsWith('ws')
      );
      this.providers.push(backupProvider);
    }
    
    // Setup providers from API keys
    if (Config.providers.alchemyKey) {
      const alchemyUrl = `https://polygon-mainnet.g.alchemy.com/v2/${Config.providers.alchemyKey}`;
      this.providers.push(new MonitoredProvider(alchemyUrl, 'Alchemy', false));
    }
    
    if (Config.providers.infuraKey) {
      const infuraUrl = `https://polygon-mainnet.infura.io/v3/${Config.providers.infuraKey}`;
      this.providers.push(new MonitoredProvider(infuraUrl, 'Infura', false));
    }
    
    if (Config.providers.quicknodeEndpoint) {
      this.providers.push(new MonitoredProvider(
        Config.providers.quicknodeEndpoint,
        'QuickNode',
        Config.providers.quicknodeEndpoint.startsWith('ws')
      ));
    }
    
    // Create fallback provider with healthy providers
    this.updateFallbackProvider();
  }
  
  private constructProviderUrl(url: string): string {
    // Add API keys if they're referenced in the URL
    return url
      .replace('{INFURA_KEY}', Config.providers.infuraKey || '')
      .replace('{ALCHEMY_KEY}', Config.providers.alchemyKey || '');
  }
  
  private updateFallbackProvider(): void {
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
    
    this.fallbackProvider = new FallbackProvider(healthyProviders, Config.network.chainId);
    logger.info(`Fallback provider updated with ${healthyProviders.length} healthy providers`);
  }
  
  getProvider(): JsonRpcProvider | WebSocketProvider | FallbackProvider {
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
    return this.primaryProvider!.getProvider();
  }
  
  getWebSocketProvider(): WebSocketProvider | null {
    const wsProvider = this.providers.find(p => p.isHealthy() && p.getProvider() instanceof WebSocketProvider);
    return wsProvider ? (wsProvider.getProvider() as WebSocketProvider) : null;
  }
  
  async getHealthReport(): Promise<{ [key: string]: ProviderHealth }> {
    const report: { [key: string]: ProviderHealth } = {};
    
    for (const provider of this.providers) {
      const name = this.providers.indexOf(provider) === 0 ? 'primary' : `backup_${this.providers.indexOf(provider)}`;
      report[name] = provider.getHealth();
    }
    
    return report;
  }
  
  async destroy(): Promise<void> {
    await Promise.all(this.providers.map(p => p.destroy()));
  }
}

// Singleton instance
let providerManager: ProviderManager | null = null;

// Initialize provider manager
export const initializeProviders = (): void => {
  if (!providerManager) {
    providerManager = new ProviderManager();
    logger.info('Provider manager initialized');
  }
};

// Get the current best provider
export const getProvider = (): JsonRpcProvider | WebSocketProvider | FallbackProvider => {
  if (!providerManager) {
    initializeProviders();
  }
  return providerManager!.getProvider();
};

// Get WebSocket provider for subscriptions
export const getWebSocketProvider = (): WebSocketProvider | null => {
  if (!providerManager) {
    initializeProviders();
  }
  return providerManager!.getWebSocketProvider();
};

// Wallet management
let signer: Wallet | null = null;

// Initialize signer
export const initializeSigner = (): Wallet => {
  if (signer) return signer;
  
  const provider = getProvider();
  
  if (Config.wallet.privateKey) {
    signer = new Wallet(Config.wallet.privateKey, provider);
    logger.info(`Wallet initialized from private key: ${signer.address}`);
  } else if (Config.wallet.mnemonic) {
    signer = Wallet.fromPhrase(Config.wallet.mnemonic, provider);
    logger.info(`Wallet initialized from mnemonic: ${signer.address}`);
  } else {
    throw new Error('No private key or mnemonic provided');
  }
  
  return signer;
};

// Get signer instance
export const getSigner = (): Wallet => {
  if (!signer) {
    return initializeSigner();
  }
  return signer;
};

// Get wallet address
export const getWalletAddress = (): string => {
  const wallet = getSigner();
  return wallet.address;
};

// Get wallet balance
export const getWalletBalance = async (): Promise<bigint> => {
  const provider = getProvider();
  const address = getWalletAddress();
  return await provider.getBalance(address);
};

// Nonce management for high-frequency trading
class NonceManager {
  private baseNonce: number | null = null;
  private nonceOffset = 0;
  private lastReset = Date.now();
  private resetInterval = 60000; // Reset every minute
  private pendingNonces = new Set<number>();
  
  async getNonce(): Promise<number> {
    const now = Date.now();
    
    // Reset nonce periodically or if too many pending
    if (!this.baseNonce || 
        now - this.lastReset > this.resetInterval || 
        this.pendingNonces.size > 50) {
      await this.resetNonce();
    }
    
    const nonce = this.baseNonce! + this.nonceOffset;
    this.nonceOffset++;
    this.pendingNonces.add(nonce);
    
    return nonce;
  }
  
  async resetNonce(): Promise<void> {
    const provider = getProvider();
    const address = getWalletAddress();
    
    this.baseNonce = await provider.getTransactionCount(address, 'pending');
    this.nonceOffset = 0;
    this.lastReset = Date.now();
    this.pendingNonces.clear();
    
    logger.debug(`Nonce reset to ${this.baseNonce}`);
  }
  
  releaseNonce(nonce: number): void {
    this.pendingNonces.delete(nonce);
  }
  
  async confirmNonce(nonce: number): Promise<void> {
    this.pendingNonces.delete(nonce);
    
    // If this was the base nonce, increment for next use
    if (nonce === this.baseNonce) {
      this.baseNonce++;
      this.nonceOffset = Math.max(0, this.nonceOffset - 1);
    }
  }
}

// Export nonce manager instance
export const nonceManager = new NonceManager();

// Provider health monitoring
export const startProviderMonitoring = (): void => {
  setInterval(async () => {
    if (!providerManager) return;
    
    const health = await providerManager.getHealthReport();
    const healthyCount = Object.values(health).filter(h => h.isHealthy).length;
    
    if (healthyCount === 0) {
      logger.error('CRITICAL: All providers are unhealthy!');
    } else if (healthyCount === 1) {
      logger.warn('WARNING: Only one healthy provider remaining');
    }
    
    // Log detailed health metrics
    logger.debug('Provider health report:', health);
  }, 30000); // Check every 30 seconds
};

// Utility function to wait for transaction with timeout
export const waitForTransaction = async (
  txHash: string,
  confirmations = 1,
  timeoutMs = 60000
): Promise<ethers.TransactionReceipt | null> => {
  const provider = getProvider();
  
  return Promise.race([
    provider.waitForTransaction(txHash, confirmations),
    new Promise<null>((resolve) => 
      setTimeout(() => {
        logger.warn(`Transaction ${txHash} timed out after ${timeoutMs}ms`);
        resolve(null);
      }, timeoutMs)
    ),
  ]);
};

// Export provider utilities
export const provider = {
  get: getProvider,
  getWebSocket: getWebSocketProvider,
  initialize: initializeProviders,
  startMonitoring: startProviderMonitoring,
};

// Export wallet utilities  
export const wallet = {
  getSigner,
  getAddress: getWalletAddress,
  getBalance: getWalletBalance,
  initialize: initializeSigner,
};

// Initialize on module load in production
if (Config.execution.mode === 'live') {
  initializeProviders();
  initializeSigner();
  startProviderMonitoring();
}
