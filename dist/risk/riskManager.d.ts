import { RankedOpportunity } from '../arb/strategy';
import { ExecutionResult } from '../exec/executor';
import { EventEmitter } from 'events';
export interface RiskEvents {
    'circuit-breaker-triggered': (reason: string) => void;
    'daily-limit-reached': (limitType: string, current: number, limit: number) => void;
    'high-risk-detected': (riskType: string, details: any) => void;
    'risk-check-passed': (opportunityId: string) => void;
    'risk-check-failed': (opportunityId: string, reasons: string[]) => void;
}
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
export interface Position {
    token: string;
    amount: bigint;
    valueUsd: number;
    entryPrice: number;
    timestamp: number;
    dex: string;
}
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
export declare class RiskManager extends EventEmitter {
    private metrics;
    private limits;
    private positions;
    private tradeHistory;
    private circuitBreakerResetTimer;
    private dailyResetTimer;
    constructor();
    /**
     * Initialize risk metrics
     */
    private initializeMetrics;
    /**
     * Load risk limits from configuration
     */
    private loadLimits;
    /**
     * Pre-trade risk check
     */
    checkRisk(opportunity: RankedOpportunity): Promise<{
        allowed: boolean;
        reasons: string[];
        riskScore: RiskScore;
    }>;
    /**
     * Check exposure limits
     */
    private checkExposureLimits;
    /**
     * Check market conditions
     */
    private checkMarketConditions;
    /**
     * Check liquidity conditions
     */
    private checkLiquidity;
    /**
     * Calculate comprehensive risk score
     */
    private calculateRiskScore;
    /**
     * Post-trade risk update
     */
    updatePostTrade(result: ExecutionResult, opportunity: RankedOpportunity): Promise<void>;
    /**
     * Update position tracking
     */
    private updatePosition;
    /**
     * Trigger circuit breaker
     */
    triggerCircuitBreaker(reason: string): void;
    /**
     * Reset circuit breaker
     */
    private resetCircuitBreaker;
    /**
     * Get circuit breaker time remaining
     */
    private getCircuitBreakerTimeRemaining;
    /**
     * Check market volatility
     */
    private checkVolatility;
    /**
     * Get token price
     */
    private getTokenPrice;
    /**
     * Start daily reset timer
     */
    private startDailyReset;
    /**
     * Reset daily metrics
     */
    private resetDailyMetrics;
    /**
     * Get current risk metrics
     */
    getMetrics(): RiskMetrics;
    /**
     * Get risk limits
     */
    getLimits(): RiskLimits;
    /**
     * Update risk limits (admin only)
     */
    updateLimits(newLimits: Partial<RiskLimits>): void;
    /**
     * Emergency stop - trigger circuit breaker immediately
     */
    emergencyStop(): void;
    /**
     * Get risk report
     */
    getRiskReport(): object;
    /**
     * Cleanup
     */
    destroy(): void;
}
export declare function getRiskManager(): RiskManager;
//# sourceMappingURL=riskManager.d.ts.map