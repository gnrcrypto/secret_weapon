import { Config } from '../config';
import { SimulationResult, getSimulator } from './simulator';
import { getPriceOracle } from '../adapters/priceOracleAdapter';
import {
  toWei,
  fromWei,
  tokenAmountToUsd,
  usdToTokenAmount
} from '../utils/math';
import winston from 'winston';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'strategy' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Strategy constraints
export interface StrategyConstraints {
  minProfitUsd: number;
  maxTradeUsd: number;
  maxPriceImpact: number;
  minConfidence: number;
  maxGasPrice: bigint;
  maxConcurrentTrades: number;
  requiredLiquidity: bigint;
}

// Opportunity ranking
export interface RankedOpportunity {
  simulation: SimulationResult;
  score: number;
  rank: number;
  executionPriority: 'high' | 'medium' | 'low';
  estimatedExecutionTime: number;
  riskLevel: 'low' | 'medium' | 'high';
}

// Strategy metrics
export interface StrategyMetrics {
  opportunitiesEvaluated: number;
  opportunitiesSelected: number;
  averageProfitUsd: number;
  averageConfidence: number;
  rejectionReasons: Map<string, number>;
}

/**
 * Arbitrage Strategy Engine
 */
export class Strategy {
  private metrics: StrategyMetrics = {
    opportunitiesEvaluated: 0,
    opportunitiesSelected: 0,
    averageProfitUsd: 0,
    averageConfidence: 0,
    rejectionReasons: new Map(),
  };
  private constraints: StrategyConstraints;
  private activeTrades: Set<string> = new Set();

  constructor() {
    this.constraints = this.loadConstraints();
    this.resetMetrics();
  }

  /**
   * Load strategy constraints from config
   */
  private loadConstraints(): StrategyConstraints {
    return {
      minProfitUsd: Config.execution.minProfitThresholdUsd,
      maxTradeUsd: Config.execution.maxTradeSizeUsd,
      maxPriceImpact: 5, // 5% max
      minConfidence: 0.6,
      maxGasPrice: toWei(Config.gas.maxGasGwei, 9),
      maxConcurrentTrades: 3,
      requiredLiquidity: toWei('1000', 18), // Minimum liquidity in pools
    };
  }

  /**
   * Reset metrics
   */
  private resetMetrics(): void {
    this.metrics = {
      opportunitiesEvaluated: 0,
      opportunitiesSelected: 0,
      averageProfitUsd: 0,
      averageConfidence: 0,
      rejectionReasons: new Map(),
    };
  }

  /**
   * Check if opportunity is profitable
   */
  isOpportunityProfitable(simulation: SimulationResult): boolean {
    this.metrics.opportunitiesEvaluated++;

    // Basic profitability check
    if (!simulation.isProfitable) {
      this.recordRejection('not_profitable');
      return false;
    }

    // Check constraints
    if (simulation.netProfitUsd < this.constraints.minProfitUsd) {
      this.recordRejection('below_min_profit');
      return false;
    }

    if (simulation.priceImpact > this.constraints.maxPriceImpact) {
      this.recordRejection('price_impact_too_high');
      return false;
    }

    if (simulation.confidence < this.constraints.minConfidence) {
      this.recordRejection('low_confidence');
      return false;
    }

    // Check gas price
    const simulator = getSimulator();
    if (simulator.getGasPrice() > this.constraints.maxGasPrice) {
      this.recordRejection('gas_too_expensive');
      return false;
    }

    // Check for duplicate trades
    const pathId = simulation.path.id;
    if (this.activeTrades.has(pathId)) {
      this.recordRejection('trade_already_active');
      return false;
    }

    // Check concurrent trade limit
    if (this.activeTrades.size >= this.constraints.maxConcurrentTrades) {
      this.recordRejection('max_concurrent_trades');
      return false;
    }

    this.metrics.opportunitiesSelected++;
    return true;
  }

  /**
   * Select top opportunities from simulations
   */
  async selectTopOpportunities(
    simulations: SimulationResult[],
    additionalConstraints?: Partial<StrategyConstraints>
  ): Promise<RankedOpportunity[]> {
    // Merge constraints
    const constraints = { ...this.constraints, ...additionalConstraints };

    // Filter profitable opportunities
    const profitable = simulations.filter(sim => this.isOpportunityProfitable(sim));

    // Rank opportunities
    const ranked = await this.rankOpportunities(profitable);

    // Apply position sizing
    const sized = await this.applyPositionSizing(ranked);

    // Filter by constraints - get oracle for token pricing
    const oracle = getPriceOracle();
    const filteredPromises = sized.map(async (opp) => {
      const token = opp.simulation.path.tokens[0];
      const tokenPrice = await oracle.getTokenPriceUSD(token.address) || 1;
      const tradeUsd = tokenAmountToUsd(
        opp.simulation.inputAmount,
        tokenPrice,
        token.decimals
      );

      return tradeUsd <= constraints.maxTradeUsd ? opp : null;
    });

    const filteredResults = await Promise.all(filteredPromises);
    const filtered = filteredResults.filter((opp): opp is RankedOpportunity => opp !== null);

    // Sort by score
    filtered.sort((a, b) => b.score - a.score);

    // Take top opportunities
    const maxOpportunities = Math.min(
      constraints.maxConcurrentTrades - this.activeTrades.size,
      filtered.length
    );

    const selected = filtered.slice(0, maxOpportunities);

    // Update metrics
    this.updateMetrics(selected);

    logger.info(`Selected ${selected.length} opportunities from ${simulations.length} simulations`);

    return selected;
  }

  /**
   * Rank opportunities by multiple factors
   */
  private async rankOpportunities(
    simulations: SimulationResult[]
  ): Promise<RankedOpportunity[]> {
    return Promise.all(
      simulations.map(async (sim, index) => {
        // Calculate base score from profit
        let score = sim.netProfitUsd;

        // Weight by confidence
        score *= sim.confidence;

        // Penalize high price impact
        score *= (1 - sim.priceImpact / 100);

        // Bonus for low gas cost ratio
        const gasCostRatio = parseFloat(fromWei(sim.gasCost)) / parseFloat(fromWei(sim.grossProfit));
        score *= (1 + (1 - gasCostRatio));

        // Determine execution priority
        let executionPriority: 'high' | 'medium' | 'low' = 'medium';
        if (sim.netProfitUsd > 100 && sim.confidence > 0.8) {
          executionPriority = 'high';
        } else if (sim.netProfitUsd < 20 || sim.confidence < 0.6) {
          executionPriority = 'low';
        }

        // Estimate execution time (in blocks)
        const estimatedExecutionTime = sim.path.type === 'triangular' ? 3 : 2;

        // Determine risk level
        let riskLevel: 'low' | 'medium' | 'high' = 'medium';
        if (sim.priceImpact < 1 && sim.confidence > 0.8) {
          riskLevel = 'low';
        } else if (sim.priceImpact > 3 || sim.confidence < 0.6) {
          riskLevel = 'high';
        }

        return {
          simulation: sim,
          score,
          rank: index + 1,
          executionPriority,
          estimatedExecutionTime,
          riskLevel,
        };
      })
    );
  }

  /**
   * Apply position sizing based on risk
   */
  private async applyPositionSizing(
    opportunities: RankedOpportunity[]
  ): Promise<RankedOpportunity[]> {
    const oracle = getPriceOracle();

    for (const opp of opportunities) {
      const sim = opp.simulation;
      const token = sim.path.tokens[0];

      // Get token price
      const tokenPrice = await oracle.getTokenPriceUSD(token.address) || 1;

      // Calculate current trade size in USD
      const currentTradeUsd = tokenAmountToUsd(
        opp.simulation.inputAmount,
        tokenPrice,
        token.decimals
      );

      // Apply Kelly Criterion for optimal sizing
      const kellyFraction = this.calculateKellyFraction(
        sim.confidence,
        sim.netProfitUsd / currentTradeUsd
      );

      // Apply position limits
      let targetTradeUsd = currentTradeUsd * kellyFraction;
      targetTradeUsd = Math.min(targetTradeUsd, this.constraints.maxTradeUsd);
      targetTradeUsd = Math.max(targetTradeUsd, 100); // Minimum trade size

      // Adjust based on risk level
      if (opp.riskLevel === 'high') {
        targetTradeUsd *= 0.5;
      } else if (opp.riskLevel === 'low') {
        targetTradeUsd *= 1.2;
      }

      // Convert back to token amount
      const newInputAmount = usdToTokenAmount(
        targetTradeUsd,
        tokenPrice,
        token.decimals
      );

      // Update simulation with new amount if changed
      if (newInputAmount !== sim.inputAmount) {
        logger.debug(`Resizing trade from ${fromWei(sim.inputAmount, token.decimals)} to ${fromWei(newInputAmount, token.decimals)} ${token.symbol}`);

        // Re-simulate with new amount
        const simulator = getSimulator();
        const newSim = await simulator.simulatePathOnChain(
          sim.path,
          newInputAmount,
          Config.execution.slippageBps
        );

        opp.simulation = newSim;
      }
    }

    return opportunities;
  }

  /**
   * Calculate Kelly fraction for position sizing
   */
  private calculateKellyFraction(winProbability: number, profitRatio: number): number {
    // Kelly formula: f = (p * b - q) / b
    // where p = win probability, q = loss probability, b = profit ratio
    const q = 1 - winProbability;
    const b = profitRatio;

    const kellyFraction = (winProbability * b - q) / b;

    // Apply Kelly reduction factor for safety (typically 0.25 to 0.5)
    const safetyFactor = 0.3;

    return Math.max(0, Math.min(1, kellyFraction * safetyFactor));
  }

  /**
   * Check if should execute opportunity
   */
  shouldExecute(opportunity: RankedOpportunity): boolean {
    // Final checks before execution

    // Check if still profitable
    if (!opportunity.simulation.isProfitable) {
      logger.warn('Opportunity no longer profitable');
      return false;
    }

    // Check market conditions haven't changed dramatically
    if (opportunity.simulation.confidence < 0.5) {
      logger.warn('Confidence dropped below threshold');
      return false;
    }

    // Check risk management rules
    if (opportunity.riskLevel === 'high' && this.activeTrades.size > 0) {
      logger.warn('Skipping high-risk trade due to existing positions');
      return false;
    }

    // Check daily limits
    const dailyPnL = this.getDailyPnL();
    if (dailyPnL < -Config.risk.dailyLossLimitUsd) {
      logger.error('Daily loss limit reached');
      return false;
    }

    return true;
  }

  /**
   * Register trade execution
   */
  registerTradeExecution(pathId: string): void {
    this.activeTrades.add(pathId);
    logger.info(`Registered active trade: ${pathId}`);
  }

  /**
   * Unregister trade completion
   */
  unregisterTrade(pathId: string): void {
    this.activeTrades.delete(pathId);
    logger.info(`Unregistered trade: ${pathId}`);
  }

  /**
   * Get strategy metrics
   */
  getMetrics(): StrategyMetrics {
    return { ...this.metrics };
  }

  /**
   * Record rejection reason
   */
  private recordRejection(reason: string): void {
    const count = this.metrics.rejectionReasons.get(reason) || 0;
    this.metrics.rejectionReasons.set(reason, count + 1);
  }

  /**
   * Update metrics with selected opportunities
   */
  private updateMetrics(opportunities: RankedOpportunity[]): void {
    if (opportunities.length === 0) return;

    const totalProfit = opportunities.reduce((sum, opp) => sum + opp.simulation.netProfitUsd, 0);
    const totalConfidence = opportunities.reduce((sum, opp) => sum + opp.simulation.confidence, 0);

    this.metrics.averageProfitUsd = totalProfit / opportunities.length;
    this.metrics.averageConfidence = totalConfidence / opportunities.length;
  }

  /**
   * Get daily PnL (placeholder - should connect to ledger)
   */
  private getDailyPnL(): number {
    // TODO: Implement actual PnL tracking from ledger
    return 0;
  }

  /**
   * Adjust strategy based on market conditions
   */
  async adjustForMarketConditions(): Promise<void> {
    const simulator = getSimulator();
    const gasPrice = simulator.getGasPrice();
    const gasPriceGwei = parseFloat(fromWei(gasPrice, 9));

    // Adjust minimum profit based on gas price
    if (gasPriceGwei > 100) {
      this.constraints.minProfitUsd = Config.execution.minProfitThresholdUsd * 2;
      logger.info(`High gas detected (${gasPriceGwei} Gwei), increased min profit to $${this.constraints.minProfitUsd}`);
    } else if (gasPriceGwei < 30) {
      this.constraints.minProfitUsd = Config.execution.minProfitThresholdUsd * 0.7;
      logger.info(`Low gas detected (${gasPriceGwei} Gwei), decreased min profit to $${this.constraints.minProfitUsd}`);
    }

    // Adjust for volatility (simplified - could use actual volatility metrics)
    const recentFailures = this.metrics.rejectionReasons.get('price_impact_too_high') || 0;
    if (recentFailures > 10) {
      this.constraints.maxPriceImpact = 3; // Reduce from 5% to 3%
      logger.info('High volatility detected, reduced max price impact to 3%');
    }
  }
}

// Export singleton instance
let strategy: Strategy | null = null;

export function getStrategy(): Strategy {
  if (!strategy) {
    strategy = new Strategy();
  }
  return strategy;
}
