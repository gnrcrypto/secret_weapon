/**
 * Convert a human-readable amount to wei
 */
export declare function toWei(amount: string | number, decimals?: number): bigint;
/**
 * Convert wei to human-readable amount
 */
export declare function fromWei(amount: bigint | string, decimals?: number): string;
/**
 * Format wei to human-readable with specified decimal places
 */
export declare function formatWei(amount: bigint | string, decimals?: number, displayDecimals?: number): string;
/**
 * Calculate output amount with slippage
 */
export declare function calculateMinimumOutput(expectedOutput: bigint, slippageBps: number): bigint;
/**
 * Calculate maximum input with slippage
 */
export declare function calculateMaximumInput(expectedInput: bigint, slippageBps: number): bigint;
/**
 * Apply slippage to an amount
 */
export declare function applySlippage(amount: bigint, slippageBps: number, isInput?: boolean): bigint;
/**
 * Calculate price impact
 */
export declare function calculatePriceImpact(inputAmount: bigint, outputAmount: bigint, reserveIn: bigint, _reserveOut: bigint): number;
/**
 * Safe division with zero check
 */
export declare function safeDiv(numerator: bigint, denominator: bigint, defaultValue?: bigint): bigint;
/**
 * Calculate percentage
 */
export declare function calculatePercentage(value: bigint, total: bigint, precision?: number): string;
/**
 * Compare two BigInt values with tolerance
 */
export declare function isApproximatelyEqual(a: bigint, b: bigint, toleranceBps?: number): boolean;
/**
 * Calculate AMM output using constant product formula (Uniswap V2 style)
 */
export declare function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps?: number): bigint;
/**
 * Calculate AMM input using constant product formula (Uniswap V2 style)
 */
export declare function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint, feeBps?: number): bigint;
/**
 * Calculate profit after gas costs
 */
export declare function calculateNetProfit(grossProfit: bigint, gasUsed: bigint, gasPrice: bigint, nativeTokenPriceUsd?: number): {
    profitWei: bigint;
    profitUsd: number;
    isProfitable: boolean;
};
/**
 * Calculate compound interest for yield calculations
 */
export declare function calculateCompoundInterest(principal: bigint, ratePerPeriod: number, // As decimal (e.g., 0.05 for 5%)
periods: number): bigint;
/**
 * Calculate optimal trade size for maximum profit
 */
export declare function calculateOptimalTradeSize(reserveIn: bigint, _reserveOut: bigint, maxInput: bigint, _feeBps?: number): bigint;
/**
 * Convert USD value to token amount
 */
export declare function usdToTokenAmount(usdValue: number, tokenPriceUsd: number, tokenDecimals: number): bigint;
/**
 * Convert token amount to USD value
 */
export declare function tokenAmountToUsd(amount: bigint, tokenPriceUsd: number, tokenDecimals: number): number;
/**
 * Calculate basis points difference between two values
 */
export declare function calculateBpsDifference(value1: bigint, value2: bigint): number;
/**
 * Parse ether string safely (handles decimal places)
 */
export declare function parseEther(value: string): bigint;
/**
 * Format ether for display
 */
export declare function formatEther(value: bigint): string;
/**
 * Check if value is above minimum threshold
 */
export declare function isAboveThreshold(value: bigint, threshold: bigint): boolean;
/**
 * Calculate gas cost in USD
 */
export declare function calculateGasCostUsd(gasLimit: bigint, gasPrice: bigint, // in wei
nativeTokenPriceUsd?: number): number;
/**
 * Normalize token amount to 18 decimals
 */
export declare function normalizeDecimals(amount: bigint, fromDecimals: number, toDecimals?: number): bigint;
/**
 * Add amounts safely (handles overflow)
 */
export declare function safeAdd(...amounts: bigint[]): bigint;
/**
 * Multiply amounts safely (handles overflow)
 */
export declare function safeMul(a: bigint, b: bigint): bigint;
export declare const ZERO: bigint;
export declare const ONE: bigint;
export declare const WEI_PER_ETHER: bigint;
export declare const BASIS_POINTS: bigint;
export declare const TOKEN_DECIMALS: {
    readonly USDC: 6;
    readonly USDT: 6;
    readonly DAI: 18;
    readonly WETH: 18;
    readonly WBTC: 8;
    readonly WMATIC: 18;
};
//# sourceMappingURL=math.d.ts.map