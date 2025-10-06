import { Contract, JsonRpcProvider } from 'ethers';
import { Config, ADDRESSES } from '../config';
import { provider } from '../providers/polygonProvider';
import { 
  interfaces,
  POLYGON_ADDRESSES,
  CHAINLINK_ORACLE_ABI
} from '../utils/abi';
import { fromWei } from '../utils/math';
import winston from 'winston';
import NodeCache from 'node-cache';

const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'price-oracle-adapter' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

const priceCache = new NodeCache({
  stdTTL: Config.performance.priceCacheTtlMs / 1000,
  checkperiod: 60,
  useClones: false,
});

interface OracleConfig {
  address: string;
  decimals: number;
  heartbeat: number;
  description?: string;
}

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

const CHAINLINK_ORACLES: Record<string, OracleConfig> = {
  'MATIC/USD': {
    address: POLYGON_ADDRESSES.CHAINLINK_MATIC_USD,
    decimals: 8,
    heartbeat: 120,
    description: 'MATIC / USD',
  },
  'ETH/USD': {
    address: POLYGON_ADDRESSES.CHAINLINK_ETH_USD,
    decimals: 8,
    heartbeat: 120,
    description: 'ETH / USD',
  },
  'BTC/USD': {
    address: POLYGON_ADDRESSES.CHAINLINK_BTC_USD,
    decimals: 8,
    heartbeat: 120,
    description: 'BTC / USD',
  },
  'USDC/USD': {
    address: POLYGON_ADDRESSES.CHAINLINK_USDC_USD,
    decimals: 8,
    heartbeat: 3600,
    description: 'USDC / USD',
  },
};

const TOKEN_ADDRESSES: Record<string, string> = {
  WMATIC: ADDRESSES.WMATIC,
  MATIC: ADDRESSES.WMATIC,
  USDC: ADDRESSES.USDC,
  USDT: ADDRESSES.USDT,
  DAI: ADDRESSES.DAI,
  WETH: ADDRESSES.WETH,
  ETH: ADDRESSES.WETH,
  WBTC: ADDRESSES.WBTC,
  BTC: ADDRESSES.WBTC,
};

export class PriceOracleAdapter {
  private chainlinkContracts: Map<string, Contract> = new Map();
  
  constructor(private provider: JsonRpcProvider) {
    this.initializeOracles();
  }
  
  private initializeOracles(): void {
    for (const [pair, config] of Object.entries(CHAINLINK_ORACLES)) {
      const contract = new Contract(
        config.address,
        CHAINLINK_ORACLE_ABI,
        this.provider
      );
      this.chainlinkContracts.set(pair, contract);
    }
    logger.info(`Initialized ${this.chainlinkContracts.size} Chainlink oracles`);
  }
  
  async getChainlinkPrice(pair: string): Promise<PriceData | null> {
    const cacheKey = `chainlink:${pair}`;
    const cached = priceCache.get<PriceData>(cacheKey);
    if (cached) return cached;
    
    const contract = this.chainlinkContracts.get(pair);
    const config = CHAINLINK_ORACLES[pair];
    
    if (!contract || !config) {
      logger.warn(`Chainlink oracle not found for ${pair}`);
      return null;
    }
    
    try {
      const roundData = await contract.latestRoundData();
      const price = Number(roundData.price) / Math.pow(10, config.decimals);
      const updatedAt = Number(roundData.updatedAt);
      const currentTime = Math.floor(Date.now() / 1000);
      
      if (currentTime - updatedAt > config.heartbeat) {
        logger.warn(`Chainlink price for ${pair} is stale (${currentTime - updatedAt}s old)`);
      }
      
      const priceData: PriceData = {
        price,
        timestamp: updatedAt * 1000,
        source: 'chainlink',
        confidence: currentTime - updatedAt <= config.heartbeat ? 1 : 0.5,
      };
      
      priceCache.set(cacheKey, priceData);
      return priceData;
    } catch (error) {
      logger.error(`Failed to get Chainlink price for ${pair}:`, error);
      return null;
    }
  }
  
  async getDexPrice(tokenA: string, tokenB: string): Promise<PriceData | null> {
    const cacheKey = `dex:${tokenA}:${tokenB}`;
    const cached = priceCache.get<PriceData>(cacheKey);
    if (cached) return cached;
    
    try {
      const { getMultiDexRouter } = await import('./dexRouterAdapter');
      const router = getMultiDexRouter();
      
      const tokenAInfo = await router.getTokenInfo(tokenA);
      const oneToken = BigInt(10) ** BigInt(tokenAInfo.decimals);
      
      const quote = await router.getBestQuote(tokenA, tokenB, oneToken);
      
      if (!quote) return null;
      
      const tokenBInfo = await router.getTokenInfo(tokenB);
      const outputAmount = parseFloat(fromWei(quote.amountOut, tokenBInfo.decimals));
      
      const priceData: PriceData = {
        price: outputAmount,
        timestamp: Date.now(),
        source: 'dex',
        confidence: 0.8,
      };
      
      priceCache.set(cacheKey, priceData);
      return priceData;
    } catch (error) {
      logger.error(`Failed to get DEX price for ${tokenA}/${tokenB}:`, error);
      return null;
    }
  }
  
  async getTokenPriceUSD(tokenSymbolOrAddress: string): Promise<number | null> {
    const tokenAddress = TOKEN_ADDRESSES[tokenSymbolOrAddress.toUpperCase()] || tokenSymbolOrAddress;
    
    if (this.isStablecoin(tokenAddress)) {
      return 1.0;
    }
    
    const chainlinkPair = this.getChainlinkPair(tokenAddress);
    if (chainlinkPair) {
      const chainlinkPrice = await this.getChainlinkPrice(chainlinkPair);
      if (chainlinkPrice && chainlinkPrice.confidence && chainlinkPrice.confidence > 0.5) {
        return chainlinkPrice.price;
      }
    }
    
    const usdcAddress = ADDRESSES.USDC;
    const dexPrice = await this.getDexPrice(tokenAddress, usdcAddress);
    
    if (dexPrice) {
      return dexPrice.price;
    }
    
    const maticPrice = await this.getChainlinkPrice('MATIC/USD');
    if (maticPrice) {
      const tokenToMatic = await this.getDexPrice(tokenAddress, ADDRESSES.WMATIC);
      if (tokenToMatic) {
        return tokenToMatic.price * maticPrice.price;
      }
    }
    
    logger.warn(`Could not determine USD price for ${tokenSymbolOrAddress}`);
    return null;
  }
  
  async getPrice(tokenA: string, tokenB: string): Promise<TokenPairPrice | null> {
    const cacheKey = `pair:${tokenA}:${tokenB}`;
    const cached = priceCache.get<TokenPairPrice>(cacheKey);
    if (cached) return cached;
    
    const addressA = TOKEN_ADDRESSES[tokenA.toUpperCase()] || tokenA;
    const addressB = TOKEN_ADDRESSES[tokenB.toUpperCase()] || tokenB;
    
    const sources: string[] = [];
    let price: number | null = null;
    
    const dexPrice = await this.getDexPrice(addressA, addressB);
    if (dexPrice) {
      price = dexPrice.price;
      sources.push('dex');
    }
    
    if (!price) {
      const [priceAUSD, priceBUSD] = await Promise.all([
        this.getTokenPriceUSD(addressA),
        this.getTokenPriceUSD(addressB),
      ]);
      
      if (priceAUSD && priceBUSD) {
        price = priceAUSD / priceBUSD;
        sources.push('chainlink-derived');
      }
    }
    
    if (!price) return null;
    
    const pairPrice: TokenPairPrice = {
      tokenA: addressA,
      tokenB: addressB,
      price,
      inversePrice: 1 / price,
      timestamp: Date.now(),
      sources,
    };
    
    priceCache.set(cacheKey, pairPrice);
    return pairPrice;
  }
  
  async getPoolReserves(
    poolAddress: string
  ): Promise<{ reserve0: bigint; reserve1: bigint; token0: string; token1: string } | null> {
    try {
      const poolContract = new Contract(
        poolAddress,
        interfaces.UniswapV2Pair,
        this.provider
      );
      
      const [reserves, token0, token1] = await Promise.all([
        poolContract.getReserves(),
        poolContract.token0(),
        poolContract.token1(),
      ]);
      
      return {
        reserve0: BigInt(reserves[0]),
        reserve1: BigInt(reserves[1]),
        token0,
        token1,
      };
    } catch (error) {
      logger.error(`Failed to get pool reserves for ${poolAddress}:`, error);
      return null;
    }
  }
  
  async calculatePriceImpact(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    dexName?: string
  ): Promise<number> {
    try {
      const { getMultiDexRouter } = await import('./dexRouterAdapter');
      const router = getMultiDexRouter();
      
      if (dexName) {
        const adapters = router.getAdapters();
        const adapter = adapters.get(dexName.toLowerCase());
        if (adapter) {
          const reserves = await (adapter as any).getReserves(tokenIn, tokenOut);
          if (reserves) {
            const spotPrice = parseFloat(reserves.reserve1.toString()) / parseFloat(reserves.reserve0.toString());
            const amounts = await adapter.getAmountsOut([tokenIn, tokenOut], amountIn);
            const executionPrice = parseFloat(amounts[1].toString()) / parseFloat(amountIn.toString());
            return Math.abs((executionPrice - spotPrice) / spotPrice * 100);
          }
        }
      }
      
      const quote = await router.getBestQuote(tokenIn, tokenOut, amountIn);
      return quote?.priceImpact || 0;
    } catch (error) {
      logger.error('Failed to calculate price impact:', error);
      return 0;
    }
  }
  
  async getAggregatedPrice(tokenA: string, tokenB: string): Promise<PriceData> {
    const prices: number[] = [];
    const sources: string[] = [];
    
    const chainlinkPair = this.getChainlinkPairForTokens(tokenA, tokenB);
    if (chainlinkPair) {
      const chainlinkPrice = await this.getChainlinkPrice(chainlinkPair);
      if (chainlinkPrice && chainlinkPrice.confidence && chainlinkPrice.confidence > 0.5) {
        prices.push(chainlinkPrice.price);
        sources.push('chainlink');
      }
    }
    
    const dexPrice = await this.getDexPrice(tokenA, tokenB);
    if (dexPrice) {
      prices.push(dexPrice.price);
      sources.push('dex');
    }
    
    if (prices.length === 0) {
      const [priceAUSD, priceBUSD] = await Promise.all([
        this.getTokenPriceUSD(tokenA),
        this.getTokenPriceUSD(tokenB),
      ]);
      
      if (priceAUSD && priceBUSD) {
        prices.push(priceAUSD / priceBUSD);
        sources.push('usd-derived');
      }
    }
    
    if (prices.length === 0) {
      throw new Error(`No price sources available for ${tokenA}/${tokenB}`);
    }
    
    let totalWeight = 0;
    let weightedSum = 0;
    
    prices.forEach((price, index) => {
      const weight = sources[index] === 'chainlink' ? 2 : 1;
      weightedSum += price * weight;
      totalWeight += weight;
    });
    
    return {
      price: weightedSum / totalWeight,
      timestamp: Date.now(),
      source: 'aggregated',
      confidence: Math.min(1, prices.length / 2),
    };
  }
  
  async validatePrice(
    tokenA: string,
    tokenB: string,
    price: number,
    tolerancePercent: number = 5
  ): Promise<boolean> {
    try {
      const aggregatedPrice = await this.getAggregatedPrice(tokenA, tokenB);
      const deviation = Math.abs((price - aggregatedPrice.price) / aggregatedPrice.price * 100);
      
      if (deviation > tolerancePercent) {
        logger.warn(`Price deviation detected: ${deviation.toFixed(2)}% for ${tokenA}/${tokenB}`);
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Price validation failed:', error);
      return false;
    }
  }
  
  private isStablecoin(tokenAddress: string): boolean {
    const stablecoins = [
      ADDRESSES.USDC,
      ADDRESSES.USDT,
      ADDRESSES.DAI,
    ].map(a => a.toLowerCase());
    
    return stablecoins.includes(tokenAddress.toLowerCase());
  }
  
  private getChainlinkPair(tokenAddress: string): string | null {
    const addressLower = tokenAddress.toLowerCase();
    
    if (addressLower === ADDRESSES.WMATIC.toLowerCase()) return 'MATIC/USD';
    if (addressLower === ADDRESSES.WETH.toLowerCase()) return 'ETH/USD';
    if (addressLower === ADDRESSES.WBTC.toLowerCase()) return 'BTC/USD';
    if (addressLower === ADDRESSES.USDC.toLowerCase()) return 'USDC/USD';
    
    return null;
  }
  
  private getChainlinkPairForTokens(tokenA: string, _tokenB: string): string | null {
    return this.getChainlinkPair(tokenA);
  }
  
  clearCache(): void {
    priceCache.flushAll();
    logger.info('Price cache cleared');
  }
  
  getCacheStats(): object {
    return {
      keys: priceCache.keys().length,
      hits: priceCache.getStats().hits,
      misses: priceCache.getStats().misses,
      hitRate: (priceCache.getStats().hits / (priceCache.getStats().hits + priceCache.getStats().misses) * 100).toFixed(2) + '%',
    };
  }
}

let priceOracle: PriceOracleAdapter | null = null;

export function getPriceOracle(): PriceOracleAdapter {
  if (!priceOracle) {
    const currentProvider = provider.get();
    priceOracle = new PriceOracleAdapter(currentProvider as JsonRpcProvider);
  }
  return priceOracle;
}
