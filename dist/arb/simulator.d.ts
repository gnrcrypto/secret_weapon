import { ArbitragePath } from './pathfinder';
export interface SimulationResult {
    path: ArbitragePath;
    inputAmount: bigint;
    outputAmount: bigint;
    grossProfit: bigint;
    gasCost: bigint;
    netProfit: bigint;
    netProfitUsd: number;
    priceImpact: number;
    slippage: number;
    executionPrice: number;
    isProfitable: boolean;
    confidence: number;
    warnings: string[];
    breakdown: StepBreakdown[];
}
export interface StepBreakdown {
    step: number;
    from: string;
    to: string;
    dex: string;
    amountIn: bigint;
    amountOut: bigint;
    priceImpact: number;
    gasEstimate: bigint;
}
export interface FlashLoanSimulation {
    provider: 'aave' | 'balancer' | 'dodo';
    asset: string;
    amount: bigint;
    fee: bigint;
    totalCost: bigint;
    isProfitable: boolean;
}
/**
 * Arbitrage Simulator
 */
export declare class Simulator {
    private gasPrice;
    private maticPriceUsd;
    constructor();
    /**
     * Update gas price periodically
     */
    private updateGasPrice;
    /**
     * Update MATIC price periodically
     */
    private updateMaticPrice;
    /**
     * Simulate arbitrage path execution
     */
    simulatePathOnChain(path: ArbitragePath, inputAmount: bigint, slippageBps?: number): Promise<SimulationResult>;
    /**
     * Simulate with flash loan
     */
    simulateWithFlashLoan(path: ArbitragePath, flashLoanAmount: bigint, flashLoanProvider?: 'aave' | 'balancer' | 'dodo'): Promise<SimulationResult>;
    /**
     * Batch simulate multiple paths
     */
    batchSimulate(paths: ArbitragePath[], inputAmounts: Map<string, bigint>): Promise<SimulationResult[]>;
    /**
     * Estimate gas for a swap
     */
    private estimateSwapGas;
    /**
     * Calculate price difference between DEXs
     */
    private calculatePriceDifference;
    /**
     * Calculate flash loan fee
     */
    private calculateFlashLoanFee;
    /**
     * Calculate confidence score
     */
    private calculateConfidence;
    /**
     * Simulate MEV protection
     */
    simulateWithMEVProtection(path: ArbitragePath, inputAmount: bigint): Promise<SimulationResult>;
    /**
     * Validate simulation result
     */
    validateSimulation(result: SimulationResult): boolean;
    /**
     * Get current gas price
     */
    getGasPrice(): bigint;
    /**
     * Get current MATIC price
     */
    getMaticPrice(): number;
}
export declare function getSimulator(): Simulator;
//# sourceMappingURL=simulator.d.ts.map