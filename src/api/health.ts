import express, { Request, Response, NextFunction } from 'express';
import { Config } from '../config';
import { getExecutor } from '../exec/executor';
import { getRiskManager } from '../risk/riskManager';
import { getStrategy } from '../arb/strategy';
import { provider, wallet } from '../providers/polygonProvider';
import winston from 'winston';

const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'health-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

export class HealthAPI {
  private app: express.Application;
  private isPaused = false;
  private startTime = Date.now();

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    
    // API key authentication
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers[Config.security.apiKeyHeader.toLowerCase()];
      
      // Skip auth for health endpoint
      if (req.path === '/health') {
        return next();
      }
      
      if (!apiKey || apiKey !== Config.security.apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      next();
    });
  }

  private setupRoutes(): void {
    /**
     * Health check endpoint
     */
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        const health = await this.getHealthStatus();
        const statusCode = health.isHealthy ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        res.status(503).json({
          isHealthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    /**
     * Detailed metrics endpoint
     */
    this.app.get('/metrics', async (req: Request, res: Response) => {
      try {
        const metrics = await this.getDetailedMetrics();
        res.json(metrics);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    /**
     * Pause trading
     */
    this.app.post('/pause', (req: Request, res: Response) => {
      this.isPaused = true;
      const riskManager = getRiskManager();
      riskManager.emergencyStop();
      
      logger.warn('Trading paused via API');
      res.json({ status: 'paused', message: 'Trading has been paused' });
    });

    /**
     * Resume trading
     */
    this.app.post('/resume', (req: Request, res: Response) => {
      this.isPaused = false;
      logger.info('Trading resumed via API');
      res.json({ status: 'active', message: 'Trading has been resumed' });
    });

    /**
     * Simulate trade
     */
    this.app.post('/simulate', async (req: Request, res: Response) => {
      try {
        const { path, amount } = req.body;
        
        if (!path || !amount) {
          return res.status(400).json({ error: 'Missing path or amount' });
        }
        
        // Import simulator to avoid circular dependency
        const { getSimulator } = await import('../arb/simulator');
        const simulator = getSimulator();
        
        const result = await simulator.simulatePathOnChain(
          path,
          BigInt(amount)
        );
        
        res.json({
          isProfitable: result.isProfitable,
          netProfitUsd: result.netProfitUsd,
          priceImpact: result.priceImpact,
          confidence: result.confidence,
        });
      } catch (error) {
        res.status(500).json({ error: 'Simulation failed' });
      }
    });

    /**
     * Get configuration
     */
    this.app.get('/config', (req: Request, res: Response) => {
      // Return sanitized config
      const sanitized = {
        mode: Config.execution.mode,
        minProfit: Config.execution.minProfitThresholdUsd,
        maxTrade: Config.execution.maxTradeSizeUsd,
        slippage: Config.execution.slippageBps / 100,
        enabledDexes: Config.dex.enabledDexes,
        features: Config.features,
        risk: {
          dailyLossLimit: Config.risk.dailyLossLimitUsd,
          maxConsecutiveFailures: Config.risk.maxConsecutiveFailures,
        },
      };
      
      res.json(sanitized);
    });

    /**
     * Get wallet info
     */
    this.app.get('/wallet', async (req: Request, res: Response) => {
      try {
        const address = wallet.getAddress();
        const balance = await wallet.getBalance();
        
        res.json({
          address,
          balanceMatic: ethers.formatEther(balance),
          network: Config.network.chainId,
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get wallet info' });
      }
    });

    /**
     * Get risk status
     */
    this.app.get('/risk', (req: Request, res: Response) => {
      const riskManager = getRiskManager();
      const report = riskManager.getRiskReport();
      res.json(report);
    });

    /**
     * Get execution status
     */
    this.app.get('/execution', (req: Request, res: Response) => {
      const executor = getExecutor();
      const status = executor.getStatus();
      res.json(status);
    });

    /**
     * Get strategy metrics
     */
    this.app.get('/strategy', (req: Request, res: Response) => {
      const strategy = getStrategy();
      const metrics = strategy.getMetrics();
      res.json(metrics);
    });

    /**
     * Emergency stop
     */
    this.app.post('/emergency-stop', (req: Request, res: Response) => {
      this.emergencyStop();
      res.json({ status: 'stopped', message: 'Emergency stop activated' });
    });

    /**
     * Get system logs
     */
    this.app.get('/logs', (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const level = req.query.level as string || 'info';
      
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
  private async getHealthStatus(): Promise<any> {
    const currentProvider = provider.get();
    
    // Check provider connection
    let providerHealthy = false;
    let blockNumber = 0;
    
    try {
      blockNumber = await currentProvider.getBlockNumber();
      providerHealthy = blockNumber > 0;
    } catch (error) {
      logger.error('Provider health check failed:', error);
    }
    
    // Check risk manager
    const riskManager = getRiskManager();
    const riskMetrics = riskManager.getMetrics();
    
    // Check executor
    const executor = getExecutor();
    const execStatus = executor.getStatus();
    
    // Overall health
    const isHealthy = 
      providerHealthy && 
      !riskMetrics.circuitBreakerActive &&
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
          circuitBreaker: riskMetrics.circuitBreakerActive,
          dailyLoss: riskMetrics.dailyLoss,
          consecutiveFailures: riskMetrics.consecutiveFailures,
        },
        executor: {
          pending: execStatus.pending,
          completed: execStatus.completed,
          failed: execStatus.failed,
          successRate: execStatus.successRate,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get detailed metrics
   */
  private async getDetailedMetrics(): Promise<any> {
    const riskManager = getRiskManager();
    const executor = getExecutor();
    const strategy = getStrategy();
    
    return {
      risk: riskManager.getRiskReport(),
      execution: executor.getStatus(),
      strategy: strategy.getMetrics(),
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
  private emergencyStop(): void {
    logger.error('EMERGENCY STOP ACTIVATED');
    
    // Pause all operations
    this.isPaused = true;
    
    // Trigger risk manager circuit breaker
    const riskManager = getRiskManager();
    riskManager.emergencyStop();
    
    // Cancel pending transactions
    const executor = getExecutor();
    const pending = executor.getPendingTransactions();
    
    logger.info(`Cancelling ${pending.length} pending transactions`);
    
    // TODO: Actually cancel the transactions
  }

  /**
   * Start the API server
   */
  start(port?: number): void {
    const apiPort = port || Config.monitoring.healthCheckPort;
    
    this.app.listen(apiPort, () => {
      logger.info(`Health API started on port ${apiPort}`);
      logger.info(`Health check: http://localhost:${apiPort}/health`);
    });
  }
}

// Import ethers for wallet balance
import { ethers } from 'ethers';

// Singleton instance
let healthAPI: HealthAPI | null = null;

export function getHealthAPI(): HealthAPI {
  if (!healthAPI) {
    healthAPI = new HealthAPI();
  }
  return healthAPI;
}
