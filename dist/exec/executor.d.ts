import { TransactionReceipt } from 'ethers';
import { SwapTransaction } from './txBuilder';
import { RankedOpportunity } from '../arb/strategy';
export interface ExecutionResult {
    id: string;
    success: boolean;
    transactionHash?: string;
    receipt?: TransactionReceipt;
    gasUsed?: bigint;
    effectiveGasPrice?: bigint;
    actualProfit?: bigint;
    error?: string;
    timestamp: number;
    retryCount: number;
}
export interface ExecutionStatus {
    pending: number;
    completed: number;
    failed: number;
    totalProfitWei: bigint;
    totalGasUsedWei: bigint;
    successRate: number;
}
/**
 * Transaction Executor
 */
export declare class Executor {
    private wallet;
    private pendingTransactions;
    private executionStatus;
    private maxRetries;
    private retryDelay;
    constructor();
    /**
     * Check if in simulation mode
     */
    private isSimulationMode;
    /**
     * Execute atomic swap
     */
    executeAtomicSwap(opportunity: RankedOpportunity, dryRun?: boolean): Promise<ExecutionResult>;
    /**
     * Execute transaction on-chain
     */
    private executeTransaction;
    /**
     * Simulate execution without sending transaction
     */
    private simulateExecution;
    /**
     * Wait for transaction confirmation
     */
    waitForConfirmation(txHash: string, confirmations?: number, timeoutMs?: number): Promise<TransactionReceipt | null>;
    /**
     * Check if should retry transaction
     */
    private shouldRetry;
    /**
     * Cancel pending transaction
     */
    cancelTransaction(executionId: string): Promise<boolean>;
    /**
     * Execute with flashloan
     */
    executeWithFlashLoan(opportunity: RankedOpportunity, flashLoanAmount: bigint, provider?: 'aave' | 'balancer'): Promise<ExecutionResult>;
    /**
     * Get execution status
     */
    getStatus(): ExecutionStatus;
    /**
     * Get pending transactions
     */
    getPendingTransactions(): SwapTransaction[];
    /**
     * Update success rate
     */
    private updateSuccessRate;
    /**
     * Reset execution status
     */
    resetStatus(): void;
    /**
     * Emergency stop - stop all pending transactions
     */
    emergencyStop(): Promise<void>;
}
export declare function getExecutor(): Executor;
//# sourceMappingURL=executor.d.ts.map