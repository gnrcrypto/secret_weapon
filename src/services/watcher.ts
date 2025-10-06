import { Config } from '../config';
import { getPathfinder } from '../arb/pathfinder';
import { getSimulator } from '../arb/simulator';
import { getStrategy } from '../arb/strategy';
import { getExecutor } from '../exec/executor';
import { getRiskManager } from '../risk/riskManager';
import { provider, getWebSocketProvider } from '../providers/polygonProvider';
import { toWei, fromWei } from '../utils/math';
import winston from 'winston';
import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { DataSource } from 'typeorm';

// Logger
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'market-watcher' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Watcher events
export interface WatcherEvents {
  'opportunity-found': (opportunity: any) => void;
  'trade-executed': (result: any) => void;
  'error': (error: Error) => void;
  'block-processed': (blockNumber: number) => void;
  'status-update': (status: WatcherStatus) => void;
}

// Watcher status
export interface WatcherStatus {
  isRunning: boolean;
  lastBlockProcessed: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  profitGenerated: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

// Block processing result
interface BlockProcessingResult {
  blockNumber: number;
  opportunities: number;
  executed: number;
  profit: number;
  processingTimeMs: number;
}

/**
 * Market Watcher Service
 * Continuously monitors blockchain for arbitrage opportunities
 */
export class MarketWatcher extends EventEmitter {
  private isRunning = false;
  private startTime = Date.now();
  private lastBlockProcessed = 0;
  private totalOpportunitiesFound = 0;
  private totalTradesExecuted = 0;
  private totalProfitGenerated = 0;
  private blockQueue: PQueue;
  private watchInterval: NodeJS.Timeout | null = null;
  private wsProvider: any = null;
  private dataSource: DataSource;
  
  constructor(dataSource: DataSource) {
    super();
    this.dataSource = dataSource;
    
    // Initialize processing queue
    this.blockQueue = new PQueue({
      concurrency: 1, // Process blocks sequentially
      timeout: 30000, // 30 second timeout per block
    });
    
    this.setupEventListeners();
  }
  
  /**
   * Setup internal event listeners
   */
  private setupEventListeners(): void {
    // Risk manager events
    const riskManager = getRiskManager();
    
    riskManager.on('circuit-breaker-triggered', (reason) => {
      logger.error(`Circuit breaker triggered: ${reason}`);
      this.pause();
    });
    
    riskManager.on('daily-limit-reached', (limitType, current, limit) => {
      logger.warn(`Daily limit reached - ${limitType}: ${current}/${limit}`);
    });
  }
  
  /**
   * Start watching for opportunities
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Watcher already running');
      return;
    }
    
    logger.info('Starting market watcher...');
    this.isRunning = true;
    this.startTime = Date.now();
    
    // Initialize components
    const pathfinder = getPathfinder();
    await pathfinder.initialize();
    
    // Get current block
    const currentProvider = provider.get();
    this.lastBlockProcessed = await currentProvider.getBlockNumber();
    
    // Start watching based on mode
    if (Config.features.enableMevProtection) {
      // Use WebSocket for real-time monitoring
      await this.startWebSocketWatcher();
    } else {
      // Use polling for standard monitoring
      this.startPollingWatcher();
    }
    
    logger.info(`Market watcher started at block ${this.lastBlockProcessed}`);
    this.emit('status-update', this.getStatus());
  }
  
  /**
   * Start WebSocket-based watching (real-time)
   */
  private async startWebSocketWatcher(): Promise<void> {
    this.wsProvider = getWebSocketProvider();
    
    if (!this.wsProvider) {
      logger.warn('WebSocket provider not available, falling back to polling');
      this.startPollingWatcher();
      return;
    }
    
    // Subscribe to new blocks
    this.wsProvider.on('block', async (blockNumber: number) => {
      await this.processBlock(blockNumber);
    });
    
    // Subscribe to pending transactions for MEV
    if (Config.features.enableMevProtection) {
      this.wsProvider.on('pending', async (txHash: string) => {
        // Analyze pending transactions for sandwich attacks
        await this.analyzePendingTransaction(txHash);
      });
    }
    
    logger.info('WebSocket watcher initialized');
  }
  
  /**
   * Start polling-based watching
   */
  private startPollingWatcher(): void {
    const intervalMs = Config.monitoring.opportunityScanInterval || 30000;
    
    this.watchInterval = setInterval(async () => {
      try {
        const currentProvider = provider.get();
        const currentBlock = await currentProvider.getBlockNumber();
        
        // Process any missed blocks
        while (this.lastBlockProcessed < currentBlock) {
          this.lastBlockProcessed++;
          await this.processBlock(this.lastBlockProcessed);
        }
      } catch (error) {
        logger.error('Error in polling watcher:', error);
        this.emit('error', error as Error);
      }
    }, intervalMs);
    
    logger.info(`Polling watcher initialized (interval: ${intervalMs}ms)`);
  }
  
  /**
   * Process a single block
   */
  private async processBlock(blockNumber: number): Promise<void> {
    const startTime = Date.now();
    
    // Add to queue for sequential processing
    await this.blockQueue.add(async () => {
      try {
        logger.debug(`Processing block ${blockNumber}`);
        
        // Find arbitrage opportunities
        const opportunities = await this.findOpportunities();
        
        // Execute profitable opportunities
        const results = await this.executeOpportunities(opportunities);
        
        // Update metrics
        this.lastBlockProcessed = blockNumber;
        this.totalOpportunitiesFound += opportunities.length;
        this.totalTradesExecuted += results.executed;
        this.totalProfitGenerated += results.totalProfit;
        
        // Emit events
        this.emit('block-processed', blockNumber);
        
        if (opportunities.length > 0) {
          logger.info(`Block ${blockNumber}: Found ${opportunities.length} opportunities, executed ${results.executed}`);
        }
        
        // Log processing time if slow
        const processingTime = Date.now() - startTime;
        if (processingTime > 1000) {
          logger.warn(`Slow block processing: ${processingTime}ms for block ${blockNumber}`);
        }
        
      } catch (error) {
        logger.error(`Error processing block ${blockNumber}:`, error);
        this.emit('error', error as Error);
      }
    });
  }
  
  /**
   * Find arbitrage opportunities
   */
  private async findOpportunities(): Promise<any[]> {
    try {
      const pathfinder = getPathfinder();
      const simulator = getSimulator();
      const strategy = getStrategy();
      
      // Find all possible paths
      const paths = await pathfinder.enumeratePaths();
      
      if (paths.length === 0) {
        return [];
      }
      
      logger.debug(`Found ${paths.length} potential paths`);
      
      // Simulate each path in parallel
      const simulations = await Promise.all(
        paths.map(async (path) => {
          try {
            // Determine input amount based on path type
            const inputAmount = path.type === 'triangular' 
              ? toWei('1000', 18) // $1000 worth for triangular
              : toWei('5000', 18); // $5000 for cross-DEX
            
            // Simulate with current gas prices
            return await simulator.simulatePathOnChain(path, inputAmount);
          } catch (error) {
            logger.debug(`Simulation failed for path ${path.id}:`, error);
            return null;
          }
        })
      );
      
      // Filter out failed simulations
      const validSimulations = simulations.filter(s => s !== null && s.isProfitable);
      
      if (validSimulations.length === 0) {
        return [];
      }
      
      // Select best opportunities
      const opportunities = await strategy.selectTopOpportunities(validSimulations);
      
      // Log opportunities found
      opportunities.forEach(opp => {
        logger.info(`Opportunity found: ${opp.simulation.path.id} - Profit: ${opp.simulation.netProfitUsd.toFixed(2)} - Risk: ${opp.riskLevel}`);
        this.emit('opportunity-found', opp);
      });
      
      return opportunities;
    } catch (error) {
      logger.error('Error finding opportunities:', error);
      return [];
    }
  }
  
  /**
   * Execute profitable opportunities
   */
  private async executeOpportunities(opportunities: any[]): Promise<{
    executed: number;
    totalProfit: number;
  }> {
    if (opportunities.length === 0) {
      return { executed: 0, totalProfit: 0 };
    }
    
    const executor = getExecutor();
    const riskManager = getRiskManager();
    const strategy = getStrategy();
    
    let executed = 0;
    let totalProfit = 0;
    
    for (const opportunity of opportunities) {
      try {
        // Risk check
        const riskCheck = await riskManager.checkRisk(opportunity);
        
        if (!riskCheck.allowed) {
          logger.warn(`Risk check failed: ${riskCheck.reasons.join(', ')}`);
          continue;
        }
        
        // Final strategy check
        if (!strategy.shouldExecute(opportunity)) {
          logger.warn('Strategy rejected execution');
          continue;
        }
        
        // Register trade with strategy
        strategy.registerTradeExecution(opportunity.simulation.path.id);
        
        // Execute trade
        logger.info(`Executing trade: ${opportunity.simulation.path.id}`);
        const result = await executor.executeAtomicSwap(opportunity);
        
        // Update risk metrics
        await riskManager.updatePostTrade(result, opportunity);
        
        // Unregister from strategy
        strategy.unregisterTrade(opportunity.simulation.path.id);
        
        if (result.success) {
          executed++;
          const profitUsd = parseFloat(fromWei(result.actualProfit || BigInt(0))) * 0.8; // Estimate USD value
          totalProfit += profitUsd;
          
          logger.info(`Trade executed successfully: ${result.transactionHash} - Profit: ${profitUsd.toFixed(2)}`);
          this.emit('trade-executed', result);
        } else {
          logger.error(`Trade failed: ${result.error}`);
        }
        
      } catch (error) {
        logger.error(`Error executing opportunity:`, error);
        strategy.unregisterTrade(opportunity.simulation.path.id);
      }
    }
    
    return { executed, totalProfit };
  }
  
  /**
   * Analyze pending transaction for MEV
   */
  private async analyzePendingTransaction(txHash: string): Promise<void> {
    if (!Config.features.enableSandwichProtection) {
      return;
    }
    
    try {
      const currentProvider = provider.get();
      const tx = await currentProvider.getTransaction(txHash);
      
      if (!tx || !tx.data) return;
      
      // Check if it's a DEX swap
      const isSwap = tx.data.includes('0x38ed1739') || // swapExactTokensForTokens
                     tx.data.includes('0x8803dbee') || // swapTokensForExactTokens
                     tx.data.includes('0x7ff36ab5');   // swapExactETHForTokens
      
      if (isSwap && tx.value && tx.value > toWei('100', 18)) {
        // Large swap detected - potential sandwich opportunity
        logger.debug(`Large swap detected in mempool: ${txHash}`);
        
        // TODO: Implement sandwich protection strategy
        // This could involve:
        // 1. Frontrunning the transaction with our own trade
        // 2. Backrunning it to capture the price movement
        // 3. Or avoiding the affected pools temporarily
      }
    } catch (error) {
      // Transaction might already be mined
      logger.debug(`Failed to analyze pending tx ${txHash}:`, error);
    }
  }
  
  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Watcher not running');
      return;
    }
    
    logger.info('Stopping market watcher...');
    this.isRunning = false;
    
    // Stop polling
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    
    // Disconnect WebSocket
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }
    
    // Wait for queue to finish
    await this.blockQueue.onIdle();
    
    logger.info('Market watcher stopped');
    this.emit('status-update', this.getStatus());
  }
  
  /**
   * Pause watching (keeps connections alive)
   */
  pause(): void {
    if (!this.isRunning) return;
    
    logger.info('Pausing market watcher');
    
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners('block');
      this.wsProvider.removeAllListeners('pending');
    }
    
    this.blockQueue.pause();
  }
  
  /**
   * Resume watching
   */
  resume(): void {
    if (!this.isRunning) {
      logger.warn('Watcher not running, cannot resume');
      return;
    }
    
    logger.info('Resuming market watcher');
    
    this.blockQueue.start();
    
    if (this.wsProvider) {
      this.startWebSocketWatcher();
    } else {
      this.startPollingWatcher();
    }
  }
  
  /**
   * Get watcher status
   */
  getStatus(): WatcherStatus {
    return {
      isRunning: this.isRunning,
      lastBlockProcessed: this.lastBlockProcessed,
      opportunitiesFound: this.totalOpportunitiesFound,
      tradesExecuted: this.totalTradesExecuted,
      profitGenerated: this.totalProfitGenerated,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      memoryUsage: process.memoryUsage(),
    };
  }
  
  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): object {
    const uptime = Date.now() - this.startTime;
    const avgOpportunitiesPerHour = (this.totalOpportunitiesFound / (uptime / 3600000));
    const avgTradesPerHour = (this.totalTradesExecuted / (uptime / 3600000));
    const successRate = this.totalOpportunitiesFound > 0 
      ? (this.totalTradesExecuted / this.totalOpportunitiesFound * 100)
      : 0;
    
    return {
      uptime: `${(uptime / 3600000).toFixed(2)} hours`,
      totalOpportunities: this.totalOpportunitiesFound,
      totalTrades: this.totalTradesExecuted,
      totalProfit: `${this.totalProfitGenerated.toFixed(2)}`,
      avgOpportunitiesPerHour: avgOpportunitiesPerHour.toFixed(2),
      avgTradesPerHour: avgTradesPerHour.toFixed(2),
      successRate: `${successRate.toFixed(1)}%`,
      queueSize: this.blockQueue.size,
      memoryUsageMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
    };
  }
}
