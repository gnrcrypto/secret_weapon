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
const priceCache = new node_cache_1.default({
    stdTTL: config_1.Config.performance.priceCacheTtlMs / 1000,
    checkperiod: 60,
    useClones: false,
});
const CHAINLINK_ORACLES = {
    'MATIC/USD': {
        address: abi_1.POLYGON_ADDRESSES.CHAINLINK_MATIC_USD,
        decimals: 8,
        heartbeat: 120,
        description: 'MATIC / USD',
    },
    'ETH/USD': {
        address: abi_1.POLYGON_ADDRESSES.CHAINLINK_ETH_USD,
        decimals: 8,
        heartbeat: 120,
        description: 'ETH / USD',
    },
    'BTC/USD': {
        address: abi_1.POLYGON_ADDRESSES.CHAINLINK_BTC_USD,
        decimals: 8,
        heartbeat: 120,
        description: 'BTC / USD',
    },
    'USDC/USD': {
        address: abi_1.POLYGON_ADDRESSES.CHAINLINK_USDC_USD,
        decimals: 8,
        heartbeat: 3600,
        description: 'USDC / USD',
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
    constructor(provider) {
        this.provider = provider;
        this.initializeOracles();
    }
    initializeOracles() {
        for (const [pair, config] of Object.entries(CHAINLINK_ORACLES)) {
            const contract = new ethers_1.Contract(config.address, abi_1.CHAINLINK_ORACLE_ABI, this.provider);
            this.chainlinkContracts.set(pair, contract);
        }
        logger.info(`Initialized ${this.chainlinkContracts.size} Chainlink oracles`);
    }
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
            const price = Number(roundData.price) / Math.pow(10, config.decimals);
            const updatedAt = Number(roundData.updatedAt);
            const currentTime = Math.floor(Date.now() / 1000);
            if (currentTime - updatedAt > config.heartbeat) {
                logger.warn(`Chainlink price for ${pair} is stale (${currentTime - updatedAt}s old)`);
            }
            const priceData = {
                price,
                timestamp: updatedAt * 1000,
                source: 'chainlink',
                confidence: currentTime - updatedAt <= config.heartbeat ? 1 : 0.5,
            };
            priceCache.set(cacheKey, priceData);
            return priceData;
        }
        catch (error) {
            logger.error(`Failed to get Chainlink price for ${pair}:`, error);
            return null;
        }
    }
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
            const quote = await router.getBestQuote(tokenA, tokenB, oneToken);
            if (!quote)
                return null;
            const tokenBInfo = await router.getTokenInfo(tokenB);
            const outputAmount = parseFloat((0, math_1.fromWei)(quote.amountOut, tokenBInfo.decimals));
            const priceData = {
                price: outputAmount,
                timestamp: Date.now(),
                source: 'dex',
                confidence: 0.8,
            };
            priceCache.set(cacheKey, priceData);
            return priceData;
        }
        catch (error) {
            logger.error(`Failed to get DEX price for ${tokenA}/${tokenB}:`, error);
            return null;
        }
    }
    async getTokenPriceUSD(tokenSymbolOrAddress) {
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
        const usdcAddress = config_1.ADDRESSES.USDC;
        const dexPrice = await this.getDexPrice(tokenAddress, usdcAddress);
        if (dexPrice) {
            return dexPrice.price;
        }
        const maticPrice = await this.getChainlinkPrice('MATIC/USD');
        if (maticPrice) {
            const tokenToMatic = await this.getDexPrice(tokenAddress, config_1.ADDRESSES.WMATIC);
            if (tokenToMatic) {
                return tokenToMatic.price * maticPrice.price;
            }
        }
        logger.warn(`Could not determine USD price for ${tokenSymbolOrAddress}`);
        return null;
    }
    async getPrice(tokenA, tokenB) {
        const cacheKey = `pair:${tokenA}:${tokenB}`;
        const cached = priceCache.get(cacheKey);
        if (cached)
            return cached;
        const addressA = TOKEN_ADDRESSES[tokenA.toUpperCase()] || tokenA;
        const addressB = TOKEN_ADDRESSES[tokenB.toUpperCase()] || tokenB;
        const sources = [];
        let price = null;
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
        const sources = [];
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
        return null;
    }
    getChainlinkPairForTokens(tokenA, _tokenB) {
        return this.getChainlinkPair(tokenA);
    }
    clearCache() {
        priceCache.flushAll();
        logger.info('Price cache cleared');
    }
    getCacheStats() {
        return {
            keys: priceCache.keys().length,
            hits: priceCache.getStats().hits,
            misses: priceCache.getStats().misses,
            hitRate: (priceCache.getStats().hits / (priceCache.getStats().hits + priceCache.getStats().misses) * 100).toFixed(2) + '%',
        };
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