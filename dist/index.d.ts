import winston from 'winston';
declare const logger: winston.Logger;
declare class ArbitrageBotApplication {
    private isRunning;
    private startTime;
    private watcher;
    private dataSource;
    initialize(): Promise<void>;
    private initializeDatabase;
    private initializeServices;
    private registerShutdownHandlers;
    start(): Promise<void>;
    private startServices;
    private runMainLoop;
    private checkSystemHealth;
    stop(): Promise<void>;
    getStatus(): object;
}
declare const app: ArbitrageBotApplication;
export { app, logger };
//# sourceMappingURL=index.d.ts.map