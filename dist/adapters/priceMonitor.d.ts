export declare class PriceMonitor {
    private alertThresholds;
    /**
     * Run comprehensive price oracle health check
     */
    runHealthCheck(): Promise<{
        isHealthy: boolean;
        issues: string[];
        stats: any;
    }>;
    /**
     * Test price fetching performance
     */
    testPerformance(): Promise<{
        avgLatency: number;
        maxLatency: number;
        successRate: number;
    }>;
    /**
     * Compare Chainlink vs DEX prices
     */
    comparePriceSources(): Promise<Record<string, any>>;
    /**
     * Monitor price updates in real-time
     */
    startRealtimeMonitoring(intervalMs?: number): NodeJS.Timeout;
}
export declare const priceMonitor: PriceMonitor;
//# sourceMappingURL=priceMonitor.d.ts.map