export declare class HealthAPI {
    private app;
    private isPaused;
    private startTime;
    constructor();
    private setupMiddleware;
    private setupRoutes;
    /**
     * Get health status
     */
    private getHealthStatus;
    /**
     * Get detailed metrics
     */
    private getDetailedMetrics;
    /**
     * Emergency stop
     */
    private emergencyStop;
    /**
     * Start the API server
     */
    start(port?: number): void;
}
export declare function getHealthAPI(): HealthAPI;
//# sourceMappingURL=health.d.ts.map