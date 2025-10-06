import { Config, logConfig, isSimulationMode } from './config';
import { DataSource } from 'typeorm';
import { provider, wallet } from './providers/polygonProvider';
import { MarketWatcher } from './services/watcher';
import { getHealthAPI } from './api/health';
import { getMetricsService } from './monitoring/metrics';
import { getRiskManager } from './risk/riskManager';
import { getContractManager } from './contracts/contractManager';
import { Ledger } from './accounting/ledger';
import { TradeEntity } from './database/entities/trade.entity';
import { WalletEntity } from './database/entities/wallet.entity';
import { TokenEntity } from './database/entities/token.entity';
import { DexEntity } from './database/entities/dex.entity';
import winston from 'winston';
import { ethers } from 'ethers';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'main-orchestrator' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5,
    }),
    new winston.transports.File({ 
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
export class MainOrchestrator {
  private dataSource: DataSource;
  private marketWatcher: MarketWatcher | null = null;
  private ledger: Ledger | null = null;
  private isRunning = false;
  private startTime = Date.now();
  
  constructor() {
    // Setup database connection
    this.dataSource = new DataSource({
      type: 'postgres',
      host: Config.database.host,
      port: Config.database.port,
      username: Config.database.username,
      password: Config.database.password,
      database: Config.database.name,
      entities: [TradeEntity, WalletEntity, TokenEntity, DexEntity],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: Config.monitoring.logLevel === 'debug',
      poolSize: Config.database.poolSize,
    });
  }
  
  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    logger.info('🚀 Initializing Polygon Arbitrage Bot...');
    
    try {
      // 1. Initialize database
      logger.info('📊 Connecting to database...');
      await this.dataSource.initialize();
      logger.info('✅ Database connected');
      
      // 2. Initialize ledger
      this.ledger = new Ledger(this.dataSource);
      logger.info('✅ Ledger initialized');
      
      // 3. Initialize providers
      logger.info('🌐 Initializing blockchain providers...');
      provider.initialize();
      provider.startMonitoring();
      logger.info('✅ Providers initialized');
      
      // 4. Verify wallet
      await this.verifyWallet();
      
      // 5. Check and deploy smart contract
      await this.checkSmartContract();
      
      // 6. Initialize services
      logger.info('🔧 Starting services...');
      
      // Start metrics service
      const metricsService = getMetricsService();
      metricsService.start();
      logger.info('✅ Metrics service started');
      
      // Start health API
      const healthAPI = getHealthAPI();
      healthAPI.start();
      logger.info('✅ Health API started');
      
      // Initialize market watcher
      this.marketWatcher = new MarketWatcher(this.dataSource);
      logger.info('✅ Market watcher initialized');
      
      // Setup event listeners
      this.setupEventListeners();
      
      logger.info('✨ Initialization complete!');
      this.displayStatus();
      
    } catch (error) {
      logger.error('❌ Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Verify wallet configuration
   */
  private async verifyWallet(): Promise<void> {
    if (isSimulationMode()) {
      logger.info('📝 Running in SIMULATION mode - no real trades');
      return;
    }
    
    logger.info('💰 Verifying wallet...');
    const address = wallet.getAddress();
    const balance = await wallet.getBalance();
    const balanceEther = ethers.formatEther(balance);
    
    logger.info(`📍 Wallet Address: ${address}`);
    logger.info(`💎 MATIC Balance: ${balanceEther}`);
    
    // Check minimum balance
    const minBalance = ethers.parseEther('5'); // 5 MATIC minimum
    if (balance < minBalance) {
      if (Config.execution.mode === 'live') {
        throw new Error(`Insufficient balance: ${balanceEther} MATIC (minimum: 5 MATIC)`);
      } else {
        logger.warn('⚠️  Low balance warning');
      }
    }
    
    logger.info('✅ Wallet verified');
  }
  
  /**
   * Check and deploy smart contract if needed
   */
  private async checkSmartContract(): Promise<void> {
    if (isSimulationMode()) {
      logger.info('📝 Simulation mode - skipping contract check');
      return;
    }
    
    logger.info('📜 Checking smart contract...');
    const contractManager = getContractManager();
    
    const isDeployed = await contractManager.verifyContract();
    
    if (!isDeployed) {
      logger.warn('⚠️  No smart contract deployed');
      logger.info('💡 Deploy with: npm run deploy:contract');
      
      if (Config.flashloan.enabled) {
        logger.warn('⚠️  Flash loans disabled - contract required');
      }
    } else {
      const address = contractManager.getContractAddress();
      logger.info(`✅ Smart contract verified at: ${address}`);
    }
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    if (!this.marketWatcher) return;
    
    // Market watcher events
    this.marketWatcher.on('opportunity-found', async (opportunity) => {
      logger.info(`💡 Opportunity: ${opportunity.simulation.path.id} - Profit: $${opportunity.simulation.netProfitUsd.toFixed(2)}`);
      
      // Update metrics
      const metrics = getMetricsService();
      metrics.recordOpportunity(
        opportunity.simulation.path.type,
        opportunity.simulation.path.dexes[0]
      );
    });
    
    this.marketWatcher.on('trade-executed', async (result) => {
      if (result.success) {
        logger.info(`✅ Trade successful: ${result.transactionHash}`);
      } else {
        logger.error(`❌ Trade failed: ${result.error}`);
      }
      
      // Update metrics
      const metrics = getMetricsService();
      metrics.recordTrade(
        'unknown', // Should be passed in result
        'unknown',
        result.success,
        result.actualProfit ? parseFloat(ethers.formatEther(result.actualProfit)) * 0.8 : 0,
        result.gasUsed || BigInt(0),
        Date.now() - result.timestamp
      );
    });
    
    this.marketWatcher.on('error', (error) => {
      logger.error('❌ Watcher error:', error);
      
      const metrics = getMetricsService();
      metrics.recordError('watcher', 'high');
    });
    
    // Risk manager events
    const riskManager = getRiskManager();
    
    riskManager.on('circuit-breaker-triggered', (reason) => {
      logger.error(`🚨 CIRCUIT BREAKER: ${reason}`);
      
      // Update metrics
      const metrics = getMetricsService();
      metrics.updateCircuitBreaker(true);
      metrics.recordError('circuit_breaker', 'critical');
      
      // Pause watcher
      if (this.marketWatcher) {
        this.marketWatcher.pause();
      }
    });
    
    riskManager.on('daily-limit-reached', (limitType, current, limit) => {
      logger.warn(`⚠️  Daily limit: ${limitType} - ${current}/${limit}`);
      
      const metrics = getMetricsService();
      metrics.recordError('daily_limit', 'medium');
    });
  }
  
  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
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
      logger.info('=' .repeat(60));
      logger.info('🤖 POLYGON ARBITRAGE BOT IS RUNNING');
      logger.info('=' .repeat(60));
      logger.info(`Mode: ${Config.execution.mode.toUpperCase()}`);
      logger.info(`Time: ${new Date().toISOString()}`);
      logger.info('=' .repeat(60));
      logger.info('');
      
      // Start periodic status updates
      this.startStatusUpdates();
      
    } catch (error) {
      logger.error('Failed to start bot:', error);
      await this.shutdown();
      throw error;
    }
  }
  
  /**
   * Display current status
   */
  private displayStatus(): void {
    const riskManager = getRiskManager();
    const riskMetrics = riskManager.getMetrics();
    
    logger.info('');
    logger.info('📈 Current Status:');
    logger.info('─'.repeat(40));
    logger.info(`Mode: ${Config.execution.mode}`);
    logger.info(`Circuit Breaker: ${riskMetrics.circuitBreakerActive ? '🔴 ACTIVE' : '🟢 OK'}`);
    logger.info(`Daily P&L: $${(riskMetrics.dailyProfit - riskMetrics.dailyLoss).toFixed(2)}`);
    logger.info(`Daily Trades: ${riskMetrics.dailyTrades}`);
    logger.info(`Enabled DEXes: ${Config.dex.enabledDexes.join(', ')}`);
    logger.info('─'.repeat(40));
    logger.info('');
  }
  
  /**
   * Start periodic status updates
   */
  private startStatusUpdates(): void {
    setInterval(() => {
      if (!this.isRunning) return;
      
      const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60);
      
      if (this.marketWatcher) {
        const status = this.marketWatcher.getStatus();
        const performance = this.marketWatcher.getPerformanceMetrics();
        
        logger.info('');
        logger.info(`📊 Status Update (${uptime} min uptime)`);
        logger.info(`Opportunities: ${status.opportunitiesFound} | Trades: ${status.tradesExecuted} | Profit: $${status.profitGenerated.toFixed(2)}`);
        logger.info(`Memory: ${performance.memoryUsageMB} MB | Queue: ${performance.queueSize}`);
      }
    }, 60000); // Every minute
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
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
    const riskManager = getRiskManager();
    riskManager.destroy();
    
    logger.info('👋 Shutdown complete');
  }
}

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

export default orchestrator;
