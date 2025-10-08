import { Contract, Interface, JsonRpcProvider, Wallet } from 'ethers';
export interface DexConfig {
    name: string;
    router: string;
    factory: string;
    initCodeHash?: string;
    fee: number;
    isV3?: boolean;
    isCurve?: boolean;
}
export interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
    name?: string;
}
export interface SwapParams {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOutMin: bigint;
    recipient: string;
    deadline: number;
    slippageBps?: number;
}
export interface QuoteResult {
    amountOut: bigint;
    path: string[];
    priceImpact: number;
    executionPrice: number;
    dexName: string;
    gasEstimate?: bigint;
}
export interface SwapResult {
    transactionHash: string;
    amountIn: bigint;
    amountOut: bigint;
    gasUsed: bigint;
    effectivePrice: number;
}
/**
 * Base DEX adapter class
 */
export declare class DexAdapter {
    protected config: DexConfig;
    protected provider: JsonRpcProvider;
    protected signer?: Wallet | undefined;
    protected contract: Contract;
    protected factoryContract: Contract | null;
    protected routerInterface: Interface;
    private static CURVE_POOL_REGISTRY;
    private static UNISWAP_V3_QUOTER;
    constructor(config: DexConfig, provider: JsonRpcProvider, signer?: Wallet | undefined);
    /**
     * Get amounts out for a swap path
     */
    getAmountsOut(path: string[], amountIn: bigint): Promise<bigint[]>;
    /**
     * Get amounts in for a swap path
     */
    getAmountsIn(path: string[], amountOut: bigint): Promise<bigint[]>;
    /**
     * Build swap transaction
     */
    buildSwapTx(params: SwapParams): Promise<any>;
    /**
     * Execute swap
     */
    executeSwap(params: SwapParams): Promise<SwapResult>;
    /**
     * Estimate gas for swap
     */
    estimateGas(tx: any): Promise<bigint>;
    /**
     * Get pair address for two tokens
     */
    getPairAddress(tokenA: string, tokenB: string): Promise<string | null>;
    /**
     * Get reserves for a pair
     */
    getReserves(tokenA: string, tokenB: string): Promise<{
        reserve0: bigint;
        reserve1: bigint;
    } | null>;
    private pairKey;
    /**
     * Find pool address for token pair.
     * - First tries local registry CURVE_POOL_REGISTRY
     * - If not found, returns null (you can extend to probe/poll candidates)
     */
    private findPoolAddress;
    /**
     * Get token index for tokenAddress in poolAddress
     */
    private getTokenIndex;
    private getAmountsOutCurve;
    private getAmountsInCurve;
    private buildSwapTxCurve;
    private isStablecoinPair;
    private getAmountsOutV3;
    private getAmountsInV3;
    private buildSwapTxV3;
    private parseSwapLog;
}
/**
 * Multi-DEX router that aggregates liquidity
 */
export declare class MultiDexRouter {
    private provider;
    private signer?;
    private adapters;
    private tokenCache;
    constructor(provider: JsonRpcProvider, signer?: Wallet | undefined);
    private initializeAdapters;
    /**
     * Get best quote across all DEXs
     */
    getBestQuote(tokenIn: string, tokenOut: string, amountIn: bigint, slippageBps?: number): Promise<QuoteResult | null>;
    /**
     * Execute swap on specific DEX
     */
    executeSwapOnDex(dexName: string, params: SwapParams): Promise<SwapResult>;
    /**
     * Execute swap with best available price
     */
    executeBestSwap(tokenIn: string, tokenOut: string, amountIn: bigint, recipient?: string, slippageBps?: number): Promise<SwapResult>;
    /**
     * Get token info
     */
    getTokenInfo(tokenAddress: string): Promise<TokenInfo>;
    /**
     * Approve token spending
     */
    approveToken(tokenAddress: string, spenderAddress: string, amount: bigint): Promise<string>;
    /**
     * Get all available DEX adapters
     */
    getAdapters(): Map<string, DexAdapter>;
    /**
     * Check if a pair exists on a DEX
     */
    pairExists(dexName: string, tokenA: string, tokenB: string): Promise<boolean>;
}
export declare function getMultiDexRouter(): MultiDexRouter;
//# sourceMappingURL=dexRouterAdapter.d.ts.map