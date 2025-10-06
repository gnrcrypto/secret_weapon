import { SimulationResult } from './simulator';
export interface StrategyConstraints {
    minProfitUsd: number;
    maxTradeUsd: number;
    maxPriceImpact: number;
    minConfidence: number;
    maxGasPrice: bigint;
    maxConcurrentTrades: number;
    requiredLiquidity: bigint;
}
export interface RankedOpportunity {
    simulation: SimulationResult;
    score: number;
    rank: number;
    executionPriority: 'high' | 'medium' | 'low';
    estimatedExecutionTime: number;
    riskLevel: 'low' | 'medium' | 'high';
}
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
export declare class Strategy {
    private metrics;
    private constraints;
    private activeTrades;
    constructor();
    /**
     * Load strategy constraints from config
     */
    private loadConstraints;
    /**
     * Reset metrics
     */
    private resetMetrics;
    /**
     * Check if opportunity is profitable
     */
    isOpportunityProfitable(simulation: SimulationResult): boolean;
    /**
     * Select top opportunities from simulations
     */
    selectTopOpportunities(simulations: SimulationResult[], additionalConstraints?: Partial<StrategyConstraints>): Promise<RankedOpportunity[]>;
    /**
     * Rank opportunities by multiple factors
     */
    private rankOpportunities;
    /**
     * Apply position sizing based on risk
     */
    private applyPositionSizing;
    /**
     * Calculate Kelly fraction for position sizing
     */
    private calculateKellyFraction;
    /**
     * Check if should execute opportunity
     */
    shouldExecute(opportunity: RankedOpportunity): boolean;
    /**
     * Register trade execution
     */
    registerTradeExecution(pathId: string): void;
    /**
     * Unregister trade completion
     */
    unregisterTrade(pathId: string): void;
    /**
     * Get strategy metrics
     */
    getMetrics(): StrategyMetrics;
    /**
     * Record rejection reason
     */
    private recordRejection;
    /**
     * Update metrics with selected opportunities
     */
    private updateMetrics;
    /**
     * Get daily PnL (placeholder - should connect to ledger)
     */
    private getDailyPnL;
    /**
     * Adjust strategy based on market conditions
     */
    adjustForMarketConditions(): Promise<void>;
}
export declare function getStrategy(): Strategy;
//# sourceMappingURL=strategy.d.ts.map