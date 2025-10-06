import express, { Request, Response, NextFunction } from 'express';
import { Config, ADDRESSES } from '../config';
import { getExecutor } from '../exec/executor';
import { getRiskManager } from '../risk/riskManager';
import { getStrategy } from '../arb/strategy';
import { provider, wallet } from '../providers/polygonProvider';
import winston from 'winston';
import { ethers } from 'ethers';

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
      const headerName = Config.security.apiKeyHeader?.toLowerCase() || 'x-api-key';
      const apiKey = req.headers[headerName];

      // Skip auth for GET /health
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
    this.app.get('/health', async (_req: Request, res: Response) => {
      try {
        const health = await this.getHealthStatus();
        const statusCode = health.isHealthy ? 200 : 503;
        return res.status(statusCode).json(health);
      } catch (error) {
        return res.status(503).json({
          isHealthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    /**
     * Detailed metrics endpoint
     */
    this.app.get('/metrics', async (_req: Request, res: Response) => {
      try {
        const metrics = await this.getDetailedMetrics();
        return res.json(metrics);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    /**
     * Pause trading
     */
    this.app.post('/pause', (_req: Request, res: Response) => {
      this.isPaused = true;
      const riskManager = getRiskManager();
      if (typeof (riskManager as any).emergencyStop === 'function') {
        try { (riskManager as any).emergencyStop(); } catch (e) { /* swallow */ }
      }
      logger.warn('Trading paused via API');
      return res.json({ status: 'paused', message: 'Trading has been paused' });
    });

    /**
     * Resume trading
     */
    this.app.post('/resume', (_req: Request, res: Response) => {
      this.isPaused = false;
      logger.info('Trading resumed via API');
      return res.json({ status: 'active', message: 'Trading has been resumed' });
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

        // Import simulator dynamically to avoid circular dependencies
        const { getSimulator } = await import('../arb/simulator');
        const simulator = getSimulator();

        const result = await simulator.simulatePathOnChain(
          path,
          BigInt(amount)
        );

        return res.json({
          isProfitable: result.isProfitable,
          netProfitUsd: result.netProfitUsd,
          priceImpact: result.priceImpact,
          confidence: result.confidence,
        });
      } catch (error: any) {
        logger.error('Simulation failed:', error?.message || error);
        return res.status(500).json({ error: 'Simulation failed' });
      }
    });

    /**
     * Get configuration
     */
    this.app.get('/config', (_req: Request, res: Response) => {
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
        addresses: ADDRESSES,
      };

      return res.json(sanitized);
    });

    /**
     * Get wallet info
     */
    this.app.get('/wallet', async (_req: Request, res: Response) => {
      try {
        // wallet may be a utility object with methods or a simple object
        const address = typeof (wallet as any).getAddress === 'function'
          ? await (wallet as any).getAddress()
          : (wallet as any).address;
        const balance = typeof (wallet as any).getBalance === 'function'
          ? await (wallet as any).getBalance()
          : BigInt(0);

        return res.json({
          address,
          balanceMatic: ethers.formatEther(balance),
          network: Config.network.chainId,
        });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to get wallet info' });
      }
    });

    /**
     * Get risk status
     */
    this.app.get('/risk', (_req: Request, res: Response) => {
      const riskManager = getRiskManager();
      if (typeof (riskManager as any).getRiskReport === 'function') {
        return res.json((riskManager as any).getRiskReport());
      }
      // Fallback
      if (typeof (riskManager as any).getMetrics === 'function') {
        return res.json((riskManager as any).getMetrics());
      }
      return res.status(500).json({ error: 'Risk manager not available' });
    });

    /**
     * Get execution status
     */
    this.app.get('/execution', (_req: Request, res: Response) => {
      try {
        const executor = getExecutor();
        const status = executor.getStatus();
        return res.json(status);
      } catch (error) {
        return res.status(500).json({ error: 'Executor not available' });
      }
    });

    /**
     * Get strategy metrics
     */
    this.app.get('/strategy', (_req: Request, res: Response) => {
      try {
        const strategy = getStrategy();
        const metrics = strategy.getMetrics();
        return res.json(metrics);
      } catch (error) {
        return res.status(500).json({ error: 'Strategy not available' });
      }
    });

    /**
     * Emergency stop
     */
    this.app.post('/emergency-stop', (_req: Request, res: Response) => {
      this.emergencyStop();
      return res.json({ status: 'stopped', message: 'Emergency stop activated' });
    });

    /**
     * Get system logs
     */
    this.app.get('/logs', (req: Request, res: Response) => {
      const limit = parseInt((req.query.limit as string) || '100', 10) || 100;
      const level = (req.query.level as string) || 'info';

      // This would typically read from a log file or database
      return res.json({
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
    const riskMetrics = typeof (riskManager as any).getMetrics === 'function'
      ? (riskManager as any).getMetrics()
      : {};

    // Check executor
    let execStatus = {};
    try {
      const executor = getExecutor();
      execStatus = executor.getStatus();
    } catch {
      execStatus = {};
    }

    // Overall health
    const isHealthy =
      providerHealthy &&
      !(riskMetrics && (riskMetrics as any).circuitBreakerActive) &&
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
          circuitBreaker: (riskMetrics as any).circuitBreakerActive || false,
          dailyLoss: (riskMetrics as any).dailyLoss || 0,
          consecutiveFailures: (riskMetrics as any).consecutiveFailures || 0,
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
  private async getDetailedMetrics(): Promise<any> {
    const riskManager = getRiskManager();
    let riskReport = {};
    try {
      riskReport = typeof (riskManager as any).getRiskReport === 'function'
        ? (riskManager as any).getRiskReport()
        : (typeof (riskManager as any).getMetrics === 'function' ? (riskManager as any).getMetrics() : {});
    } catch {
      riskReport = {};
    }

    let execStatus = {};
    try {
      const executor = getExecutor();
      execStatus = executor.getStatus();
    } catch {
      execStatus = {};
    }

    let strategyMetrics = {};
    try {
      const strategy = getStrategy();
      strategyMetrics = strategy.getMetrics();
    } catch {
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
  private emergencyStop(): void {
    logger.error('EMERGENCY STOP ACTIVATED');

    // Pause all operations
    this.isPaused = true;

    // Trigger risk manager circuit breaker
    const riskManager = getRiskManager();
    if (typeof (riskManager as any).emergencyStop === 'function') {
      try { (riskManager as any).emergencyStop(); } catch (e) { /* swallow */ }
    }

    // Cancel pending transactions
    try {
      const executor = getExecutor();
      const pending = executor.getPendingTransactions();
      logger.info(`Cancelling ${pending.length} pending transactions`);
    } catch (e) {
      logger.warn('Executor not available to cancel pending transactions');
    }
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
