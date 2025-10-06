/**
 * Metrics Service for Prometheus monitoring
 */
export declare class MetricsService {
    private register;
    private app;
    private opportunitiesFound;
    private tradesExecuted;
    private tradesSuccessful;
    private tradesFailed;
    private profitTotal;
    private lossTotal;
    private gasSpent;
    private errorsTotal;
    private currentPrice;
    private walletBalance;
    private exposureByToken;
    private circuitBreakerStatus;
    private blockLag;
    private pendingTransactions;
    private riskScore;
    private tradeProfitHistogram;
    private executionTimeHistogram;
    private gasUsedHistogram;
    private priceImpactHistogram;
    private simulationTimeHistogram;
    constructor();
    private initializeMetrics;
    private setupEndpoints;
    /**
     * Start metrics server
     */
    start(port?: number): void;
    /**
     * Record opportunity found
     */
    recordOpportunity(type: string, dex: string): void;
    /**
     * Record trade execution
     */
    recordTrade(type: string, dex: string, success: boolean, profitUsd: number, gasUsed: bigint, executionTimeMs: number): void;
    /**
     * Record error
     */
    recordError(type: string, severity: 'low' | 'medium' | 'high' | 'critical'): void;
    /**
     * Update wallet balance
     */
    updateWalletBalance(token: string, balance: number): void;
    /**
     * Update token price
     */
    updateTokenPrice(token: string, price: number): void;
    /**
     * Update exposure
     */
    updateExposure(token: string, exposureUsd: number): void;
    /**
     * Update circuit breaker status
     */
    updateCircuitBreaker(active: boolean): void;
    /**
     * Update block lag
     */
    updateBlockLag(lag: number): void;
    /**
     * Update pending transactions
     */
    updatePendingTransactions(count: number): void;
    /**
     * Update risk score
     */
    updateRiskScore(type: string, score: number): void;
    /**
     * Record price impact
     */
    recordPriceImpact(dex: string, impact: number): void;
    /**
     * Record simulation time
     */
    recordSimulationTime(timeMs: number): void;
    /**
     * Get dashboard data
     */
    private getDashboardData;
    private getMetricValue;
    private calculateSuccessRate;
    private calculateNetPnL;
    private calculateAvgProfit;
    private calculateAvgGasUsed;
    private calculateAvgExecutionTime;
}
export declare function getMetricsService(): MetricsService;
//# sourceMappingURL=metrics.d.ts.map