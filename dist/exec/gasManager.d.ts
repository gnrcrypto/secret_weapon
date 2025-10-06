interface GasPriceData {
    baseFee: bigint;
    priorityFee: bigint;
    maxFeePerGas: bigint;
    gasPrice: bigint;
    timestamp: number;
    source: 'provider' | 'oracle' | 'fallback';
}
interface GasEstimation {
    gasLimit: bigint;
    gasPrice: GasPriceData;
    totalCostWei: bigint;
    totalCostGwei: string;
    confidence: number;
}
interface GasHistory {
    prices: GasPriceData[];
    averageGasPrice: bigint;
    minGasPrice: bigint;
    maxGasPrice: bigint;
    volatility: number;
}
/**
 * Gas Manager for optimal gas price strategies
 */
export declare class GasManager {
    private currentGasPrice;
    private gasHistory;
    private maxHistorySize;
    private updateInterval;
    constructor();
    /**
     * Start monitoring gas prices
     */
    private startGasPriceMonitoring;
    /**
     * Update current gas price
     */
    private updateGasPrice;
    /**
     * Add gas price to history
     */
    private addToHistory;
    /**
     * Get current gas price based on strategy
     */
    getGasPriceHint(urgency?: 'low' | 'standard' | 'high'): GasPriceData;
    /**
     * Check if gas price is acceptable for trade
     */
    isGasPriceAcceptable(expectedProfitWei: bigint, gasLimit: bigint): boolean;
    /**
     * Set gas price for transaction
     */
    setGasPriceForTx(tx: any, urgency?: 'low' | 'standard' | 'high'): any;
    /**
     * Estimate gas for a transaction
     */
    estimateGas(tx: any, bufferPercent?: number): Promise<bigint>;
    /**
     * Compute gas budget for complexity
     */
    computeGasBudget(txComplexity: 'simple' | 'medium' | 'complex'): bigint;
    /**
     * Calculate total gas cost
     */
    calculateGasCost(gasLimit: bigint, urgency?: 'low' | 'standard' | 'high'): GasEstimation;
    /**
     * Get gas price history analysis
     */
    getGasHistory(): GasHistory;
    /**
     * Wait for gas price to drop below threshold
     */
    waitForLowerGas(maxGasPriceGwei: number, timeoutMs?: number): Promise<boolean>;
    /**
     * Check if gas price is spiking
     */
    isGasSpiking(): boolean;
    /**
     * Get recommended gas limit for transaction type
     */
    getRecommendedGasLimit(txType: 'approve' | 'swap' | 'multiSwap' | 'flashLoan'): bigint;
    /**
     * Stop gas monitoring
     */
    stopMonitoring(): void;
}
export declare function getGasManager(): GasManager;
export {};
//# sourceMappingURL=gasManager.d.ts.map