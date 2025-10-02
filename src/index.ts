import { Config, logConfig, isSimulationMode } from './config';
import { provider, wallet } from './providers/polygonProvider';
import winston from 'winston';
import { ethers } from 'ethers';

// Enhanced logger setup
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
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
});

// Graceful shutdown handler
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
    
    // Set a timeout for shutdown
    const shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 30000); // 30 second timeout
    
    try {
      // Execute all shutdown callbacks
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

// Main application class
class ArbitrageBotApplication {
  private isRunning = false;
  private startTime = Date.now();
  
  async initialize(): Promise<void> {
    logger.info('='.repeat(50));
    logger.info('Polygon Arbitrage Bot Starting...');
    logger.info('='.repeat(50));
    
    // Log configuration (sanitized)
    logConfig();
    
    // Initialize providers
    logger.info('Initializing providers...');
    provider.initialize();
    provider.startMonitoring();
    
    // Initialize wallet
    if (!isSimulationMode()) {
      logger.info('Initializing wallet...');
      const signer = wallet.initialize();
      const address = wallet.getAddress();
      const balance = await wallet.getBalance();
      
      logger.info(`Wallet Address: ${address}`);
      logger.info(`Wallet Balance: ${ethers.formatEther(balance)} MATIC`);
      
      // Check minimum balance
      const minBalance = ethers.parseEther('10'); // 10 MATIC minimum
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
    const currentProvider = provider.get();
    const network = await currentProvider.getNetwork();
    if (network.chainId !== BigInt(Config.network.chainId)) {
      throw new Error(`Wrong network: expected ${Config.network.chainId}, got ${network.chainId}`);
    }
    logger.info(`Connected to Polygon network (chainId: ${network.chainId})`);
    
    // Initialize database connections
    await this.initializeDatabase();
    
    // Initialize services
    await this.initializeServices();
    
    // Register shutdown handlers
    this.registerShutdownHandlers();
    
    logger.info('Initialization complete');
  }
  
  private async initializeDatabase(): Promise<void> {
    logger.info('Initializing database connections...');
    // TODO: Initialize TypeORM connection
    // TODO: Initialize Redis connection
    // TODO: Run database migrations
    logger.info('Database connections established');
  }
  
  private async initializeServices(): Promise<void> {
    logger.info('Initializing services...');
    // TODO: Initialize DEX adapters
    // TODO: Initialize price oracle adapters
    // TODO: Initialize risk manager
    // TODO: Initialize monitoring services
    logger.info('Services initialized');
  }
  
  private registerShutdownHandlers(): void {
    // Register cleanup for providers
    shutdownManager.register(async () => {
      logger.info('Shutting down providers...');
      // Provider cleanup will be handled here
    });
    
    // Register cleanup for services
    shutdownManager.register(async () => {
      logger.info('Shutting down services...');
      // TODO: Stop watcher service
      // TODO: Stop worker pool
      // TODO: Close database connections
    });
    
    // Register cleanup for pending transactions
    shutdownManager.register(async () => {
      logger.info('Finalizing pending transactions...');
      // TODO: Wait for pending transactions or cancel them
    });
  }
  
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
      
      // Start main loop
      await this.runMainLoop();
      
    } catch (error) {
      logger.error('Failed to start bot:', error);
      throw error;
    }
  }
  
  private async runMainLoop(): Promise<void> {
    // TODO: Implement main arbitrage loop
    // This will coordinate:
    // - Market watching
    // - Opportunity detection
    // - Trade execution
    // - Risk management
    
    logger.info('Main arbitrage loop started');
    
    // Placeholder: keep the process running
    while (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Log heartbeat every minute
      if ((Date.now() - this.startTime) % 60000 < 1000) {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        logger.debug(`Heartbeat - Uptime: ${uptime}s`);
      }
    }
  }
  
  async stop(): Promise<void> {
    logger.info('Stopping bot...');
    this.isRunning = false;
  }
  
  getStatus(): object {
    return {
      isRunning: this.isRunning,
      uptime: Date.now() - this.startTime,
      mode: Config.execution.mode,
      startTime: new Date(this.startTime).toISOString(),
    };
  }
}

// Create application instance
const app = new ArbitrageBotApplication();

// Handle process signals
process.on('SIGINT', () => shutdownManager.shutdown('SIGINT'));
process.on('SIGTERM', () => shutdownManager.shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdownManager.shutdown('SIGHUP'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  shutdownManager.shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdownManager.shutdown('unhandledRejection');
});

// Start the application
if (require.main === module) {
  app.start().catch((error) => {
    logger.error('Fatal error during startup:', error);
    process.exit(1);
  });
}

// Export for testing
export { app, logger };
