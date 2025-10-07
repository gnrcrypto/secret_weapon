import { Config } from '../config';
import { RankedOpportunity } from '../arb/strategy';
import { ExecutionResult } from '../exec/executor';
import { getPriceOracle } from '../adapters/priceOracleAdapter';
import { fromWei, toWei, tokenAmountToUsd } from '../utils/math';
import winston from 'winston';
import { EventEmitter } from 'events';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'risk-manager' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Risk events
export interface RiskEvents {
  'circuit-breaker-triggered': (reason: string) => void;
  'daily-limit-reached': (limitType: string, current: number, limit: number) => void;
  'high-risk-detected': (riskType: string, details: any) => void;
  'risk-check-passed': (opportunityId: string) => void;
  'risk-check-failed': (opportunityId: string, reasons: string[]) => void;
}

// Risk metrics
export interface RiskMetrics {
  dailyLoss: number;
  dailyProfit: number;
  dailyTrades: number;
  consecutiveFailures: number;
  totalExposureUsd: number;
  tokenExposures: Map<string, number>;
  gasSpentToday: bigint;
  highestRiskScore: number;
  circuitBreakerActive: boolean;
  lastCircuitBreakerTime: number;
}

// Risk limits
export interface RiskLimits {
  maxDailyLossUsd: number;
  maxConsecutiveFailures: number;
  maxExposurePerToken: number;
  maxTotalExposure: number;
  maxDailyTrades: number;
  maxGasPerDay: bigint;
  maxPriceImpact: number;
  minLiquidity: bigint;
  maxSlippage: number;
}

// Position tracking
export interface Position {
  token: string;
  amount: bigint;
  valueUsd: number;
  entryPrice: number;
  timestamp: number;
  dex: string;
}

// Risk score calculation
export interface RiskScore {
  total: number;
  components: {
    market: number;
    liquidity: number;
    concentration: number;
    historical: number;
    technical: number;
  };
  rating: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Risk Manager - Protects capital and prevents catastrophic losses
 */
export class RiskManager extends EventEmitter {
  private metrics: RiskMetrics;
  private limits: RiskLimits;
  private positions: Map<string, Position> = new Map();
  private tradeHistory: ExecutionResult[] = [];
  private circuitBreakerResetTimer: NodeJS.Timeout | null = null;
  private dailyResetTimer: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    this.metrics = this.initializeMetrics();
    this.limits = this.loadLimits();
    this.startDailyReset();
  }
  
  /**
   * Initialize risk metrics
   */
  private initializeMetrics(): RiskMetrics {
    return {
      dailyLoss: 0,
      dailyProfit: 0,
      dailyTrades: 0,
      consecutiveFailures: 0,
      totalExposureUsd: 0,
      tokenExposures: new Map(),
      gasSpentToday: BigInt(0),
      highestRiskScore: 0,
      circuitBreakerActive: false,
      lastCircuitBreakerTime: 0,
    };
  }
  
  /**
   * Load risk limits from configuration
   */
  private loadLimits(): RiskLimits {
    return {
      maxDailyLossUsd: Config.risk.dailyLossLimitUsd,
      maxConsecutiveFailures: Config.risk.maxConsecutiveFailures,
      maxExposurePerToken: Config.execution.maxTradeSizeUsd,
      maxTotalExposure: Config.execution.maxPositionSizeUsd,
      maxDailyTrades: 100, // Default limit
      maxGasPerDay: toWei('100', 18), // 100 MATIC default
      maxPriceImpact: 5, // 5% max
      minLiquidity: toWei('10000', 18), // $10k minimum liquidity
      maxSlippage: 100, // 1% max slippage
    };
  }
  
  /**
   * Pre-trade risk check
   */
  async checkRisk(opportunity: RankedOpportunity): Promise<{
    allowed: boolean;
    reasons: string[];
    riskScore: RiskScore;
  }> {
    const reasons: string[] = [];
    
    // Check if circuit breaker is active
    if (this.metrics.circuitBreakerActive) {
      const timeRemaining = this.getCircuitBreakerTimeRemaining();
      reasons.push(`Circuit breaker active (${timeRemaining}s remaining)`);
      return { allowed: false, reasons, riskScore: this.calculateRiskScore(opportunity) };
    }
    
    // Check daily loss limit
    if (this.metrics.dailyLoss >= this.limits.maxDailyLossUsd) {
      reasons.push(`Daily loss limit reached: $${this.metrics.dailyLoss.toFixed(2)}`);
      this.triggerCircuitBreaker('daily_loss_limit');
    }
    
    // Check consecutive failures
    if (this.metrics.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
      reasons.push(`Max consecutive failures reached: ${this.metrics.consecutiveFailures}`);
      this.triggerCircuitBreaker('consecutive_failures');
    }
    
    // Check daily trade limit
    if (this.metrics.dailyTrades >= this.limits.maxDailyTrades) {
      reasons.push(`Daily trade limit reached: ${this.metrics.dailyTrades}`);
    }
    
    // Check exposure limits
    const exposureCheck = await this.checkExposureLimits(opportunity);
    if (!exposureCheck.allowed) {
      reasons.push(...exposureCheck.reasons);
    }
    
    // Check market conditions
    const marketCheck = await this.checkMarketConditions(opportunity);
    if (!marketCheck.allowed) {
      reasons.push(...marketCheck.reasons);
    }
    
    // Check liquidity
    const liquidityCheck = await this.checkLiquidity(opportunity);
    if (!liquidityCheck.allowed) {
      reasons.push(...liquidityCheck.reasons);
    }
    
    // Calculate risk score
    const riskScore = this.calculateRiskScore(opportunity);
    
    // Block critical risk trades
    if (riskScore.rating === 'critical') {
      reasons.push(`Risk score too high: ${riskScore.total.toFixed(2)} (critical)`);
    }
    
    // Update highest risk score
    if (riskScore.total > this.metrics.highestRiskScore) {
      this.metrics.highestRiskScore = riskScore.total;
    }
    
    const allowed = reasons.length === 0;
    
    // Emit events
    if (allowed) {
      this.emit('risk-check-passed', opportunity.simulation.path.id);
    } else {
      this.emit('risk-check-failed', opportunity.simulation.path.id, reasons);
      logger.warn(`Risk check failed for ${opportunity.simulation.path.id}: ${reasons.join(', ')}`);
    }
    
    return { allowed, reasons, riskScore };
  }
  
  /**
   * Check exposure limits
   */
  private async checkExposureLimits(opportunity: RankedOpportunity): Promise<{
    allowed: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];
    const simulation = opportunity.simulation;
    const token = simulation.path.tokens[0];
    
    // Calculate trade value in USD
    const oracle = getPriceOracle();
    const tokenPrice = await oracle.getTokenPriceUSD(token.address) || 0;
    const tradeValueUsd = tokenAmountToUsd(
      simulation.inputAmount,
      tokenPrice,
      token.decimals
    );
    
    // Check per-token exposure
    const currentTokenExposure = this.metrics.tokenExposures.get(token.address) || 0;
    if (currentTokenExposure + tradeValueUsd > this.limits.maxExposurePerToken) {
      reasons.push(`Token exposure limit exceeded for ${token.symbol}: $${(currentTokenExposure + tradeValueUsd).toFixed(2)}`);
    }
    
    // Check total exposure
    if (this.metrics.totalExposureUsd + tradeValueUsd > this.limits.maxTotalExposure) {
      reasons.push(`Total exposure limit exceeded: $${(this.metrics.totalExposureUsd + tradeValueUsd).toFixed(2)}`);
    }
    
    // Check concentration risk
    const concentrationRatio = (currentTokenExposure + tradeValueUsd) / this.limits.maxTotalExposure;
    if (concentrationRatio > 0.3) { // No more than 30% in one token
      reasons.push(`Concentration risk too high for ${token.symbol}: ${(concentrationRatio * 100).toFixed(1)}%`);
    }
    
    return { allowed: reasons.length === 0, reasons };
  }
  
  /**
   * Check market conditions
   */
  private async checkMarketConditions(opportunity: RankedOpportunity): Promise<{
    allowed: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];
    const simulation = opportunity.simulation;
    
    // Check price impact
    if (simulation.priceImpact > this.limits.maxPriceImpact) {
      reasons.push(`Price impact too high: ${simulation.priceImpact.toFixed(2)}%`);
    }
    
    // Check slippage
    const slippageBps = simulation.slippage * 100;
    if (slippageBps > this.limits.maxSlippage) {
      reasons.push(`Slippage too high: ${simulation.slippage.toFixed(2)}%`);
    }
    
    // Check gas costs
    const gasRatio = parseFloat(fromWei(simulation.gasCost)) / parseFloat(fromWei(simulation.grossProfit));
    if (gasRatio > 0.5) { // Gas shouldn't be more than 50% of profit
      reasons.push(`Gas cost ratio too high: ${(gasRatio * 100).toFixed(1)}%`);
    }
    
    // Check for volatility spikes
    const volatilityCheck = await this.checkVolatility();
    if (volatilityCheck.isHigh) {
      reasons.push(`Market volatility too high: ${volatilityCheck.level}`);
    }
    
    return { allowed: reasons.length === 0, reasons };
  }
  
  /**
   * Check liquidity conditions
   */
  private async checkLiquidity(opportunity: RankedOpportunity): Promise<{
    allowed: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];
    const path = opportunity.simulation.path;
    
    // Check minimum liquidity in pools
    for (const pair of path.pairs || []) {
      const totalLiquidity = (pair.reserveA || BigInt(0)) + (pair.reserveB || BigInt(0));
      
      if (totalLiquidity < this.limits.minLiquidity) {
        reasons.push(`Insufficient liquidity in ${pair.dexName}: ${fromWei(totalLiquidity)}`);
      }
    }
    
    // Check for liquidity imbalance
    if (path.pairs && path.pairs.length > 0) {
      const pair = path.pairs[0];
      if (pair.reserveA && pair.reserveB) {
        const ratio = Number(pair.reserveA) / Number(pair.reserveB);
        if (ratio > 10 || ratio < 0.1) {
          reasons.push(`Liquidity imbalance detected: ${ratio.toFixed(2)}`);
        }
      }
    }
    
    return { allowed: reasons.length === 0, reasons };
  }
  
  /**
   * Calculate comprehensive risk score
   */
  private calculateRiskScore(opportunity: RankedOpportunity): RiskScore {
    const simulation = opportunity.simulation;
    
    // Market risk (price impact, slippage)
    const marketRisk = Math.min(100, 
      (simulation.priceImpact * 10) + 
      (simulation.slippage * 100)
    );
    
    // Liquidity risk
    const liquidityRisk = simulation.path.pairs 
      ? Math.min(100, 100 - (simulation.confidence * 100))
      : 50;
    
    // Concentration risk
    const concentrationRisk = (this.metrics.totalExposureUsd / this.limits.maxTotalExposure) * 100;
    
    // Historical risk (based on recent failures)
    const historicalRisk = Math.min(100,
      (this.metrics.consecutiveFailures * 20) +
      (this.metrics.dailyLoss / this.limits.maxDailyLossUsd * 50)
    );
    
    // Technical risk (gas costs, complexity)
    const gasRatio = parseFloat(fromWei(simulation.gasCost)) / parseFloat(fromWei(simulation.grossProfit));
    const technicalRisk = Math.min(100, gasRatio * 100);
    
    // Calculate total risk score (weighted average)
    const total = (
      marketRisk * 0.3 +
      liquidityRisk * 0.2 +
      concentrationRisk * 0.2 +
      historicalRisk * 0.2 +
      technicalRisk * 0.1
    );
    
    // Determine rating
    let rating: 'low' | 'medium' | 'high' | 'critical';
    if (total < 25) rating = 'low';
    else if (total < 50) rating = 'medium';
    else if (total < 75) rating = 'high';
    else rating = 'critical';
    
    return {
      total,
      components: {
        market: marketRisk,
        liquidity: liquidityRisk,
        concentration: concentrationRisk,
        historical: historicalRisk,
        technical: technicalRisk,
      },
      rating,
    };
  }
  
  /**
   * Post-trade risk update
   */
  async updatePostTrade(result: ExecutionResult, opportunity: RankedOpportunity): Promise<void> {
    this.tradeHistory.push(result);
    this.metrics.dailyTrades++;
    
    if (result.success) {
      // Update profit metrics
      const profitUsd = tokenAmountToUsd(
        result.actualProfit || BigInt(0),
        await this.getTokenPrice(opportunity.simulation.path.tokens[0].address),
        opportunity.simulation.path.tokens[0].decimals
      );
      
      this.metrics.dailyProfit += profitUsd;
      this.metrics.consecutiveFailures = 0; // Reset on success
      
      // Update position
      this.updatePosition(opportunity, true);
      
      logger.info(`Trade successful - Profit: $${profitUsd.toFixed(2)}, Daily P&L: $${(this.metrics.dailyProfit - this.metrics.dailyLoss).toFixed(2)}`);
    } else {
      // Update loss metrics
      this.metrics.consecutiveFailures++;
      
      // Estimate loss (gas costs at minimum)
      const lossUsd = tokenAmountToUsd(
        result.gasUsed || BigInt(0),
        0.8, // Approximate MATIC price
        18
      );
      
      this.metrics.dailyLoss += lossUsd;
      
      // Update position
      this.updatePosition(opportunity, false);
      
      logger.warn(`Trade failed - Loss: $${lossUsd.toFixed(2)}, Consecutive failures: ${this.metrics.consecutiveFailures}`);
      
      // Check if we need to trigger circuit breaker
      if (this.metrics.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
        this.triggerCircuitBreaker('consecutive_failures_post_trade');
      }
    }
    
    // Update gas spent
    if (result.gasUsed) {
      this.metrics.gasSpentToday += result.gasUsed * (result.effectiveGasPrice || BigInt(0));
    }
    
    // Check daily gas limit
    if (this.metrics.gasSpentToday > this.limits.maxGasPerDay) {
      logger.error('Daily gas limit exceeded');
      this.triggerCircuitBreaker('gas_limit_exceeded');
    }
  }
  
  /**
   * Update position tracking
   */
  private async updatePosition(opportunity: RankedOpportunity, success: boolean): Promise<void> {
    const token = opportunity.simulation.path.tokens[0];
    const tokenPrice = await this.getTokenPrice(token.address);
    
    if (success) {
      const position: Position = {
        token: token.address,
        amount: opportunity.simulation.inputAmount,
        valueUsd: tokenAmountToUsd(
          opportunity.simulation.inputAmount,
          tokenPrice,
          token.decimals
        ),
        entryPrice: tokenPrice,
        timestamp: Date.now(),
        dex: opportunity.simulation.path.dexes[0],
      };
      
      this.positions.set(token.address, position);
      
      // Update exposures
      const currentExposure = this.metrics.tokenExposures.get(token.address) || 0;
      this.metrics.tokenExposures.set(token.address, currentExposure + position.valueUsd);
      this.metrics.totalExposureUsd = Array.from(this.metrics.tokenExposures.values())
        .reduce((sum, exp) => sum + exp, 0);
    } else {
      // Reduce exposure on failure
      const currentExposure = this.metrics.tokenExposures.get(token.address) || 0;
      const tradeValue = tokenAmountToUsd(
        opportunity.simulation.inputAmount,
        tokenPrice,
        token.decimals
      );
      
      this.metrics.tokenExposures.set(
        token.address,
        Math.max(0, currentExposure - tradeValue)
      );
      
      this.metrics.totalExposureUsd = Array.from(this.metrics.tokenExposures.values())
        .reduce((sum, exp) => sum + exp, 0);
    }
  }
  
  /**
   * Trigger circuit breaker
   */
  triggerCircuitBreaker(reason: string): void {
    if (this.metrics.circuitBreakerActive) {
      logger.warn('Circuit breaker already active');
      return;
    }
    
    logger.error(`CIRCUIT BREAKER TRIGGERED: ${reason}`);
    this.metrics.circuitBreakerActive = true;
    this.metrics.lastCircuitBreakerTime = Date.now();
    
    // Emit event
    this.emit('circuit-breaker-triggered', reason);
    
    // Set automatic reset timer
    const cooldownMs = Config.risk.circuitBreakerCooldownMs;
    this.circuitBreakerResetTimer = setTimeout(() => {
      this.resetCircuitBreaker();
    }, cooldownMs);
    
    logger.info(`Circuit breaker will reset in ${cooldownMs / 1000} seconds`);
  }
  
  /**
   * Reset circuit breaker
   */
  private resetCircuitBreaker(): void {
    logger.info('Circuit breaker reset');
    this.metrics.circuitBreakerActive = false;
    this.metrics.consecutiveFailures = 0;
    
    if (this.circuitBreakerResetTimer) {
      clearTimeout(this.circuitBreakerResetTimer);
      this.circuitBreakerResetTimer = null;
    }
  }
  
  /**
   * Get circuit breaker time remaining
   */
  private getCircuitBreakerTimeRemaining(): number {
    if (!this.metrics.circuitBreakerActive) return 0;
    
    const elapsed = Date.now() - this.metrics.lastCircuitBreakerTime;
    const remaining = Config.risk.circuitBreakerCooldownMs - elapsed;
    
    return Math.max(0, Math.ceil(remaining / 1000));
  }
  
  /**
   * Check market volatility
   */
  private async checkVolatility(): Promise<{ isHigh: boolean; level: string }> {
    // Simplified volatility check - in production, use actual volatility indicators
    const recentFailureRate = this.metrics.dailyTrades > 0
      ? (this.metrics.consecutiveFailures / this.metrics.dailyTrades) * 100
      : 0;
    
    if (recentFailureRate > 50) {
      return { isHigh: true, level: 'extreme' };
    } else if (recentFailureRate > 30) {
      return { isHigh: true, level: 'high' };
    } else if (recentFailureRate > 15) {
      return { isHigh: false, level: 'moderate' };
    } else {
      return { isHigh: false, level: 'low' };
    }
  }
  
  /**
   * Get token price
   */
  private async getTokenPrice(tokenAddress: string): Promise<number> {
    const oracle = getPriceOracle();
    return await oracle.getTokenPriceUSD(tokenAddress) || 0;
  }
  
  /**
   * Start daily reset timer
   */
  private startDailyReset(): void {
    // Calculate time until midnight UTC
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    // Set timer for midnight reset
    setTimeout(() => {
      this.resetDailyMetrics();
      // Then reset every 24 hours
      this.dailyResetTimer = setInterval(() => {
        this.resetDailyMetrics();
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
    
    logger.info(`Daily metrics will reset in ${(msUntilMidnight / 1000 / 60).toFixed(0)} minutes`);
  }
  
  /**
   * Reset daily metrics
   */
  private resetDailyMetrics(): void {
    logger.info('Resetting daily risk metrics');
    
    const previousPnL = this.metrics.dailyProfit - this.metrics.dailyLoss;
    
    this.metrics.dailyLoss = 0;
    this.metrics.dailyProfit = 0;
    this.metrics.dailyTrades = 0;
    this.metrics.gasSpentToday = BigInt(0);
    
    // Keep consecutive failures and circuit breaker state
    
    logger.info(`Previous day P&L: $${previousPnL.toFixed(2)}`);
  }
  
  /**
   * Get current risk metrics
   */
  getMetrics(): RiskMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get risk limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }
  
  /**
   * Update risk limits (admin only)
   */
  updateLimits(newLimits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    logger.info('Risk limits updated:', this.limits);
  }
  
  /**
   * Emergency stop - trigger circuit breaker immediately
   */
  emergencyStop(): void {
    logger.error('EMERGENCY STOP ACTIVATED');
    this.triggerCircuitBreaker('emergency_stop');
  }
  
  /**
   * Get risk report
   */
  getRiskReport(): object {
    const netPnL = this.metrics.dailyProfit - this.metrics.dailyLoss;
    const winRate = this.metrics.dailyTrades > 0
      ? ((this.metrics.dailyTrades - this.metrics.consecutiveFailures) / this.metrics.dailyTrades * 100)
      : 0;
    
    return {
      summary: {
        circuitBreakerActive: this.metrics.circuitBreakerActive,
        dailyPnL: netPnL.toFixed(2),
        dailyTrades: this.metrics.dailyTrades,
        winRate: winRate.toFixed(1) + '%',
        consecutiveFailures: this.metrics.consecutiveFailures,
        highestRiskScore: this.metrics.highestRiskScore.toFixed(1),
      },
      exposures: {
        total: this.metrics.totalExposureUsd.toFixed(2),
        byToken: Object.fromEntries(
          Array.from(this.metrics.tokenExposures.entries()).map(([k, v]) => [k, v.toFixed(2)])
        ),
      },
      limits: {
        maxDailyLossUsd: this.limits.maxDailyLossUsd,
        maxConsecutiveFailures: this.limits.maxConsecutiveFailures,
        maxExposurePerToken: this.limits.maxExposurePerToken,
        maxTotalExposure: this.limits.maxTotalExposure,
        maxDailyTrades: this.limits.maxDailyTrades,
        maxGasPerDay: this.limits.maxGasPerDay.toString(), // Convert BigInt to string
        maxPriceImpact: this.limits.maxPriceImpact,
        minLiquidity: this.limits.minLiquidity.toString(), // Convert BigInt to string
        maxSlippage: this.limits.maxSlippage,
      },
      positions: Array.from(this.positions.values()).map(p => ({
        ...p,
        amount: p.amount.toString(), // Convert BigInt to string
      })),
      gasSpent: {
        wei: this.metrics.gasSpentToday.toString(), // Convert BigInt to string
        matic: fromWei(this.metrics.gasSpentToday, 18),
      },
    };
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    if (this.circuitBreakerResetTimer) {
      clearTimeout(this.circuitBreakerResetTimer);
    }
    if (this.dailyResetTimer) {
      clearInterval(this.dailyResetTimer);
    }
  }
}

// Singleton instance
let riskManager: RiskManager | null = null;

export function getRiskManager(): RiskManager {
  if (!riskManager) {
    riskManager = new RiskManager();
  }
  return riskManager;
}
