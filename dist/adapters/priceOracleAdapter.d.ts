import { JsonRpcProvider } from 'ethers';
export interface PriceData {
    price: number;
    timestamp: number;
    source: 'chainlink' | 'dex' | 'aggregated';
    confidence?: number;
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
    constructor(provider: JsonRpcProvider);
    private initializeOracles;
    getChainlinkPrice(pair: string): Promise<PriceData | null>;
    getDexPrice(tokenA: string, tokenB: string): Promise<PriceData | null>;
    getTokenPriceUSD(tokenSymbolOrAddress: string): Promise<number | null>;
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
    clearCache(): void;
    getCacheStats(): object;
}
export declare function getPriceOracle(): PriceOracleAdapter;
//# sourceMappingURL=priceOracleAdapter.d.ts.map