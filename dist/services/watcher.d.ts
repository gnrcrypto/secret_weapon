import { EventEmitter } from 'events';
import { DataSource } from 'typeorm';
export interface WatcherEvents {
    'opportunity-found': (opportunity: any) => void;
    'trade-executed': (result: any) => void;
    'error': (error: Error) => void;
    'block-processed': (blockNumber: number) => void;
    'status-update': (status: WatcherStatus) => void;
}
export interface WatcherStatus {
    isRunning: boolean;
    lastBlockProcessed: number;
    opportunitiesFound: number;
    tradesExecuted: number;
    profitGenerated: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
}
/**
 * Market Watcher Service
 * Continuously monitors blockchain for arbitrage opportunities
 */
export declare class MarketWatcher extends EventEmitter {
    private isRunning;
    private startTime;
    private lastBlockProcessed;
    private totalOpportunitiesFound;
    private totalTradesExecuted;
    private totalProfitGenerated;
    private blockQueue;
    private watchInterval;
    private wsProvider;
    private dataSource;
    constructor(dataSource: DataSource);
    /**
     * Setup internal event listeners
     */
    private setupEventListeners;
    /**
     * Start watching for opportunities
     */
    start(): Promise<void>;
    /**
     * Start WebSocket-based watching (real-time)
     */
    private startWebSocketWatcher;
    /**
     * Start polling-based watching
     */
    private startPollingWatcher;
    /**
     * Process a single block
     */
    private processBlock;
    /**
     * Find arbitrage opportunities
     */
    private findOpportunities;
    /**
     * Execute profitable opportunities
     */
    private executeOpportunities;
    /**
     * Analyze pending transaction for MEV
     */
    private analyzePendingTransaction;
    /**
     * Stop watching
     */
    stop(): Promise<void>;
    /**
     * Pause watching (keeps connections alive)
     */
    pause(): void;
    /**
     * Resume watching
     */
    resume(): void;
    /**
     * Get watcher status
     */
    getStatus(): WatcherStatus;
    /**
     * Get performance metrics
     */
    getPerformanceMetrics(): object;
}
//# sourceMappingURL=watcher.d.ts.map