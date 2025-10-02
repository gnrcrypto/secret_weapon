import { Config, ADDRESSES } from '../config';
import { getMultiDexRouter } from '../adapters/dexRouterAdapter';
import { getPriceOracle } from '../adapters/priceOracleAdapter';
import winston from 'winston';
import NodeCache from 'node-cache';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'pathfinder' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Path cache
const pathCache = new NodeCache({
  stdTTL: Config.performance.pathCacheTtlMs / 1000,
  checkperiod: 60,
  useClones: false,
});

// Types
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
  fee: number; // in basis points
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
 * Graph representation of token network
 */
class TokenGraph {
  private adjacencyList: Map<string, Set<string>> = new Map();
  private edges: Map<string, TradingPair[]> = new Map();
  
  addEdge(tokenA: string, tokenB: string, pair: TradingPair): void {
    // Add to adjacency list
    if (!this.adjacencyList.has(tokenA)) {
      this.adjacencyList.set(tokenA, new Set());
    }
    if (!this.adjacencyList.has(tokenB)) {
      this.adjacencyList.set(tokenB, new Set());
    }
    
    this.adjacencyList.get(tokenA)!.add(tokenB);
    this.adjacencyList.get(tokenB)!.add(tokenA);
    
    // Store edge information
    const edgeKey = this.getEdgeKey(tokenA, tokenB);
    if (!this.edges.has(edgeKey)) {
      this.edges.set(edgeKey, []);
    }
    this.edges.get(edgeKey)!.push(pair);
  }
  
  getNeighbors(token: string): string[] {
    return Array.from(this.adjacencyList.get(token) || []);
  }
  
  getPairs(tokenA: string, tokenB: string): TradingPair[] {
    const edgeKey = this.getEdgeKey(tokenA, tokenB);
    return this.edges.get(edgeKey) || [];
  }
  
  private getEdgeKey(tokenA: string, tokenB: string): string {
    return [tokenA, tokenB].sort().join('-');
  }
  
  getAllTokens(): string[] {
    return Array.from(this.adjacencyList.keys());
  }
}

/**
 * Pathfinder for discovering arbitrage opportunities
 */
export class Pathfinder {
  private tokenGraph: TokenGraph = new TokenGraph();
  private commonTokens: Token[] = [];
  private initialized = false;
  
  constructor() {
    this.initializeCommonTokens();
  }
  
  private initializeCommonTokens(): void {
    // Most liquid tokens on Polygon for arbitrage
    this.commonTokens = [
      { address: ADDRESSES.WMATIC, symbol: 'WMATIC', decimals: 18 },
      { address: ADDRESSES.USDC, symbol: 'USDC', decimals: 6 },
      { address: ADDRESSES.USDT, symbol: 'USDT', decimals: 6 },
      { address: ADDRESSES.DAI, symbol: 'DAI', decimals: 18 },
      { address: ADDRESSES.WETH, symbol: 'WETH', decimals: 18 },
      { address: ADDRESSES.WBTC, symbol: 'WBTC', decimals: 8 },
    ];
  }
  
  /**
   * Initialize the token graph with DEX pairs
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing pathfinder token graph...');
    
    const router = getMultiDexRouter();
    const adapters = router.getAdapters();
    
    // Build graph from all token pairs across all DEXs
    for (const [dexName, adapter] of adapters) {
      for (let i = 0; i < this.commonTokens.length; i++) {
        for (let j = i + 1; j < this.commonTokens.length; j++) {
          const tokenA = this.commonTokens[i];
          const tokenB = this.commonTokens[j];
          
          try {
            // Check if pair exists
            const pairExists = await router.pairExists(dexName, tokenA.address, tokenB.address);
            
            if (pairExists) {
              // Get reserves if available
              const reserves = await adapter.getReserves(tokenA.address, tokenB.address);
              
              const pair: TradingPair = {
                tokenA,
                tokenB,
                dexName,
                reserveA: reserves?.reserve0,
                reserveB: reserves?.reserve1,
                fee: adapter.config.fee,
              };
              
              this.tokenGraph.addEdge(tokenA.address, tokenB.address, pair);
              logger.debug(`Added edge: ${tokenA.symbol}-${tokenB.symbol} on ${dexName}`);
            }
          } catch (error) {
            logger.debug(`Failed to check pair ${tokenA.symbol}-${tokenB.symbol} on ${dexName}`);
          }
        }
      }
    }
    
    this.initialized = true;
    logger.info(`Token graph initialized with ${this.tokenGraph.getAllTokens().length} tokens`);
  }
  
  /**
   * Find triangular arbitrage paths
   */
  async findTriangularPaths(
    startToken?: string,
    maxPaths: number = 10
  ): Promise<ArbitragePath[]> {
    if (!this.initialized) await this.initialize();
    
    const cacheKey = `triangular:${startToken || 'all'}:${maxPaths}`;
    const cached = pathCache.get<ArbitragePath[]>(cacheKey);
    if (cached) return cached;
    
    const paths: ArbitragePath[] = [];
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
   * Find cross-DEX arbitrage paths
   */
  async findCrossDexPaths(
    tokenA: string,
    tokenB: string,
    maxPaths: number = 5
  ): Promise<ArbitragePath[]> {
    if (!this.initialized) await this.initialize();
    
    const cacheKey = `crossdex:${tokenA}:${tokenB}:${maxPaths}`;
    const cached = pathCache.get<ArbitragePath[]>(cacheKey);
    if (cached) return cached;
    
    const paths: ArbitragePath[] = [];
    const pairs = this.tokenGraph.getPairs(tokenA, tokenB);
    
    // Find all DEX combinations for the same pair
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const buyDex = pairs[i];
        const sellDex = pairs[j];
        
        // Create buy on one DEX, sell on another
        const path: ArbitragePath = {
          id: `crossdex-${tokenA}-${tokenB}-${buyDex.dexName}-${sellDex.dexName}`,
          type: 'cross-dex',
          tokens: [buyDex.tokenA, buyDex.tokenB],
          dexes: [buyDex.dexName, sellDex.dexName],
          pairs: [buyDex, sellDex],
          isFlashLoanRequired: false,
        };
        
        paths.push(path);
        
        // Also create reverse path
        const reversePath: ArbitragePath = {
          id: `crossdex-${tokenA}-${tokenB}-${sellDex.dexName}-${buyDex.dexName}`,
          type: 'cross-dex',
          tokens: [buyDex.tokenA, buyDex.tokenB],
          dexes: [sellDex.dexName, buyDex.dexName],
          pairs: [sellDex, buyDex],
          isFlashLoanRequired: false,
        };
        
        paths.push(reversePath);
        
        if (paths.length >= maxPaths) break;
      }
      if (paths.length >= maxPaths) break;
    }
    
    pathCache.set(cacheKey, paths);
    logger.info(`Found ${paths.length} cross-DEX arbitrage paths for ${tokenA}-${tokenB}`);
    return paths;
  }
  
  /**
   * Enumerate all possible paths up to a certain hop count
   */
  async enumeratePaths(maxHops: number = 3): Promise<ArbitragePath[]> {
    if (!this.initialized) await this.initialize();
    
    const allPaths: ArbitragePath[] = [];
    
    if (Config.features.enableTriangularArb) {
      const triangularPaths = await this.findTriangularPaths();
      allPaths.push(...triangularPaths);
    }
    
    if (Config.features.enableCrossDexArb) {
      // Find cross-DEX paths for common pairs
      for (const tokenA of this.commonTokens) {
        for (const tokenB of this.commonTokens) {
          if (tokenA.address !== tokenB.address) {
            const crossDexPaths = await this.findCrossDexPaths(
              tokenA.address,
              tokenB.address
            );
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
  async evaluatePath(
    path: ArbitragePath,
    inputAmount: bigint
  ): Promise<PathEvaluation> {
    const router = getMultiDexRouter();
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
          
          const amounts = await adapter.getAmountsOut(
            [fromToken.address, toToken.address],
            currentAmount
          );
          
          currentAmount = amounts[1];
          totalGasEstimate += BigInt(150000); // Estimate per swap
          
          // Calculate price impact
          const priceOracle = getPriceOracle();
          const impact = await priceOracle.calculatePriceImpact(
            fromToken.address,
            toToken.address,
            amounts[0],
            dexName
          );
          totalPriceImpact += impact;
        }
      } else if (path.type === 'cross-dex') {
        // For cross-DEX arb: Buy on DEX1, Sell on DEX2
        const [buyDex, sellDex] = path.dexes;
        const [tokenIn, tokenOut] = path.tokens;
        
        // Get buy quote
        const buyAdapter = router.getAdapters().get(buyDex.toLowerCase());
        const buyAmounts = await buyAdapter!.getAmountsOut(
          [tokenIn.address, tokenOut.address],
          currentAmount
        );
        
        // Get sell quote (reverse direction)
        const sellAdapter = router.getAdapters().get(sellDex.toLowerCase());
        const sellAmounts = await sellAdapter!.getAmountsOut(
          [tokenOut.address, tokenIn.address],
          buyAmounts[1]
        );
        
        currentAmount = sellAmounts[1];
        totalGasEstimate = BigInt(300000); // Two swaps
        
        // Calculate price impacts
        const priceOracle = getPriceOracle();
        const buyImpact = await priceOracle.calculatePriceImpact(
          tokenIn.address,
          tokenOut.address,
          inputAmount,
          buyDex
        );
        const sellImpact = await priceOracle.calculatePriceImpact(
          tokenOut.address,
          tokenIn.address,
          buyAmounts[1],
          sellDex
        );
        
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
    } catch (error) {
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
  private constructTriangularPath(
    tokenA: string,
    tokenB: string,
    tokenC: string
  ): ArbitragePath | null {
    const pairsAB = this.tokenGraph.getPairs(tokenA, tokenB);
    const pairsBC = this.tokenGraph.getPairs(tokenB, tokenC);
    const pairsCA = this.tokenGraph.getPairs(tokenC, tokenA);
    
    if (pairsAB.length === 0 || pairsBC.length === 0 || pairsCA.length === 0) {
      return null;
    }
    
    // Find tokens by address
    const findToken = (address: string): Token => {
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
  clearCache(): void {
    pathCache.flushAll();
    logger.info('Path cache cleared');
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): object {
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

// Export singleton instance
let pathfinder: Pathfinder | null = null;

export function getPathfinder(): Pathfinder {
  if (!pathfinder) {
    pathfinder = new Pathfinder();
  }
  return pathfinder;
}
