import { ArbitragePath, Token } from '../arb/pathfinder';
import { SimulationResult } from '../arb/simulator';
export interface TransactionRequest {
    to: string;
    data: string;
    value: bigint;
    gasLimit?: bigint;
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    nonce?: number;
    chainId?: number;
}
export interface SwapTransaction {
    type: 'swap' | 'multiSwap' | 'flashSwap';
    request: TransactionRequest;
    path: ArbitragePath;
    expectedOutput: bigint;
    deadline: number;
    metadata: {
        description: string;
        urgency: 'low' | 'standard' | 'high';
        estimatedGasUsed: bigint;
        estimatedProfitWei: bigint;
    };
}
/**
 * Transaction Builder
 */
export declare class TransactionBuilder {
    private wallet;
    constructor();
    /**
     * Build atomic swap transaction
     */
    buildAtomicSwapTx(path: ArbitragePath, amountIn: bigint, minAmountOut: bigint, gasLimit?: bigint, urgency?: 'low' | 'standard' | 'high'): Promise<SwapTransaction>;
    /**
     * Build triangular arbitrage transaction
     */
    private buildTriangularSwapTx;
    /**
     * Build cross-DEX arbitrage transaction
     */
    private buildCrossDexSwapTx;
    /**
     * Build flash loan transaction
     */
    buildFlashLoanTx(path: ArbitragePath, flashLoanAmount: bigint, simulation: SimulationResult, provider?: 'aave' | 'balancer'): Promise<SwapTransaction>;
    /**
     * Build token approval transaction
     */
    buildApprovalTx(tokenAddress: string, spenderAddress: string, amount?: bigint): Promise<TransactionRequest>;
    /**
     * Sign transaction
     */
    signTx(txRequest: TransactionRequest): Promise<string>;
    /**
     * Encode calldata for swap
     */
    encodeSwapCalldata(inputToken: Token, // Removed unused routerAddress parameter
    outputToken: Token, amountIn: bigint, minAmountOut: bigint, recipient: string, deadline: number): string;
    /**
     * Get deadline for transaction
     */
    private getDeadline;
    /**
     * Estimate gas for transaction
     */
    estimateGasForTx(txRequest: TransactionRequest): Promise<bigint>;
    /**
     * Build MEV protected transaction
     */
    buildMEVProtectedTx(baseTx: SwapTransaction): Promise<SwapTransaction>;
    /**
     * Build batch transaction for multiple swaps
     */
    buildBatchTx(swaps: SwapTransaction[]): Promise<TransactionRequest>;
    /**
     * Validate transaction before sending
     */
    validateTransaction(txRequest: TransactionRequest): boolean;
    /**
     * Get transaction cost estimate
     */
    getTransactionCost(gasLimit: bigint, urgency?: 'low' | 'standard' | 'high'): {
        wei: bigint;
        gwei: string;
        usd: number;
    };
    /**
     * Build recovery transaction for stuck funds
     */
    buildRecoveryTx(tokenAddress: string, amount: bigint, recipient?: string): Promise<TransactionRequest>;
}
export declare function getTxBuilder(): TransactionBuilder;
//# sourceMappingURL=txBuilder.d.ts.map