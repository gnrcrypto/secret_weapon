import { Config, isSimulationMode } from './config';
import { DataSource } from 'typeorm';
import { provider, wallet } from './providers/polygonProvider';
import { MarketWatcher } from './services/watcher';
import { HealthAPI } from './api/health';
import { getMetricsService } from './monitoring/metrics';
import { getRiskManager } from './risk/riskManager';
import winston from 'winston';
import { ethers } from 'ethers';
import * as LedgerModule from './accounting/ledger';

// Resolve createLedger gracefully (named/export/default)
const createLedger = (LedgerModule as any).createLedger || (LedgerModule as any).default || (() => {
  throw new Error('createLedger not found in ./accounting/ledger');
});

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
  private ledger: ReturnType<typeof createLedger> | null = null;
  private isRunning = false;
  private startTime = Date.now();

  constructor() {
    // Setup database connection
    this.dataSource = new DataSource({
      type: 'postgres',
      host: (Config.database as any).host || 'localhost',
      port: (Config.database as any).port || 5432,
      username: (Config.database as any).username || '',
      password: (Config.database as any).password || '',
      database: (Config.database as any).name || 'arbitrage',
      entities: [],
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
      try {
        this.ledger = createLedger((Config.database as any).accountingDbUrl || '');
        logger.info('✅ Ledger initialized');
      } catch (e) {
        logger.warn('Ledger not initialized:', (e as Error).message);
      }

      // 3. Initialize providers
      logger.info('🌐 Initializing blockchain providers...');
      if (typeof provider.initialize === 'function') provider.initialize();
      if (typeof provider.startMonitoring === 'function') provider.startMonitoring();
      logger.info('✅ Providers initialized');

      // 4. Verify wallet
      await this.verifyWallet();

      // 5. Check and deploy smart contract (attempt dynamic import; skip if missing)
      await this.checkSmartContract();

      // 6. Initialize services
      logger.info('🔧 Starting services...');

      // Start metrics service
      const metricsService = getMetricsService();
      metricsService.start();
      logger.info('✅ Metrics service started');

      // Start health API
      const healthAPI = new HealthAPI();
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
    const address = typeof (wallet as any).getAddress === 'function' ? await (wallet as any).getAddress() : (wallet as any).address;
    const balance = await (wallet as any).getBalance();
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

    try {
      // try dynamic import to avoid failing compile-time if module is missing
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const contractModule = await import('./contracts/contractManager').catch(() => null);
      const contractManager = contractModule ? contractModule.getContractManager?.() || contractModule.getContractManager : null;

      if (!contractManager || typeof contractManager.verifyContract !== 'function') {
        logger.warn('⚠️  Contract manager not available - skipping contract verification');
        return;
      }

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
    } catch (err) {
      logger.warn('Contract manager check failed:', (err as Error).message);
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
        Date.now() - (result.timestamp || Date.now())
      );
    });

    this.marketWatcher.on('error', (error) => {
      logger.error('❌ Watcher error:', error);

      const metrics = getMetricsService();
      metrics.recordError('watcher', 'high');
    });

    // Risk manager events
    const riskManager = getRiskManager();

    if (riskManager && typeof (riskManager as any).on === 'function') {
      (riskManager as any).on('circuit-breaker-triggered', (reason: string) => {
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

      (riskManager as any).on('daily-limit-reached', (limitType: string, current: number, limit: number) => {
        logger.warn(`⚠️  Daily limit: ${limitType} - ${current}/${limit}`);

        const metrics = getMetricsService();
        metrics.recordError('daily_limit', 'medium');
      });
    }
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
      logger.info('='.repeat(60));
      logger.info('🤖 POLYGON ARBITRAGE BOT IS RUNNING');
      logger.info('='.repeat(60));
      logger.info(`Mode: ${Config.execution.mode.toUpperCase()}`);
      logger.info(`Time: ${new Date().toISOString()}`);
      logger.info('='.repeat(60));
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
    const riskMetrics = (riskManager as any).getMetrics ? (riskManager as any).getMetrics() : {};
    const dailyProfit = (riskMetrics as any).dailyProfit || 0;
    const dailyLoss = (riskMetrics as any).dailyLoss || 0;

    logger.info('');
    logger.info('📈 Current Status:');
    logger.info('─'.repeat(40));
    logger.info(`Mode: ${Config.execution.mode}`);
    logger.info(`Circuit Breaker: ${((riskMetrics as any).circuitBreakerActive ? '🔴 ACTIVE' : '🟢 OK')}`);
    logger.info(`Daily P&L: $${(dailyProfit - dailyLoss).toFixed(2)}`);
    logger.info(`Daily Trades: ${ (riskMetrics as any).dailyTrades || 0 }`);
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
        const status = (this.marketWatcher as any).getStatus();
        const performance = (this.marketWatcher as any).getPerformanceMetrics();
        const perfAny: any = performance || {};

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
    if (typeof (riskManager as any).destroy === 'function') {
      (riskManager as any).destroy();
    }

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
