"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceOracleAdapter = void 0;
exports.getPriceOracle = getPriceOracle;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const polygonProvider_1 = require("../providers/polygonProvider");
const abi_1 = require("../utils/abi");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
const node_cache_1 = __importDefault(require("node-cache"));
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'price-oracle-adapter' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
// Shorter TTL for live trading
const priceCache = new node_cache_1.default({
    stdTTL: 5, // 5 seconds for live prices
    checkperiod: 2,
    useClones: false,
});
// Updated Chainlink Oracle configurations for Polygon
// Verify these addresses at: https://docs.chain.link/data-feeds/price-feeds/addresses?network=polygon
const CHAINLINK_ORACLES = {
    'MATIC/USD': {
        address: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
        decimals: 8,
        heartbeat: 27, // Polygon mainnet heartbeat for MATIC/USD
        description: 'MATIC / USD',
        priority: 100,
    },
    'ETH/USD': {
        address: '0xF9680D99D6C9589e2a93a78A04A279e509205945',
        decimals: 8,
        heartbeat: 27,
        description: 'ETH / USD',
        priority: 100,
    },
    'BTC/USD': {
        address: '0xc907E116054Ad103354f2D350FD2514433D57F6f',
        decimals: 8,
        heartbeat: 27,
        description: 'BTC / USD',
        priority: 100,
    },
    'USDC/USD': {
        address: '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7',
        decimals: 8,
        heartbeat: 86400, // 24 hours for stablecoins
        description: 'USDC / USD',
        priority: 90,
    },
    'USDT/USD': {
        address: '0x0A6513e40db6EB1b165753AD52E80663aeA50545',
        decimals: 8,
        heartbeat: 86400,
        description: 'USDT / USD',
        priority: 90,
    },
    'DAI/USD': {
        address: '0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D',
        decimals: 8,
        heartbeat: 3600,
        description: 'DAI / USD',
        priority: 90,
    },
};
const TOKEN_ADDRESSES = {
    WMATIC: config_1.ADDRESSES.WMATIC,
    MATIC: config_1.ADDRESSES.WMATIC,
    USDC: config_1.ADDRESSES.USDC,
    USDT: config_1.ADDRESSES.USDT,
    DAI: config_1.ADDRESSES.DAI,
    WETH: config_1.ADDRESSES.WETH,
    ETH: config_1.ADDRESSES.WETH,
    WBTC: config_1.ADDRESSES.WBTC,
    BTC: config_1.ADDRESSES.WBTC,
};
class PriceOracleAdapter {
    provider;
    chainlinkContracts = new Map();
    priceUpdateListeners = new Map();
    lastPrices = new Map();
    constructor(provider) {
        this.provider = provider;
        this.initializeOracles();
        this.startPriceUpdates();
    }
    initializeOracles() {
        for (const [pair, config] of Object.entries(CHAINLINK_ORACLES)) {
            try {
                const contract = new ethers_1.Contract(config.address, abi_1.CHAINLINK_ORACLE_ABI, this.provider);
                this.chainlinkContracts.set(pair, contract);
                logger.info(`Initialized Chainlink oracle: ${pair} at ${config.address}`);
            }
            catch (error) {
                logger.error(`Failed to initialize oracle for ${pair}:`, error);
            }
        }
        logger.info(`Initialized ${this.chainlinkContracts.size} Chainlink oracles`);
    }
    /**
     * Start background price updates for critical pairs
     */
    startPriceUpdates() {
        const criticalPairs = ['MATIC/USD', 'ETH/USD', 'BTC/USD'];
        criticalPairs.forEach(pair => {
            // Initial fetch
            this.getChainlinkPrice(pair).catch(err => logger.error(`Initial price fetch failed for ${pair}:`, err));
            // Set up periodic updates every 5 seconds
            const timer = setInterval(async () => {
                try {
                    await this.getChainlinkPrice(pair);
                }
                catch (error) {
                    logger.error(`Background price update failed for ${pair}:`, error);
                }
            }, 5000);
            this.priceUpdateListeners.set(pair, timer);
        });
        logger.info('Started background price updates for critical pairs');
    }
    /**
     * Get Chainlink price with improved error handling and staleness checks
     */
    async getChainlinkPrice(pair) {
        const cacheKey = `chainlink:${pair}`;
        const cached = priceCache.get(cacheKey);
        if (cached)
            return cached;
        const contract = this.chainlinkContracts.get(pair);
        const config = CHAINLINK_ORACLES[pair];
        if (!contract || !config) {
            logger.warn(`Chainlink oracle not found for ${pair}`);
            return null;
        }
        try {
            const roundData = await contract.latestRoundData();
            const price = Number(roundData.answer) / Math.pow(10, config.decimals);
            const updatedAt = Number(roundData.updatedAt);
            const currentTime = Math.floor(Date.now() / 1000);
            const roundId = roundData.roundId.toString();
            // Check if price is stale
            const age = currentTime - updatedAt;
            if (age > config.heartbeat) {
                logger.warn(`Chainlink price for ${pair} is stale (${age}s old, heartbeat: ${config.heartbeat}s)`);
                // For critical pairs, try to use last known good price
                if (age > config.heartbeat * 5) { // If >5x heartbeat
                    logger.error(`Chainlink price for ${pair} is severely stale, falling back to DEX`);
                    return null;
                }
            }
            // Sanity check the price
            if (price <= 0 || !isFinite(price)) {
                logger.error(`Invalid Chainlink price for ${pair}: ${price}`);
                return null;
            }
            const priceData = {
                price,
                timestamp: updatedAt * 1000,
                source: 'chainlink',
                confidence: age <= config.heartbeat ? 1 : Math.max(0.5, 1 - (age / config.heartbeat) / 5),
                roundId,
            };
            priceCache.set(cacheKey, priceData);
            this.lastPrices.set(pair, priceData);
            logger.debug(`Chainlink price for ${pair}: $${price.toFixed(4)} (age: ${age}s, round: ${roundId})`);
            return priceData;
        }
        catch (error) {
            logger.error(`Failed to get Chainlink price for ${pair}:`, error);
            // Return last known good price if available
            const lastPrice = this.lastPrices.get(pair);
            if (lastPrice) {
                const age = Date.now() - lastPrice.timestamp;
                if (age < 60000) { // Less than 1 minute old
                    logger.info(`Using last known price for ${pair} (${age}ms old)`);
                    return { ...lastPrice, confidence: 0.7 };
                }
            }
            return null;
        }
    }
    /**
     * Get DEX price with improved routing
     */
    async getDexPrice(tokenA, tokenB) {
        const cacheKey = `dex:${tokenA}:${tokenB}`;
        const cached = priceCache.get(cacheKey);
        if (cached)
            return cached;
        try {
            const { getMultiDexRouter } = await Promise.resolve().then(() => __importStar(require('./dexRouterAdapter')));
            const router = getMultiDexRouter();
            const tokenAInfo = await router.getTokenInfo(tokenA);
            const oneToken = BigInt(10) ** BigInt(tokenAInfo.decimals);
            // Get quotes from all available DEXs
            const quote = await router.getBestQuote(tokenA, tokenB, oneToken);
            if (!quote)
                return null;
            const tokenBInfo = await router.getTokenInfo(tokenB);
            const outputAmount = parseFloat((0, math_1.fromWei)(quote.amountOut, tokenBInfo.decimals));
            // Confidence based on liquidity and price impact
            const confidence = Math.max(0.5, Math.min(0.9, 1 - (quote.priceImpact / 10)));
            const priceData = {
                price: outputAmount,
                timestamp: Date.now(),
                source: 'dex',
                confidence,
            };
            priceCache.set(cacheKey, priceData);
            return priceData;
        }
        catch (error) {
            logger.error(`Failed to get DEX price for ${tokenA}/${tokenB}:`, error);
            return null;
        }
    }
    /**
     * Get live token price in USD with best available source
     */
    async getTokenPriceUSD(tokenSymbolOrAddress) {
        const tokenAddress = TOKEN_ADDRESSES[tokenSymbolOrAddress.toUpperCase()] || tokenSymbolOrAddress;
        // Stablecoins always return 1.0
        if (this.isStablecoin(tokenAddress)) {
            return 1.0;
        }
        // Try Chainlink first (most reliable)
        const chainlinkPair = this.getChainlinkPair(tokenAddress);
        if (chainlinkPair) {
            const chainlinkPrice = await this.getChainlinkPrice(chainlinkPair);
            if (chainlinkPrice && chainlinkPrice.confidence && chainlinkPrice.confidence > 0.7) {
                return chainlinkPrice.price;
            }
        }
        // Fallback to DEX prices against USDC
        const usdcAddress = config_1.ADDRESSES.USDC;
        const dexPrice = await this.getDexPrice(tokenAddress, usdcAddress);
        if (dexPrice && dexPrice.confidence && dexPrice.confidence > 0.5) {
            return dexPrice.price;
        }
        // Last resort: triangular pricing through MATIC
        const maticPrice = await this.getChainlinkPrice('MATIC/USD');
        if (maticPrice && maticPrice.confidence && maticPrice.confidence > 0.7) {
            const tokenToMatic = await this.getDexPrice(tokenAddress, config_1.ADDRESSES.WMATIC);
            if (tokenToMatic) {
                const usdPrice = tokenToMatic.price * maticPrice.price;
                logger.info(`Calculated ${tokenSymbolOrAddress} price via MATIC: $${usdPrice.toFixed(4)}`);
                return usdPrice;
            }
        }
        logger.warn(`Could not determine USD price for ${tokenSymbolOrAddress}`);
        return null;
    }
    /**
     * Get real-time price with source preference
     */
    async getPrice(tokenA, tokenB) {
        const cacheKey = `pair:${tokenA}:${tokenB}`;
        const cached = priceCache.get(cacheKey);
        if (cached)
            return cached;
        const addressA = TOKEN_ADDRESSES[tokenA.toUpperCase()] || tokenA;
        const addressB = TOKEN_ADDRESSES[tokenB.toUpperCase()] || tokenB;
        const sources = [];
        let price = null;
        // Try DEX price first for token pairs (more real-time)
        const dexPrice = await this.getDexPrice(addressA, addressB);
        if (dexPrice) {
            price = dexPrice.price;
            sources.push('dex');
        }
        // Fallback to derived USD prices
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
        if (!price)
            return null;
        const pairPrice = {
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
    async getPoolReserves(poolAddress) {
        try {
            const poolContract = new ethers_1.Contract(poolAddress, abi_1.interfaces.UniswapV2Pair, this.provider);
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
        }
        catch (error) {
            logger.error(`Failed to get pool reserves for ${poolAddress}:`, error);
            return null;
        }
    }
    async calculatePriceImpact(tokenIn, tokenOut, amountIn, dexName) {
        try {
            const { getMultiDexRouter } = await Promise.resolve().then(() => __importStar(require('./dexRouterAdapter')));
            const router = getMultiDexRouter();
            if (dexName) {
                const adapters = router.getAdapters();
                const adapter = adapters.get(dexName.toLowerCase());
                if (adapter) {
                    const reserves = await adapter.getReserves(tokenIn, tokenOut);
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
        }
        catch (error) {
            logger.error('Failed to calculate price impact:', error);
            return 0;
        }
    }
    async getAggregatedPrice(tokenA, tokenB) {
        const prices = [];
        // Chainlink price (highest weight)
        const chainlinkPair = this.getChainlinkPairForTokens(tokenA, tokenB);
        if (chainlinkPair) {
            const chainlinkPrice = await this.getChainlinkPrice(chainlinkPair);
            if (chainlinkPrice && chainlinkPrice.confidence && chainlinkPrice.confidence > 0.7) {
                prices.push({
                    price: chainlinkPrice.price,
                    weight: 3,
                    source: 'chainlink'
                });
            }
        }
        // DEX price (medium weight)
        const dexPrice = await this.getDexPrice(tokenA, tokenB);
        if (dexPrice && dexPrice.confidence && dexPrice.confidence > 0.5) {
            prices.push({
                price: dexPrice.price,
                weight: 2,
                source: 'dex'
            });
        }
        // USD derived price (lower weight)
        if (prices.length === 0) {
            const [priceAUSD, priceBUSD] = await Promise.all([
                this.getTokenPriceUSD(tokenA),
                this.getTokenPriceUSD(tokenB),
            ]);
            if (priceAUSD && priceBUSD) {
                prices.push({
                    price: priceAUSD / priceBUSD,
                    weight: 1,
                    source: 'usd-derived'
                });
            }
        }
        if (prices.length === 0) {
            throw new Error(`No price sources available for ${tokenA}/${tokenB}`);
        }
        // Weighted average
        const totalWeight = prices.reduce((sum, p) => sum + p.weight, 0);
        const weightedSum = prices.reduce((sum, p) => sum + (p.price * p.weight), 0);
        const finalPrice = weightedSum / totalWeight;
        // Calculate confidence based on number of sources and agreement
        const maxDeviation = Math.max(...prices.map(p => Math.abs(p.price - finalPrice) / finalPrice));
        const confidence = Math.max(0.5, Math.min(1, (1 - maxDeviation) * (prices.length / 3)));
        logger.debug(`Aggregated price for ${tokenA}/${tokenB}: $${finalPrice.toFixed(6)} from ${prices.length} sources`);
        return {
            price: finalPrice,
            timestamp: Date.now(),
            source: 'aggregated',
            confidence,
        };
    }
    async validatePrice(tokenA, tokenB, price, tolerancePercent = 5) {
        try {
            const aggregatedPrice = await this.getAggregatedPrice(tokenA, tokenB);
            const deviation = Math.abs((price - aggregatedPrice.price) / aggregatedPrice.price * 100);
            if (deviation > tolerancePercent) {
                logger.warn(`Price deviation detected: ${deviation.toFixed(2)}% for ${tokenA}/${tokenB}`);
                return false;
            }
            return true;
        }
        catch (error) {
            logger.error('Price validation failed:', error);
            return false;
        }
    }
    isStablecoin(tokenAddress) {
        const stablecoins = [
            config_1.ADDRESSES.USDC,
            config_1.ADDRESSES.USDT,
            config_1.ADDRESSES.DAI,
        ].map(a => a.toLowerCase());
        return stablecoins.includes(tokenAddress.toLowerCase());
    }
    getChainlinkPair(tokenAddress) {
        const addressLower = tokenAddress.toLowerCase();
        if (addressLower === config_1.ADDRESSES.WMATIC.toLowerCase())
            return 'MATIC/USD';
        if (addressLower === config_1.ADDRESSES.WETH.toLowerCase())
            return 'ETH/USD';
        if (addressLower === config_1.ADDRESSES.WBTC.toLowerCase())
            return 'BTC/USD';
        if (addressLower === config_1.ADDRESSES.USDC.toLowerCase())
            return 'USDC/USD';
        if (addressLower === config_1.ADDRESSES.USDT.toLowerCase())
            return 'USDT/USD';
        if (addressLower === config_1.ADDRESSES.DAI.toLowerCase())
            return 'DAI/USD';
        return null;
    }
    getChainlinkPairForTokens(tokenA, _tokenB) {
        return this.getChainlinkPair(tokenA);
    }
    /**
     * Get health status of all oracles
     */
    getOracleHealth() {
        const health = {};
        for (const [pair, priceData] of this.lastPrices.entries()) {
            const age = Date.now() - priceData.timestamp;
            const config = CHAINLINK_ORACLES[pair];
            health[pair] = {
                price: priceData.price,
                age: `${(age / 1000).toFixed(1)}s`,
                confidence: priceData.confidence,
                isHealthy: age < (config?.heartbeat || 60) * 1000,
                roundId: priceData.roundId,
            };
        }
        return health;
    }
    clearCache() {
        priceCache.flushAll();
        logger.info('Price cache cleared');
    }
    getCacheStats() {
        const stats = priceCache.getStats();
        return {
            keys: priceCache.keys().length,
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%' : '0%',
        };
    }
    /**
     * Cleanup background tasks
     */
    destroy() {
        for (const [pair, timer] of this.priceUpdateListeners.entries()) {
            clearInterval(timer);
            logger.info(`Stopped price updates for ${pair}`);
        }
        this.priceUpdateListeners.clear();
    }
}
exports.PriceOracleAdapter = PriceOracleAdapter;
let priceOracle = null;
function getPriceOracle() {
    if (!priceOracle) {
        const currentProvider = polygonProvider_1.provider.get();
        priceOracle = new PriceOracleAdapter(currentProvider);
    }
    return priceOracle;
}
//# sourceMappingURL=priceOracleAdapter.js.map