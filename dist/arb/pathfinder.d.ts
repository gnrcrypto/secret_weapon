export interface Token {
    address: string;
    symbol: string;
    decimals: number;
}
export interface TradingPair {
    tokenA: Token;
    tokenB: Token;
    dexName: string;
    pairAddress?: string;
    reserveA?: bigint;
    reserveB?: bigint;
    fee: number;
}
export interface ArbitragePath {
    id: string;
    type: 'triangular' | 'cross-dex' | 'flash-arb';
    tokens: Token[];
    dexes: string[];
    pairs: TradingPair[];
    estimatedProfitBps?: number;
    requiredCapital?: bigint;
    isFlashLoanRequired?: boolean;
}
export interface PathEvaluation {
    path: ArbitragePath;
    inputAmount: bigint;
    outputAmount: bigint;
    profit: bigint;
    profitBps: number;
    priceImpact: number;
    gasEstimate: bigint;
    isViable: boolean;
}
/**
 * Pathfinder for discovering arbitrage opportunities
 */
export declare class Pathfinder {
    private tokenGraph;
    private commonTokens;
    private initialized;
    constructor();
    private initializeCommonTokens;
    /**
     * Initialize the token graph with DEX pairs - FIXED VERSION
     */
    initialize(): Promise<void>;
    /**
     * Debug method to check what's happening - FIXED: No protected property access
     */
    debugPathfinder(): Promise<void>;
    /**
     * Find triangular arbitrage paths
     */
    findTriangularPaths(startToken?: string, maxPaths?: number): Promise<ArbitragePath[]>;
    /**
     * Find cross-DEX arbitrage paths - FIXED VERSION
     */
    findCrossDexPaths(tokenA: string, tokenB: string, maxPaths?: number): Promise<ArbitragePath[]>;
    private getTokenSymbol;
    /**
     * Enumerate all possible paths up to a certain hop count
     */
    enumeratePaths(_maxHops?: number): Promise<ArbitragePath[]>;
    /**
     * Evaluate a path for profitability
     */
    evaluatePath(path: ArbitragePath, inputAmount: bigint): Promise<PathEvaluation>;
    /**
     * Construct a triangular path
     */
    private constructTriangularPath;
    /**
     * Clear path cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): object;
}
export declare function getPathfinder(): Pathfinder;
//# sourceMappingURL=pathfinder.d.ts.map