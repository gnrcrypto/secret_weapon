import { DataSource } from 'typeorm';
export interface OpportunityJob {
    id: string;
    timestamp: number;
    initialData: {
        tokens: string[];
        dexes: string[];
        initialAmount: bigint;
    };
}
export declare class OpportunityWorker {
    private ledger;
    private workers;
    private jobQueue;
    constructor(dataSource: DataSource);
    initializeWorkers(poolSize?: number): void;
    private createWorker;
    processJobs(): Promise<void>;
    private distributeJobs;
    private executeJob;
    private workerScript;
    shutdown(): Promise<void>;
}
export declare const createOpportunityWorker: (dataSource: DataSource) => OpportunityWorker;
//# sourceMappingURL=worker.d.ts.map