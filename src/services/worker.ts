import { Worker, WorkerOptions } from 'worker_threads';
import { Config } from '../config';
import { getPathfinder } from '../arb/pathfinder';
import { DataSource } from 'typeorm';
import * as LedgerModule from '../accounting/ledger';
import winston from 'winston';

const createLedger = (LedgerModule as any).createLedger || (LedgerModule as any).default || (() => {
  throw new Error('createLedger not found in ../accounting/ledger');
});

export interface OpportunityJob {
  id: string;
  timestamp: number;
  initialData: {
    tokens: string[];
    dexes: string[];
    initialAmount: bigint;
  };
}

export class OpportunityWorker {
  private ledger: ReturnType<typeof createLedger>;
  private workers: Worker[] = [];
  private jobQueue: OpportunityJob[] = [];

  constructor(dataSource: DataSource) {
    // createLedger might expect a connection string or DataSource; try both
    try {
      this.ledger = createLedger(dataSource);
    } catch {
      try {
        this.ledger = createLedger((Config.database as any).accountingDbUrl || '');
      } catch (e) {
        throw new Error('Failed to initialize ledger: ' + (e as Error).message);
      }
    }
  }

  initializeWorkers(poolSize: number = Config.workers.poolSize): void {
    for (let i = 0; i < poolSize; i++) {
      const worker = this.createWorker();
      this.workers.push(worker);
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerScript(), {
      eval: true
    } as WorkerOptions);

    worker.on('error', (error) => {
      winston.error('Worker thread error:', error);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        winston.warn(`Worker stopped with exit code ${code}`);
      }
    });

    return worker;
  }

  async processJobs(): Promise<void> {
    const pathfinder = getPathfinder();
    const paths = await pathfinder.enumeratePaths();

    paths.forEach((path: any) => {
      const job: OpportunityJob = {
        id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        initialData: {
          tokens: path.tokens.map((t: any) => t.address),
          dexes: path.dexes,
          initialAmount: path.initialAmount || BigInt(100)
        }
      };
      this.jobQueue.push(job);
    });

    await this.distributeJobs();
  }

  private async distributeJobs(): Promise<void> {
    while (this.jobQueue.length > 0 && this.workers.length > 0) {
      const job = this.jobQueue.shift();
      if (!job) continue;

      const worker = this.workers.shift()!;

      try {
        await this.executeJob(worker, job);
      } catch (error) {
        winston.error('Job execution failed:', error);
      } finally {
        this.workers.push(worker);
      }
    }
  }

  private async executeJob(worker: Worker, job: OpportunityJob): Promise<void> {
    return new Promise((resolve, reject) => {
      worker.postMessage(job);

      worker.once('message', async (result) => {
        if (result.success) {
          try {
            if (typeof this.ledger.recordTrade === 'function') {
              await this.ledger.recordTrade(result.simulation, result.path);
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(result.error));
        }
      });
    });
  }

  private workerScript(): string {
    return `
const { parentPort } = require('worker_threads');
parentPort.on('message', async (job) => {
  try {
    parentPort.postMessage({
      success: true,
      simulation: {},
      path: {},
      txHash: '0xsimulated'
    });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error.message
    });
  }
});
    `;
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.jobQueue = [];
  }
}

export const createOpportunityWorker = (dataSource: DataSource) =>
  new OpportunityWorker(dataSource);
