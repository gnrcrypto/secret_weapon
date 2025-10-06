"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pathfinder = void 0;
exports.getPathfinder = getPathfinder;
const config_1 = require("../config");
const dexRouterAdapter_1 = require("../adapters/dexRouterAdapter");
const priceOracleAdapter_1 = require("../adapters/priceOracleAdapter");
const winston_1 = __importDefault(require("winston"));
const node_cache_1 = __importDefault(require("node-cache"));
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'pathfinder' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
// Path cache
const pathCache = new node_cache_1.default({
    stdTTL: config_1.Config.performance.pathCacheTtlMs / 1000,
    checkperiod: 60,
    useClones: false,
});
/**
 * Graph representation of token network
 */
class TokenGraph {
    adjacencyList = new Map();
    edges = new Map();
    addEdge(tokenA, tokenB, pair) {
        // Add to adjacency list
        if (!this.adjacencyList.has(tokenA)) {
            this.adjacencyList.set(tokenA, new Set());
        }
        if (!this.adjacencyList.has(tokenB)) {
            this.adjacencyList.set(tokenB, new Set());
        }
        this.adjacencyList.get(tokenA).add(tokenB);
        this.adjacencyList.get(tokenB).add(tokenA);
        // Store edge information
        const edgeKey = this.getEdgeKey(tokenA, tokenB);
        if (!this.edges.has(edgeKey)) {
            this.edges.set(edgeKey, []);
        }
        this.edges.get(edgeKey).push(pair);
    }
    getNeighbors(token) {
        return Array.from(this.adjacencyList.get(token) || []);
    }
    getPairs(tokenA, tokenB) {
        const edgeKey = this.getEdgeKey(tokenA, tokenB);
        return this.edges.get(edgeKey) || [];
    }
    getEdgeKey(tokenA, tokenB) {
        return [tokenA, tokenB].sort().join('-');
    }
    getAllTokens() {
        return Array.from(this.adjacencyList.keys());
    }
}
/**
 * Pathfinder for discovering arbitrage opportunities
 */
class Pathfinder {
    tokenGraph = new TokenGraph();
    commonTokens = [];
    initialized = false;
    constructor() {
        this.initializeCommonTokens();
    }
    initializeCommonTokens() {
        // Most liquid tokens on Polygon for arbitrage
        this.commonTokens = [
            { address: config_1.ADDRESSES.WMATIC, symbol: 'WMATIC', decimals: 18 },
            { address: config_1.ADDRESSES.USDC, symbol: 'USDC', decimals: 6 },
            { address: config_1.ADDRESSES.USDT, symbol: 'USDT', decimals: 6 },
            { address: config_1.ADDRESSES.DAI, symbol: 'DAI', decimals: 18 },
            { address: config_1.ADDRESSES.WETH, symbol: 'WETH', decimals: 18 },
            { address: config_1.ADDRESSES.WBTC, symbol: 'WBTC', decimals: 8 },
        ];
    }
    /**
     * Initialize the token graph with DEX pairs - FIXED VERSION
     */
    async initialize() {
        if (this.initialized)
            return;
        logger.info('Initializing pathfinder token graph...');
        try {
            const router = (0, dexRouterAdapter_1.getMultiDexRouter)();
            const adapters = router.getAdapters();
            logger.info(`Checking ${this.commonTokens.length} tokens across ${adapters.size} DEXs`);
            // Build graph from all token pairs across all DEXs
            for (const [dexName, adapter] of adapters) {
                logger.info(`Scanning ${dexName} for pairs...`);
                let pairsFound = 0;
                for (let i = 0; i < this.commonTokens.length; i++) {
                    for (let j = i + 1; j < this.commonTokens.length; j++) {
                        const tokenA = this.commonTokens[i];
                        const tokenB = this.commonTokens[j];
                        try {
                            // Check if pair exists with timeout
                            const pairExists = await Promise.race([
                                router.pairExists(dexName, tokenA.address, tokenB.address),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                            ]);
                            if (pairExists) {
                                try {
                                    // Get reserves if available
                                    const reserves = await adapter.getReserves(tokenA.address, tokenB.address);
                                    const pair = {
                                        tokenA,
                                        tokenB,
                                        dexName,
                                        reserveA: reserves?.reserve0 || BigInt(0),
                                        reserveB: reserves?.reserve1 || BigInt(0),
                                        fee: 30, // Default 0.3% since we can't access protected config
                                    };
                                    this.tokenGraph.addEdge(tokenA.address, tokenB.address, pair);
                                    pairsFound++;
                                    logger.debug(`Added ${tokenA.symbol}-${tokenB.symbol} on ${dexName}`);
                                }
                                catch (reserveError) {
                                    // Still add pair even if reserves fail
                                    const pair = {
                                        tokenA,
                                        tokenB,
                                        dexName,
                                        fee: 30,
                                    };
                                    this.tokenGraph.addEdge(tokenA.address, tokenB.address, pair);
                                    pairsFound++;
                                }
                            }
                        }
                        catch (error) {
                            // Skip failed pairs quietly
                            continue;
                        }
                    }
                }
                logger.info(`Found ${pairsFound} pairs on ${dexName}`);
            }
            this.initialized = true;
            const totalTokens = this.tokenGraph.getAllTokens().length;
            logger.info(`Token graph initialized with ${totalTokens} tokens`);
        }
        catch (error) {
            logger.error('Failed to initialize token graph:', error);
            throw error;
        }
    }
    /**
     * Debug method to check what's happening - FIXED: No protected property access
     */
    async debugPathfinder() {
        logger.info('=== PATHFINDER DEBUG ===');
        // Check initialization
        logger.info(`Initialized: ${this.initialized}`);
        // Check token counts
        logger.info(`Common tokens: ${this.commonTokens.length}`);
        this.commonTokens.forEach(t => logger.info(`  - ${t.symbol}: ${t.address}`));
        // Check DEX adapters - FIXED: Use public methods only
        try {
            const router = (0, dexRouterAdapter_1.getMultiDexRouter)();
            const adapters = router.getAdapters();
            logger.info(`DEX adapters: ${adapters.size}`);
            adapters.forEach((adapter, name) => {
                // Use public properties/methods only - avoid protected 'config'
                const protocol = adapter.protocol || 'unknown';
                logger.info(`  - ${name}: ${protocol}`);
            });
        }
        catch (error) {
            logger.error('Failed to get DEX adapters:', error);
        }
        // Test a specific pair
        if (this.initialized) {
            const wmatic = config_1.ADDRESSES.WMATIC;
            const usdc = config_1.ADDRESSES.USDC;
            const pairs = this.tokenGraph.getPairs(wmatic, usdc);
            logger.info(`WMATIC-USDC pairs found: ${pairs.length}`);
            pairs.forEach(pair => {
                const reserveA = pair.reserveA ? pair.reserveA.toString() : 'N/A';
                const reserveB = pair.reserveB ? pair.reserveB.toString() : 'N/A';
                logger.info(`  - ${pair.dexName}: ${reserveA}, ${reserveB}`);
            });
            // Test cross-DEX paths
            const crossDexPaths = await this.findCrossDexPaths(wmatic, usdc);
            logger.info(`WMATIC-USDC cross-DEX paths: ${crossDexPaths.length}`);
        }
    }
    /**
     * Find triangular arbitrage paths
     */
    async findTriangularPaths(startToken, maxPaths = 10) {
        if (!this.initialized)
            await this.initialize();
        const cacheKey = `triangular:${startToken || 'all'}:${maxPaths}`;
        const cached = pathCache.get(cacheKey);
        if (cached)
            return cached;
        const paths = [];
        const startTokens = startToken ? [startToken] : this.commonTokens.map(t => t.address);
        for (const start of startTokens) {
            const neighbors = this.tokenGraph.getNeighbors(start);
            for (const middle of neighbors) {
                const middleNeighbors = this.tokenGraph.getNeighbors(middle);
                for (const end of middleNeighbors) {
                    // Check if we can complete the triangle back to start
                    const endNeighbors = this.tokenGraph.getNeighbors(end);
                    if (endNeighbors.includes(start) && start !== middle && middle !== end && start !== end) {
                        // Found a triangular path
                        const path = this.constructTriangularPath(start, middle, end);
                        if (path) {
                            paths.push(path);
                            if (paths.length >= maxPaths) {
                                pathCache.set(cacheKey, paths);
                                return paths;
                            }
                        }
                    }
                }
            }
        }
        pathCache.set(cacheKey, paths);
        logger.info(`Found ${paths.length} triangular arbitrage paths`);
        return paths;
    }
    /**
     * Find cross-DEX arbitrage paths - FIXED VERSION
     */
    async findCrossDexPaths(tokenA, tokenB, maxPaths = 10 // Increased from 5
    ) {
        if (!this.initialized)
            await this.initialize();
        const cacheKey = `crossdex:${tokenA}:${tokenB}:${maxPaths}`;
        const cached = pathCache.get(cacheKey);
        if (cached)
            return cached;
        const paths = [];
        const pairs = this.tokenGraph.getPairs(tokenA, tokenB);
        logger.info(`Checking ${pairs.length} pairs for ${this.getTokenSymbol(tokenA)}-${this.getTokenSymbol(tokenB)}`);
        // If we have pairs from multiple DEXs, create cross-DEX opportunities
        if (pairs.length >= 2) {
            const dexNames = [...new Set(pairs.map(p => p.dexName))];
            logger.info(`Found pairs on ${dexNames.length} DEXs: ${dexNames.join(', ')}`);
            // Create paths for all DEX combinations
            for (let i = 0; i < dexNames.length; i++) {
                for (let j = i + 1; j < dexNames.length; j++) {
                    const buyDex = dexNames[i];
                    const sellDex = dexNames[j];
                    // Get pairs for each DEX
                    const buyPairs = pairs.filter(p => p.dexName === buyDex);
                    const sellPairs = pairs.filter(p => p.dexName === sellDex);
                    if (buyPairs.length > 0 && sellPairs.length > 0) {
                        const buyPair = buyPairs[0]; // Take first pair for each DEX
                        const sellPair = sellPairs[0];
                        // Create forward path: Buy on DEX1, Sell on DEX2
                        const forwardPath = {
                            id: `crossdex-${tokenA}-${tokenB}-${buyDex}-${sellDex}`,
                            type: 'cross-dex',
                            tokens: [buyPair.tokenA, buyPair.tokenB],
                            dexes: [buyDex, sellDex],
                            pairs: [buyPair, sellPair],
                            isFlashLoanRequired: true, // CHANGED TO true FOR FLASH LOANS
                        };
                        paths.push(forwardPath);
                        // Create reverse path: Buy on DEX2, Sell on DEX1
                        const reversePath = {
                            id: `crossdex-${tokenB}-${tokenA}-${sellDex}-${buyDex}`,
                            type: 'cross-dex',
                            tokens: [sellPair.tokenA, sellPair.tokenB],
                            dexes: [sellDex, buyDex],
                            pairs: [sellPair, buyPair],
                            isFlashLoanRequired: true, // CHANGED TO true FOR FLASH LOANS
                        };
                        paths.push(reversePath);
                        logger.debug(`Created cross-DEX path: ${buyDex} ↔ ${sellDex}`);
                    }
                }
            }
        }
        pathCache.set(cacheKey, paths);
        logger.info(`Found ${paths.length} cross-DEX arbitrage paths for ${this.getTokenSymbol(tokenA)}-${this.getTokenSymbol(tokenB)}`);
        return paths;
    }
    // Add this helper method to the class
    getTokenSymbol(address) {
        const token = this.commonTokens.find(t => t.address.toLowerCase() === address.toLowerCase());
        return token ? token.symbol : 'UNKNOWN';
    }
    /**
     * Enumerate all possible paths up to a certain hop count
     */
    async enumeratePaths(_maxHops = 3) {
        if (!this.initialized)
            await this.initialize();
        const allPaths = [];
        if (config_1.Config.features.enableTriangularArb) {
            const triangularPaths = await this.findTriangularPaths();
            allPaths.push(...triangularPaths);
        }
        if (config_1.Config.features.enableCrossDexArb) {
            // Find cross-DEX paths for common pairs
            for (const tokenA of this.commonTokens) {
                for (const tokenB of this.commonTokens) {
                    if (tokenA.address !== tokenB.address) {
                        const crossDexPaths = await this.findCrossDexPaths(tokenA.address, tokenB.address);
                        allPaths.push(...crossDexPaths);
                    }
                }
            }
        }
        logger.info(`Enumerated ${allPaths.length} total paths`);
        return allPaths;
    }
    /**
     * Evaluate a path for profitability
     */
    async evaluatePath(path, inputAmount) {
        const router = (0, dexRouterAdapter_1.getMultiDexRouter)();
        let currentAmount = inputAmount;
        let totalGasEstimate = BigInt(0);
        let totalPriceImpact = 0;
        try {
            // Simulate each step in the path
            if (path.type === 'triangular') {
                // For triangular arb: A -> B -> C -> A
                for (let i = 0; i < path.tokens.length; i++) {
                    const fromToken = path.tokens[i];
                    const toToken = path.tokens[(i + 1) % path.tokens.length];
                    const dexName = path.dexes[i];
                    const adapter = router.getAdapters().get(dexName.toLowerCase());
                    if (!adapter) {
                        throw new Error(`Adapter not found for ${dexName}`);
                    }
                    const amounts = await adapter.getAmountsOut([fromToken.address, toToken.address], currentAmount);
                    currentAmount = amounts[1];
                    totalGasEstimate += BigInt(150000); // Estimate per swap
                    // Calculate price impact
                    const priceOracle = (0, priceOracleAdapter_1.getPriceOracle)();
                    const impact = await priceOracle.calculatePriceImpact(fromToken.address, toToken.address, amounts[0], dexName);
                    totalPriceImpact += impact;
                }
            }
            else if (path.type === 'cross-dex') {
                // For cross-DEX arb: Buy on DEX1, Sell on DEX2
                const [buyDex, sellDex] = path.dexes;
                const [tokenIn, tokenOut] = path.tokens;
                // Get buy quote
                const buyAdapter = router.getAdapters().get(buyDex.toLowerCase());
                const buyAmounts = await buyAdapter.getAmountsOut([tokenIn.address, tokenOut.address], currentAmount);
                // Get sell quote (reverse direction)
                const sellAdapter = router.getAdapters().get(sellDex.toLowerCase());
                const sellAmounts = await sellAdapter.getAmountsOut([tokenOut.address, tokenIn.address], buyAmounts[1]);
                currentAmount = sellAmounts[1];
                totalGasEstimate = BigInt(300000); // Two swaps
                // Calculate price impacts
                const priceOracle = (0, priceOracleAdapter_1.getPriceOracle)();
                const buyImpact = await priceOracle.calculatePriceImpact(tokenIn.address, tokenOut.address, inputAmount, buyDex);
                const sellImpact = await priceOracle.calculatePriceImpact(tokenOut.address, tokenIn.address, buyAmounts[1], sellDex);
                totalPriceImpact = buyImpact + sellImpact;
            }
            // Calculate profit
            const profit = currentAmount > inputAmount ? currentAmount - inputAmount : BigInt(0);
            const profitBps = inputAmount > 0
                ? Number((profit * BigInt(10000)) / inputAmount)
                : 0;
            // Determine if path is viable
            const isViable = profit > BigInt(0) &&
                profitBps > 10 && // At least 0.1% profit
                totalPriceImpact < 5; // Less than 5% total impact
            return {
                path,
                inputAmount,
                outputAmount: currentAmount,
                profit,
                profitBps,
                priceImpact: totalPriceImpact,
                gasEstimate: totalGasEstimate,
                isViable,
            };
        }
        catch (error) {
            logger.error(`Error evaluating path ${path.id}:`, error);
            return {
                path,
                inputAmount,
                outputAmount: BigInt(0),
                profit: BigInt(0),
                profitBps: 0,
                priceImpact: 100,
                gasEstimate: BigInt(300000),
                isViable: false,
            };
        }
    }
    /**
     * Construct a triangular path
     */
    constructTriangularPath(tokenA, tokenB, tokenC) {
        const pairsAB = this.tokenGraph.getPairs(tokenA, tokenB);
        const pairsBC = this.tokenGraph.getPairs(tokenB, tokenC);
        const pairsCA = this.tokenGraph.getPairs(tokenC, tokenA);
        if (pairsAB.length === 0 || pairsBC.length === 0 || pairsCA.length === 0) {
            return null;
        }
        // Find tokens by address
        const findToken = (address) => {
            return this.commonTokens.find(t => t.address === address) || {
                address,
                symbol: 'UNKNOWN',
                decimals: 18,
            };
        };
        // Select best DEX for each hop (highest liquidity)
        const bestAB = pairsAB.reduce((best, current) => {
            const currentLiquidity = (current.reserveA || BigInt(0)) + (current.reserveB || BigInt(0));
            const bestLiquidity = (best.reserveA || BigInt(0)) + (best.reserveB || BigInt(0));
            return currentLiquidity > bestLiquidity ? current : best;
        });
        const bestBC = pairsBC.reduce((best, current) => {
            const currentLiquidity = (current.reserveA || BigInt(0)) + (current.reserveB || BigInt(0));
            const bestLiquidity = (best.reserveA || BigInt(0)) + (best.reserveB || BigInt(0));
            return currentLiquidity > bestLiquidity ? current : best;
        });
        const bestCA = pairsCA.reduce((best, current) => {
            const currentLiquidity = (current.reserveA || BigInt(0)) + (current.reserveB || BigInt(0));
            const bestLiquidity = (best.reserveA || BigInt(0)) + (best.reserveB || BigInt(0));
            return currentLiquidity > bestLiquidity ? current : best;
        });
        return {
            id: `tri-${tokenA}-${tokenB}-${tokenC}`,
            type: 'triangular',
            tokens: [findToken(tokenA), findToken(tokenB), findToken(tokenC)],
            dexes: [bestAB.dexName, bestBC.dexName, bestCA.dexName],
            pairs: [bestAB, bestBC, bestCA],
            isFlashLoanRequired: false,
        };
    }
    /**
     * Clear path cache
     */
    clearCache() {
        pathCache.flushAll();
        logger.info('Path cache cleared');
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            keys: pathCache.keys().length,
            hits: pathCache.getStats().hits,
            misses: pathCache.getStats().misses,
            hitRate: pathCache.getStats().hits > 0
                ? (pathCache.getStats().hits / (pathCache.getStats().hits + pathCache.getStats().misses) * 100).toFixed(2) + '%'
                : '0%',
        };
    }
}
exports.Pathfinder = Pathfinder;
// Export singleton instance
let pathfinder = null;
function getPathfinder() {
    if (!pathfinder) {
        pathfinder = new Pathfinder();
    }
    return pathfinder;
}
//# sourceMappingURL=pathfinder.js.map