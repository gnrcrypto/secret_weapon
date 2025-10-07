/**
 * Main Orchestrator
 * Coordinates all components of the arbitrage bot
 */
export declare class MainOrchestrator {
    private dataSource;
    private marketWatcher;
    private healthAPI;
    private isRunning;
    private startTime;
    constructor();
    /**
     * Initialize all components
     */
    initialize(): Promise<void>;
    /**
     * Verify wallet configuration
     */
    private verifyWallet;
    /**
     * Check and deploy smart contract if needed
     */
    private checkSmartContract;
    /**
     * Setup event listeners
     */
    private setupEventListeners;
    /**
     * Start the orchestrator
     */
    start(): Promise<void>;
    /**
     * Display current status
     */
    private displayStatus;
    /**
     * Start periodic status updates
     */
    private startStatusUpdates;
    /**
     * Graceful shutdown
     */
    shutdown(): Promise<void>;
}
declare const orchestrator: MainOrchestrator;
export default orchestrator;
//# sourceMappingURL=index.d.ts.map