import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { Config } from '../config';
import express from 'express';
import winston from 'winston';

const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'metrics' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

/**
 * Metrics Service for Prometheus monitoring
 */
export class MetricsService {
  private register: Registry;
  private app: express.Application;

  // Counters
  private opportunitiesFound: Counter<string>;
  private tradesExecuted: Counter<string>;
  private tradesSuccessful: Counter<string>;
  private tradesFailed: Counter<string>;
  private profitTotal: Counter<string>;
  private lossTotal: Counter<string>;
  private gasSpent: Counter<string>;
  private errorsTotal: Counter<string>;

  // Gauges
  private currentPrice: Gauge<string>;
  private walletBalance: Gauge<string>;
  private exposureByToken: Gauge<string>;
  private circuitBreakerStatus: Gauge<string>;
  private blockLag: Gauge<string>;
  private pendingTransactions: Gauge<string>;
  private riskScore: Gauge<string>;

  // Histograms
  private tradeProfitHistogram: Histogram<string>;
  private executionTimeHistogram: Histogram<string>;
  private gasUsedHistogram: Histogram<string>;
  private priceImpactHistogram: Histogram<string>;
  private simulationTimeHistogram: Histogram<string>;

  constructor() {
    this.register = new Registry();
    this.app = express();

    // Initialize metrics (definite assignment)
    // Counters
    this.opportunitiesFound = new Counter({
      name: 'arb_opportunities_found_total',
      help: 'Total number of arbitrage opportunities found',
      labelNames: ['type', 'dex'],
      registers: [this.register],
    });

    this.tradesExecuted = new Counter({
      name: 'arb_trades_executed_total',
      help: 'Total number of trades executed',
      labelNames: ['type', 'dex', 'status'],
      registers: [this.register],
    });

    this.tradesSuccessful = new Counter({
      name: 'arb_trades_successful_total',
      help: 'Total number of successful trades',
      labelNames: ['type'],
      registers: [this.register],
    });

    this.tradesFailed = new Counter({
      name: 'arb_trades_failed_total',
      help: 'Total number of failed trades',
      labelNames: ['type', 'reason'],
      registers: [this.register],
    });

    this.profitTotal = new Counter({
      name: 'arb_profit_usd_total',
      help: 'Total profit in USD',
      labelNames: ['token'],
      registers: [this.register],
    });

    this.lossTotal = new Counter({
      name: 'arb_loss_usd_total',
      help: 'Total loss in USD',
      labelNames: ['token'],
      registers: [this.register],
    });

    this.gasSpent = new Counter({
      name: 'arb_gas_spent_wei_total',
      help: 'Total gas spent in wei',
      registers: [this.register],
    });

    this.errorsTotal = new Counter({
      name: 'arb_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'severity'],
      registers: [this.register],
    });

    // Gauges
    this.currentPrice = new Gauge({
      name: 'arb_token_price_usd',
      help: 'Current token price in USD',
      labelNames: ['token'],
      registers: [this.register],
    });

    this.walletBalance = new Gauge({
      name: 'arb_wallet_balance',
      help: 'Current wallet balance',
      labelNames: ['token'],
      registers: [this.register],
    });

    this.exposureByToken = new Gauge({
      name: 'arb_exposure_usd',
      help: 'Current exposure in USD by token',
      labelNames: ['token'],
      registers: [this.register],
    });

    this.circuitBreakerStatus = new Gauge({
      name: 'arb_circuit_breaker_status',
      help: 'Circuit breaker status (1 = active, 0 = inactive)',
      registers: [this.register],
    });

    this.blockLag = new Gauge({
      name: 'arb_block_lag',
      help: 'Number of blocks behind the latest',
      registers: [this.register],
    });

    this.pendingTransactions = new Gauge({
      name: 'arb_pending_transactions',
      help: 'Number of pending transactions',
      registers: [this.register],
    });

    this.riskScore = new Gauge({
      name: 'arb_risk_score',
      help: 'Current risk score',
      labelNames: ['type'],
      registers: [this.register],
    });

    // Histograms
    this.tradeProfitHistogram = new Histogram({
      name: 'arb_trade_profit_usd',
      help: 'Trade profit distribution in USD',
      buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000],
      labelNames: ['type'],
      registers: [this.register],
    });

    this.executionTimeHistogram = new Histogram({
      name: 'arb_execution_time_ms',
      help: 'Trade execution time in milliseconds',
      buckets: [100, 250, 500, 1000, 2500, 5000, 10000],
      labelNames: ['type'],
      registers: [this.register],
    });

    this.gasUsedHistogram = new Histogram({
      name: 'arb_gas_used',
      help: 'Gas used per transaction',
      buckets: [100000, 200000, 300000, 500000, 750000, 1000000],
      labelNames: ['type'],
      registers: [this.register],
    });

    this.priceImpactHistogram = new Histogram({
      name: 'arb_price_impact_percent',
      help: 'Price impact percentage',
      buckets: [0.1, 0.5, 1, 2, 3, 5, 10],
      labelNames: ['dex'],
      registers: [this.register],
    });

    this.simulationTimeHistogram = new Histogram({
      name: 'arb_simulation_time_ms',
      help: 'Simulation time in milliseconds',
      buckets: [10, 25, 50, 100, 250, 500, 1000],
      registers: [this.register],
    });

    // Setup endpoints
    this.setupEndpoints();

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.register });
  }

  private setupEndpoints(): void {
    // Metrics endpoint for Prometheus
    this.app.get('/metrics', async (_req, res) => {
      res.set('Content-Type', this.register.contentType);
      return res.send(await this.register.metrics());
    });

    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      return res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Custom dashboard data endpoint
    this.app.get('/dashboard', async (_req, res) => {
      const metrics = await this.getDashboardData();
      return res.json(metrics);
    });
  }

  /**
   * Start metrics server
   */
  start(port?: number): void {
    const metricsPort = port || Config.monitoring.prometheusPort;

    this.app.listen(metricsPort, () => {
      logger.info(`Metrics server started on port ${metricsPort}`);
      logger.info(`Prometheus metrics available at http://localhost:${metricsPort}/metrics`);
    });
  }

  /**
   * Record opportunity found
   */
  recordOpportunity(type: string, dex: string): void {
    this.opportunitiesFound.inc({ type, dex });
  }

  /**
   * Record trade execution
   */
  recordTrade(
    type: string,
    dex: string,
    success: boolean,
    profitUsd: number,
    gasUsed: bigint,
    executionTimeMs: number
  ): void {
    const status = success ? 'success' : 'failed';

    this.tradesExecuted.inc({ type, dex, status });

    if (success) {
      this.tradesSuccessful.inc({ type });

      if (profitUsd > 0) {
        this.profitTotal.inc({ token: 'USD' }, profitUsd);
        this.tradeProfitHistogram.observe({ type }, profitUsd);
      } else {
        this.lossTotal.inc({ token: 'USD' }, Math.abs(profitUsd));
      }
    } else {
      this.tradesFailed.inc({ type, reason: 'execution_failed' });
    }

    this.gasSpent.inc(Number(gasUsed));
    this.gasUsedHistogram.observe({ type }, Number(gasUsed));
    this.executionTimeHistogram.observe({ type }, executionTimeMs);
  }

  /**
   * Record error
   */
  recordError(type: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.errorsTotal.inc({ type, severity });
  }

  /**
   * Update wallet balance
   */
  updateWalletBalance(token: string, balance: number): void {
    this.walletBalance.set({ token }, balance);
  }

  /**
   * Update token price
   */
  updateTokenPrice(token: string, price: number): void {
    this.currentPrice.set({ token }, price);
  }

  /**
   * Update exposure
   */
  updateExposure(token: string, exposureUsd: number): void {
    this.exposureByToken.set({ token }, exposureUsd);
  }

  /**
   * Update circuit breaker status
   */
  updateCircuitBreaker(active: boolean): void {
    this.circuitBreakerStatus.set(active ? 1 : 0);
  }

  /**
   * Update block lag
   */
  updateBlockLag(lag: number): void {
    this.blockLag.set(lag);
  }

  /**
   * Update pending transactions
   */
  updatePendingTransactions(count: number): void {
    this.pendingTransactions.set(count);
  }

  /**
   * Update risk score
   */
  updateRiskScore(type: string, score: number): void {
    this.riskScore.set({ type }, score);
  }

  /**
   * Record price impact
   */
  recordPriceImpact(dex: string, impact: number): void {
    this.priceImpactHistogram.observe({ dex }, impact);
  }

  /**
   * Record simulation time
   */
  recordSimulationTime(timeMs: number): void {
    this.simulationTimeHistogram.observe(timeMs);
  }

  /**
   * Get dashboard data
   */
  private async getDashboardData(): Promise<any> {
    const metrics = await this.register.getMetricsAsJSON();

    // Extract key metrics for dashboard
    const dashboard = {
      summary: {
        totalOpportunities: this.getMetricValue(metrics, 'arb_opportunities_found_total'),
        totalTrades: this.getMetricValue(metrics, 'arb_trades_executed_total'),
        successRate: this.calculateSuccessRate(metrics),
        totalProfit: this.getMetricValue(metrics, 'arb_profit_usd_total'),
        totalLoss: this.getMetricValue(metrics, 'arb_loss_usd_total'),
        netPnL: this.calculateNetPnL(metrics),
      },
      current: {
        circuitBreaker: this.getMetricValue(metrics, 'arb_circuit_breaker_status') === 1,
        blockLag: this.getMetricValue(metrics, 'arb_block_lag'),
        pendingTx: this.getMetricValue(metrics, 'arb_pending_transactions'),
        riskScore: this.getMetricValue(metrics, 'arb_risk_score'),
      },
      performance: {
        avgProfit: this.calculateAvgProfit(metrics),
        avgGasUsed: this.calculateAvgGasUsed(metrics),
        avgExecutionTime: this.calculateAvgExecutionTime(metrics),
      },
      timestamp: new Date().toISOString(),
    };

    return dashboard;
  }

  private getMetricValue(metrics: any[], name: string): number {
    const metric = metrics.find(m => m.name === name);
    if (metric && metric.values && metric.values.length > 0) {
      return metric.values[0].value || 0;
    }
    return 0;
  }

  private calculateSuccessRate(metrics: any[]): number {
    const successful = this.getMetricValue(metrics, 'arb_trades_successful_total');
    const total = this.getMetricValue(metrics, 'arb_trades_executed_total');
    return total > 0 ? (successful / total) * 100 : 0;
  }

  private calculateNetPnL(metrics: any[]): number {
    const profit = this.getMetricValue(metrics, 'arb_profit_usd_total');
    const loss = this.getMetricValue(metrics, 'arb_loss_usd_total');
    return profit - loss;
  }

  private calculateAvgProfit(metrics: any[]): number {
    const histogram = metrics.find(m => m.name === 'arb_trade_profit_usd');
    if (histogram && histogram.values) {
      const sum = histogram.values.reduce((acc: number, v: any) => acc + (v.sum || 0), 0);
      const count = histogram.values.reduce((acc: number, v: any) => acc + (v.count || 0), 0);
      return count > 0 ? sum / count : 0;
    }
    return 0;
  }

  private calculateAvgGasUsed(metrics: any[]): number {
    const histogram = metrics.find(m => m.name === 'arb_gas_used');
    if (histogram && histogram.values) {
      const sum = histogram.values.reduce((acc: number, v: any) => acc + (v.sum || 0), 0);
      const count = histogram.values.reduce((acc: number, v: any) => acc + (v.count || 0), 0);
      return count > 0 ? sum / count : 0;
    }
    return 0;
  }

  private calculateAvgExecutionTime(metrics: any[]): number {
    const histogram = metrics.find(m => m.name === 'arb_execution_time_ms');
    if (histogram && histogram.values) {
      const sum = histogram.values.reduce((acc: number, v: any) => acc + (v.sum || 0), 0);
      const count = histogram.values.reduce((acc: number, v: any) => acc + (v.count || 0), 0);
      return count > 0 ? sum / count : 0;
    }
    return 0;
  }
}

// Singleton instance
let metricsService: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!metricsService) {
    metricsService = new MetricsService();
  }
  return metricsService;
}
