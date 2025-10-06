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
    private dataSource;
    constructor(dataSource: DataSource);
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
//# sourceMappingURL=watcher.d.ts.map