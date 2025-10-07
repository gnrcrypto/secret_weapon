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
    constructor(_dataSource: DataSource);
    private setupEventListeners;
    start(): Promise<void>;
    private startWebSocketWatcher;
    private startPollingWatcher;
    private processBlock;
    private findOpportunities;
    private executeOpportunities;
    private analyzePendingTransaction;
    stop(): Promise<void>;
    pause(): void;
    resume(): void;
    getStatus(): WatcherStatus;
    getPerformanceMetrics(): object;
}
/**
 * Factory helper used by other modules that expect a createWatcher function.
 * Returns an object exposing start/stop (wrapping the MarketWatcher instance).
 */
export declare function createWatcher(dataSource: DataSource): {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    on: (event: string, handler: (...args: any[]) => void) => MarketWatcher;
    pause: () => void;
    resume: () => void;
    getStatus: () => WatcherStatus;
    getPerformanceMetrics: () => object;
};
//# sourceMappingURL=watcher.d.ts.map