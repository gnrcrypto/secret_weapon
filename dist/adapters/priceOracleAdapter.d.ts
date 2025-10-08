import { JsonRpcProvider } from 'ethers';
export interface PriceData {
    price: number;
    timestamp: number;
    source: 'chainlink' | 'dex' | 'aggregated' | 'fallback';
    confidence?: number;
    sources?: string[];
    deviation?: number;
    roundId?: string;
}
export interface TokenPairPrice {
    tokenA: string;
    tokenB: string;
    price: number;
    inversePrice: number;
    timestamp: number;
    sources: string[];
}
export declare class PriceOracleAdapter {
    private provider;
    private chainlinkContracts;
    private priceUpdateListeners;
    private lastPrices;
    private dexPriceCache;
    constructor(provider: JsonRpcProvider);
    private initializeOracles;
    /**
     * Start background price updates for critical pairs
     */
    private startPriceUpdates;
    /**
     * Update DEX prices for a given pair
     */
    private updateDexPrices;
    /**
     * Aggregate multiple price sources
     */
    private aggregatePrices;
    /**
     * Convert Chainlink pair to token addresses
     */
    private convertPairToTokens;
    /**
     * Get Chainlink price with improved error handling and staleness checks
     */
    getChainlinkPrice(pair: string): Promise<PriceData | null>;
    /**
     * Get DEX price with improved routing
     */
    getDexPrice(tokenA: string, tokenB: string): Promise<PriceData | null>;
    /**
     * Get stablecoin price with slight variance
     */
    private getStablecoinPrice;
    /**
     * Enhanced token price fetching with multi-source fallback
     */
    getTokenPriceUSD(tokenSymbolOrAddress: string): Promise<number | null>;
    /**
     * Get real-time price with source preference
     */
    getPrice(tokenA: string, tokenB: string): Promise<TokenPairPrice | null>;
    getPoolReserves(poolAddress: string): Promise<{
        reserve0: bigint;
        reserve1: bigint;
        token0: string;
        token1: string;
    } | null>;
    calculatePriceImpact(tokenIn: string, tokenOut: string, amountIn: bigint, dexName?: string): Promise<number>;
    getAggregatedPrice(tokenA: string, tokenB: string): Promise<PriceData>;
    validatePrice(tokenA: string, tokenB: string, price: number, tolerancePercent?: number): Promise<boolean>;
    private isStablecoin;
    private getChainlinkPair;
    private getChainlinkPairForTokens;
    /**
     * Get health status of all oracles
     */
    getOracleHealth(): Record<string, any>;
    /**
     * Method to get all available price sources for a token
     */
    getPriceSources(tokenSymbolOrAddress: string): Promise<PriceData[]>;
    clearCache(): void;
    /**
     * Additional method to clear all caches
     */
    clearCaches(): void;
    getCacheStats(): object;
    /**
     * Cleanup background tasks
     */
    destroy(): void;
}
export declare function getPriceOracle(): PriceOracleAdapter;
//# sourceMappingURL=priceOracleAdapter.d.ts.map