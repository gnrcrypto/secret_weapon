// src/index.ts
import { Config } from './config';
import { provider, wallet, nonceManager } from './providers/polygonProvider';
import winston from 'winston';
import { ethers } from 'ethers';
import { createWatcher } from './services/watcher';
import { DataSource } from 'typeorm';

import { TradeEntity } from './database/entities/trade.entity';
import { WalletEntity } from './database/entities/wallet.entity';
import { TokenEntity } from './database/entities/token.entity';
import { DexEntity } from './database/entities/dex.entity';

// ---------------- Logger Setup ----------------
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'polygon-arbitrage-bot' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

// ---------------- Helpers ----------------
function logConfig(): void {
  logger.info('Configuration:', {
    mode: Config.execution.mode,
    network: Config.network.chainId,
    dexes: Config.dex.enabledDexes,
    minProfit: Config.execution.minProfitThresholdUsd,
  });
}

function isSimulationMode(): boolean {
  return Config.execution.mode === 'simulate';
}

// Helper to safely unwrap the provider
function unwrapProvider(p: any): ethers.JsonRpcProvider | ethers.WebSocketProvider | ethers.FallbackProvider {
  if (p && typeof p.get === 'function') return p.get();
  return p;
}

// ---------------- Graceful Shutdown ----------------
class ShutdownManager {
  private shutdownCallbacks: Array<() => Promise<void>> = [];
  private isShuttingDown = false;

  register(callback: () => Promise<void>): void {
    this.shutdownCallbacks.push(callback);
  }

  async shutdown(signal: string): Promise<void> {
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
      await Promise.all(
        this.shutdownCallbacks.map(callback =>
          callback().catch(err => logger.error('Shutdown callback error:', err))
        )
      );
      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }
}

const shutdownManager = new ShutdownManager();

// ---------------- Main App ----------------
class ArbitrageBotApplication {
  private isRunning = false;
  private startTime = Date.now();
  private watcher: any;
  private dataSource: DataSource | null = null;

  async initialize(): Promise<void> {
    logger.info('='.repeat(50));
    logger.info('Polygon Arbitrage Bot Starting...');
    logger.info('='.repeat(50));
    logConfig();

    logger.info('Initializing providers...');
    if (typeof provider.initialize === 'function') provider.initialize();
    if (typeof provider.startMonitoring === 'function') provider.startMonitoring();

    if (!isSimulationMode()) {
      logger.info('Initializing wallet...');
      if (typeof wallet.initialize === 'function') wallet.initialize();

      const address = typeof wallet.getAddress === 'function' ? await wallet.getAddress() : wallet.address;
      const balance = await wallet.getBalance();
      logger.info(`Wallet Address: ${address}`);
      logger.info(`Wallet Balance: ${ethers.formatEther(balance)} MATIC`);

      const minBalance = ethers.parseEther('0.1');
      if (balance < minBalance) {
        logger.warn(`Low balance warning: ${ethers.formatEther(balance)} MATIC`);
        if (Config.execution.mode === 'live') {
          throw new Error('Insufficient balance for live trading');
        }
      }
    } else {
      logger.info('Running in SIMULATION mode - no real transactions will be executed');
    }

    // Verify network
    try {
      const currentProvider = unwrapProvider(provider);
      const network = await currentProvider.getNetwork();
      if (network.chainId !== BigInt(Config.network.chainId)) {
        throw new Error(`Wrong network: expected ${Config.network.chainId}, got ${network.chainId}`);
      }
      logger.info(`Connected to Polygon network (chainId: ${network.chainId})`);
    } catch (error) {
      logger.error('Failed to verify network connection:', error);
      if (Config.execution.mode === 'live') throw new Error('Network connection failed');
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
  private async initializeDatabase(): Promise<void> {
    logger.info('Initializing database connections...');

    this.dataSource = new DataSource({
      type: 'sqlite',
      database: 'arbitrage.db',
      synchronize: true,
      logging: false,
      entities: [TradeEntity, WalletEntity, TokenEntity, DexEntity],
    });

    await this.dataSource.initialize();
    logger.info('Database connected successfully ✅');
  }

  // ---------------- Service Initialization ----------------
  private async initializeServices(): Promise<void> {
    logger.info('Initializing services...');
    if (this.dataSource) {
      this.watcher = createWatcher(this.dataSource);
      logger.info('Watcher service initialized with database');
    } else {
      logger.warn('No data source available, watcher not initialized');
    }
    logger.info('All services initialized');
  }

  private registerShutdownHandlers(): void {
    shutdownManager.register(async () => {
      logger.info('Shutting down providers...');
      if (typeof provider.stopMonitoring === 'function') provider.stopMonitoring();
    });

    shutdownManager.register(async () => {
      logger.info('Shutting down services...');
      if (this.watcher && typeof this.watcher.stop === 'function') this.watcher.stop();
      if (this.dataSource && typeof this.dataSource.destroy === 'function') await this.dataSource.destroy();
    });

    shutdownManager.register(async () => {
      logger.info('Finalizing pending transactions...');
      if (nonceManager && typeof nonceManager.releaseAllNonces === 'function') {
        nonceManager.releaseAllNonces();
      }
    });
  }

  // ---------------- Runtime ----------------
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }
    try {
      await this.initialize();
      this.isRunning = true;

      logger.info('='.repeat(50));
      logger.info('Bot is now running!');
      logger.info(`Mode: ${Config.execution.mode.toUpperCase()}`);
      logger.info(`Start time: ${new Date().toISOString()}`);
      logger.info('='.repeat(50));

      await this.startServices();
      await this.runMainLoop();
    } catch (error) {
      logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  private async startServices(): Promise<void> {
    if (this.watcher && typeof this.watcher.start === 'function') {
      this.watcher.start();
      logger.info('Watcher service started');
    }
  }

  private async runMainLoop(): Promise<void> {
    logger.info('Main arbitrage loop started');
    while (this.isRunning) {
      try {
        await this.checkSystemHealth();
        if ((Date.now() - this.startTime) % 30000 < 1000) {
          const uptime = Math.floor((Date.now() - this.startTime) / 1000);
          logger.info(`Heartbeat - Uptime: ${uptime}s, Mode: ${Config.execution.mode}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error('Error in main loop:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async checkSystemHealth(): Promise<void> {
    try {
      const currentProvider = unwrapProvider(provider);
      await currentProvider.getBlockNumber();
    } catch (error) {
      logger.warn('Provider health check failed:', error);
      if (typeof provider.switchProvider === 'function') {
        const switched = await provider.switchProvider();
        if (switched) logger.info('Successfully switched to backup provider');
      }
    }

    if (!isSimulationMode() && wallet.getBalance) {
      try {
        const balance = await wallet.getBalance();
        const balanceEth = parseFloat(ethers.formatEther(balance));
        if (balanceEth < 0.1) {
          logger.error(`CRITICAL: Very low balance: ${balanceEth} MATIC`);
        }
      } catch (error) {
        logger.warn('Failed to check wallet balance:', error);
      }
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping bot...');
    this.isRunning = false;
    if (this.watcher && typeof this.watcher.stop === 'function') this.watcher.stop();
  }

  getStatus(): object {
    return {
      isRunning: this.isRunning,
      uptime: Date.now() - this.startTime,
      mode: Config.execution.mode,
      startTime: new Date(this.startTime).toISOString(),
      walletAddress: wallet.getAddress ? wallet.getAddress() : wallet.address,
    };
  }
}

// ---------------- Startup ----------------
const app = new ArbitrageBotApplication();

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

export { app, logger };
