"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpportunityWorker = exports.OpportunityWorker = void 0;
const worker_threads_1 = require("worker_threads");
const config_1 = require("../config");
const pathfinder_1 = require("../arb/pathfinder");
const LedgerModule = __importStar(require("../accounting/ledger"));
const winston_1 = __importDefault(require("winston"));
const createLedger = LedgerModule.createLedger || LedgerModule.default || (() => {
    throw new Error('createLedger not found in ../accounting/ledger');
});
class OpportunityWorker {
    ledger;
    workers = [];
    jobQueue = [];
    constructor(dataSource) {
        // createLedger might expect a connection string or DataSource; try both
        try {
            this.ledger = createLedger(dataSource);
        }
        catch {
            try {
                this.ledger = createLedger(config_1.Config.database.accountingDbUrl || '');
            }
            catch (e) {
                throw new Error('Failed to initialize ledger: ' + e.message);
            }
        }
    }
    initializeWorkers(poolSize = config_1.Config.workers.poolSize) {
        for (let i = 0; i < poolSize; i++) {
            const worker = this.createWorker();
            this.workers.push(worker);
        }
    }
    createWorker() {
        const worker = new worker_threads_1.Worker(this.workerScript(), {
            eval: true
        });
        worker.on('error', (error) => {
            winston_1.default.error('Worker thread error:', error);
        });
        worker.on('exit', (code) => {
            if (code !== 0) {
                winston_1.default.warn(`Worker stopped with exit code ${code}`);
            }
        });
        return worker;
    }
    async processJobs() {
        const pathfinder = (0, pathfinder_1.getPathfinder)();
        const paths = await pathfinder.enumeratePaths();
        paths.forEach((path) => {
            const job = {
                id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                initialData: {
                    tokens: path.tokens.map((t) => t.address),
                    dexes: path.dexes,
                    initialAmount: path.initialAmount || BigInt(100)
                }
            };
            this.jobQueue.push(job);
        });
        await this.distributeJobs();
    }
    async distributeJobs() {
        while (this.jobQueue.length > 0 && this.workers.length > 0) {
            const job = this.jobQueue.shift();
            if (!job)
                continue;
            const worker = this.workers.shift();
            try {
                await this.executeJob(worker, job);
            }
            catch (error) {
                winston_1.default.error('Job execution failed:', error);
            }
            finally {
                this.workers.push(worker);
            }
        }
    }
    async executeJob(worker, job) {
        return new Promise((resolve, reject) => {
            worker.postMessage(job);
            worker.once('message', async (result) => {
                if (result.success) {
                    try {
                        if (typeof this.ledger.recordTrade === 'function') {
                            await this.ledger.recordTrade(result.simulation, result.path);
                        }
                        resolve();
                    }
                    catch (error) {
                        reject(error);
                    }
                }
                else {
                    reject(new Error(result.error));
                }
            });
        });
    }
    workerScript() {
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
    async shutdown() {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
        this.jobQueue = [];
    }
}
exports.OpportunityWorker = OpportunityWorker;
const createOpportunityWorker = (dataSource) => new OpportunityWorker(dataSource);
exports.createOpportunityWorker = createOpportunityWorker;
//# sourceMappingURL=worker.js.map