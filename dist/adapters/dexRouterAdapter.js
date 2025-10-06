"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiDexRouter = exports.DexAdapter = void 0;
exports.getMultiDexRouter = getMultiDexRouter;
const ethers_1 = require("ethers");
const ethers_2 = require("ethers");
const config_1 = require("../config");
const polygonProvider_1 = require("../providers/polygonProvider");
const abi_1 = require("../utils/abi");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'dex-router-adapter' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
/**
 * DEX configurations for Polygon
 */
const DEX_CONFIGS = {
    quickswap: {
        name: 'QuickSwap',
        router: abi_1.POLYGON_ADDRESSES.QUICKSWAP_ROUTER,
        factory: abi_1.POLYGON_ADDRESSES.QUICKSWAP_FACTORY,
        initCodeHash: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
        fee: 30, // 0.3%
    },
    sushiswap: {
        name: 'SushiSwap',
        router: abi_1.POLYGON_ADDRESSES.SUSHISWAP_ROUTER,
        factory: abi_1.POLYGON_ADDRESSES.SUSHISWAP_FACTORY,
        initCodeHash: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
        fee: 30, // 0.3%
    },
    uniswapv3: {
        name: 'UniswapV3',
        router: abi_1.POLYGON_ADDRESSES.UNISWAPV3_ROUTER,
        factory: '', // V3 uses pool addresses directly
        fee: 30, // Variable fees in V3 (0.05%, 0.3%, 1%)
        isV3: true,
    },
};
/**
 * Base DEX adapter class
 */
class DexAdapter {
    config;
    provider;
    signer;
    contract;
    factoryContract = null;
    routerInterface;
    constructor(config, provider, signer) {
        this.config = config;
        this.provider = provider;
        this.signer = signer;
        this.routerInterface = (0, abi_1.getRouterInterface)(config.name);
        this.contract = new ethers_2.Contract(config.router, this.routerInterface, signer || provider);
        if (config.factory && !config.isV3) {
            this.factoryContract = new ethers_2.Contract(config.factory, abi_1.interfaces.UniswapV2Factory, provider);
        }
    }
    /**
     * Get amounts out for a swap path
     */
    async getAmountsOut(path, amountIn) {
        try {
            if (this.config.isV3) {
                // V3 requires different handling
                return this.getAmountsOutV3(path, amountIn);
            }
            const amounts = await this.contract.getAmountsOut(amountIn, path);
            return amounts.map((a) => BigInt(a.toString()));
        }
        catch (error) {
            logger.error(`Error getting amounts out from ${this.config.name}:`, error);
            throw error;
        }
    }
    /**
     * Get amounts in for a swap path
     */
    async getAmountsIn(path, amountOut) {
        try {
            if (this.config.isV3) {
                // V3 requires different handling
                return this.getAmountsInV3(path, amountOut);
            }
            const amounts = await this.contract.getAmountsIn(amountOut, path);
            return amounts.map((a) => BigInt(a.toString()));
        }
        catch (error) {
            logger.error(`Error getting amounts in from ${this.config.name}:`, error);
            throw error;
        }
    }
    /**
     * Build swap transaction
     */
    async buildSwapTx(params) {
        const { tokenIn, tokenOut, amountIn, amountOutMin, recipient, deadline, } = params;
        if (this.config.isV3) {
            return this.buildSwapTxV3(params);
        }
        // Build path
        const path = [tokenIn, tokenOut];
        // Check if we need to wrap/unwrap MATIC
        const isFromMatic = tokenIn.toLowerCase() === 'native';
        const isToMatic = tokenOut.toLowerCase() === 'native';
        let methodName;
        let methodParams;
        let value = BigInt(0);
        if (isFromMatic) {
            methodName = 'swapExactETHForTokens';
            methodParams = [amountOutMin, [config_1.ADDRESSES.WMATIC, tokenOut], recipient, deadline];
            value = amountIn;
        }
        else if (isToMatic) {
            methodName = 'swapExactTokensForETH';
            methodParams = [amountIn, amountOutMin, [tokenIn, config_1.ADDRESSES.WMATIC], recipient, deadline];
        }
        else {
            methodName = 'swapExactTokensForTokens';
            methodParams = [amountIn, amountOutMin, path, recipient, deadline];
        }
        return {
            to: this.config.router,
            data: this.routerInterface.encodeFunctionData(methodName, methodParams),
            value,
        };
    }
    /**
     * Execute swap
     */
    async executeSwap(params) {
        if (config_1.Config.execution.mode === 'simulate') {
            logger.info(`SIMULATION: Would execute swap on ${this.config.name}`, params);
            return {
                transactionHash: '0xsimulated',
                amountIn: params.amountIn,
                amountOut: params.amountOutMin,
                gasUsed: BigInt(250000), // Estimated gas
                effectivePrice: parseFloat((0, math_1.fromWei)(params.amountOutMin)) / parseFloat((0, math_1.fromWei)(params.amountIn)),
            };
        }
        if (!this.signer) {
            throw new Error('Signer required for executing swaps');
        }
        const tx = await this.buildSwapTx(params);
        // Add gas settings
        const gasLimit = await this.estimateGas(tx);
        tx.gasLimit = gasLimit * BigInt(120) / BigInt(100); // Add 20% buffer
        // Send transaction
        const txResponse = await this.signer.sendTransaction(tx);
        const receipt = await txResponse.wait();
        if (!receipt || receipt.status !== 1) {
            throw new Error(`Swap failed: ${txResponse.hash}`);
        }
        // Parse logs to get actual amounts
        const swapLog = this.parseSwapLog(receipt.logs);
        return {
            transactionHash: receipt.hash,
            amountIn: params.amountIn,
            amountOut: swapLog?.amountOut || params.amountOutMin,
            gasUsed: receipt.gasUsed,
            effectivePrice: parseFloat((0, math_1.fromWei)(swapLog?.amountOut || params.amountOutMin)) / parseFloat((0, math_1.fromWei)(params.amountIn)),
        };
    }
    /**
     * Estimate gas for swap
     */
    async estimateGas(tx) {
        try {
            const estimate = await this.provider.estimateGas(tx);
            return estimate;
        }
        catch (error) {
            // Silent fallback - expected in simulate mode without tokens
            return BigInt(300000); // Default gas limit
        }
    }
    /**
     * Get pair address for two tokens
     */
    async getPairAddress(tokenA, tokenB) {
        if (!this.factoryContract)
            return null;
        try {
            const pair = await this.factoryContract.getPair(tokenA, tokenB);
            return pair !== '0x0000000000000000000000000000000000000000' ? pair : null;
        }
        catch (error) {
            logger.error(`Error getting pair address:`, error);
            return null;
        }
    }
    /**
     * Get reserves for a pair
     */
    async getReserves(tokenA, tokenB) {
        const pairAddress = await this.getPairAddress(tokenA, tokenB);
        if (!pairAddress)
            return null;
        try {
            const pairContract = new ethers_2.Contract(pairAddress, abi_1.interfaces.UniswapV2Pair, this.provider);
            const [reserve0, reserve1] = await pairContract.getReserves();
            const token0 = await pairContract.token0();
            // Order reserves based on token addresses
            if (token0.toLowerCase() === tokenA.toLowerCase()) {
                return { reserve0: BigInt(reserve0), reserve1: BigInt(reserve1) };
            }
            else {
                return { reserve0: BigInt(reserve1), reserve1: BigInt(reserve0) };
            }
        }
        catch (error) {
            logger.error(`Error getting reserves:`, error);
            return null;
        }
    }
    // V3 specific methods
    async getAmountsOutV3(_path, amountIn) {
        // Simplified V3 quote - in production, use Quoter contract
        logger.warn('V3 quotes not fully implemented, returning estimate');
        return [amountIn, amountIn * BigInt(997) / BigInt(1000)]; // 0.3% fee estimate
    }
    async getAmountsInV3(_path, amountOut) {
        // Simplified V3 quote - in production, use Quoter contract
        logger.warn('V3 quotes not fully implemented, returning estimate');
        return [amountOut * BigInt(1003) / BigInt(1000), amountOut]; // 0.3% fee estimate
    }
    buildSwapTxV3(params) {
        // Simplified V3 swap - in production, handle all swap types
        const swapParams = {
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            fee: 3000, // 0.3% tier
            recipient: params.recipient,
            deadline: params.deadline,
            amountIn: params.amountIn,
            amountOutMinimum: params.amountOutMin,
            sqrtPriceLimitX96: 0,
        };
        return {
            to: this.config.router,
            data: abi_1.interfaces.UniswapV3Router.encodeFunctionData('exactInputSingle', [swapParams]),
            value: BigInt(0),
        };
    }
    parseSwapLog(logs) {
        // Parse swap event from logs
        for (const log of logs) {
            try {
                const parsed = abi_1.interfaces.UniswapV2Pair.parseLog(log);
                if (parsed && parsed.name === 'Swap') {
                    const { amount0Out, amount1Out } = parsed.args;
                    const amountOut = amount0Out > 0 ? amount0Out : amount1Out;
                    return { amountOut: BigInt(amountOut) };
                }
            }
            catch {
                // Not a swap event
            }
        }
        return null;
    }
}
exports.DexAdapter = DexAdapter;
/**
 * Multi-DEX router that aggregates liquidity
 */
class MultiDexRouter {
    provider;
    signer;
    adapters = new Map();
    tokenCache = new Map();
    constructor(provider, signer) {
        this.provider = provider;
        this.signer = signer;
        this.initializeAdapters();
    }
    initializeAdapters() {
        const enabledDexes = config_1.Config.dex.enabledDexes;
        for (const dexName of enabledDexes) {
            const config = DEX_CONFIGS[dexName.toLowerCase()];
            if (config) {
                const adapter = new DexAdapter(config, this.provider, this.signer);
                this.adapters.set(dexName.toLowerCase(), adapter);
                logger.info(`Initialized ${config.name} adapter`);
            }
            else {
                logger.warn(`DEX config not found for ${dexName}`);
            }
        }
    }
    /**
     * Get best quote across all DEXs
     */
    async getBestQuote(tokenIn, tokenOut, amountIn, slippageBps = config_1.Config.execution.slippageBps) {
        // Get quotes from all DEXs in parallel
        const quotePromises = Array.from(this.adapters.entries()).map(async ([dexName, adapter]) => {
            try {
                const path = [tokenIn, tokenOut];
                const amounts = await adapter.getAmountsOut(path, amountIn);
                if (amounts.length < 2)
                    return null;
                const amountOut = amounts[amounts.length - 1];
                const minAmountOut = (0, math_1.calculateMinimumOutput)(amountOut, slippageBps);
                // Get reserves for price impact calculation
                const reserves = await adapter.getReserves(tokenIn, tokenOut);
                let priceImpact = 0;
                if (reserves) {
                    const spotPrice = parseFloat((0, math_1.fromWei)(reserves.reserve1)) / parseFloat((0, math_1.fromWei)(reserves.reserve0));
                    const executionPrice = parseFloat((0, math_1.fromWei)(amountOut)) / parseFloat((0, math_1.fromWei)(amountIn));
                    priceImpact = Math.abs((executionPrice - spotPrice) / spotPrice * 100);
                }
                return {
                    amountOut: minAmountOut,
                    path,
                    priceImpact,
                    executionPrice: parseFloat((0, math_1.fromWei)(amountOut)) / parseFloat((0, math_1.fromWei)(amountIn)),
                    dexName: adapter.config.name,
                    gasEstimate: BigInt(250000), // Rough estimate
                };
            }
            catch (error) {
                logger.debug(`Failed to get quote from ${dexName}:`, error);
                return null;
            }
        });
        const results = await Promise.all(quotePromises);
        // Filter out failed quotes and sort by output amount
        const validQuotes = results.filter((q) => {
            return q !== null && typeof q === 'object' && 'gasEstimate' in q && q.gasEstimate !== undefined;
        });
        validQuotes.sort((a, b) => {
            if (!a || !b)
                return 0;
            if (a.amountOut > b.amountOut)
                return -1;
            if (a.amountOut < b.amountOut)
                return 1;
            return 0;
        });
        if (validQuotes.length === 0) {
            logger.warn('No valid quotes found across any DEX');
            return null;
        }
        const bestQuote = validQuotes[0];
        if (!bestQuote) {
            logger.warn('No valid quotes found across any DEX');
            return null;
        }
        logger.info(`Best quote from ${bestQuote.dexName}: ${(0, math_1.fromWei)(bestQuote.amountOut)} output for ${(0, math_1.fromWei)(amountIn)} input`);
        return bestQuote;
    }
    /**
     * Execute swap on specific DEX
     */
    async executeSwapOnDex(dexName, params) {
        const adapter = this.adapters.get(dexName.toLowerCase());
        if (!adapter) {
            throw new Error(`DEX adapter not found for ${dexName}`);
        }
        return adapter.executeSwap(params);
    }
    /**
     * Execute swap with best available price
     */
    async executeBestSwap(tokenIn, tokenOut, amountIn, recipient, slippageBps) {
        const quote = await this.getBestQuote(tokenIn, tokenOut, amountIn, slippageBps);
        if (!quote) {
            throw new Error('No valid quotes available');
        }
        const params = {
            tokenIn,
            tokenOut,
            amountIn,
            amountOutMin: quote.amountOut,
            recipient: recipient || polygonProvider_1.wallet.getAddress(),
            deadline: Math.floor(Date.now() / 1000) + 300, // 5 minutes
            slippageBps,
        };
        return this.executeSwapOnDex(quote.dexName, params);
    }
    /**
     * Get token info
     */
    async getTokenInfo(tokenAddress) {
        if (this.tokenCache.has(tokenAddress)) {
            return this.tokenCache.get(tokenAddress);
        }
        try {
            const tokenContract = new ethers_2.Contract(tokenAddress, abi_1.ERC20_ABI, this.provider);
            const [symbol, decimals, name] = await Promise.all([
                tokenContract.symbol(),
                tokenContract.decimals(),
                tokenContract.name().catch(() => ''),
            ]);
            const info = {
                address: tokenAddress,
                symbol,
                decimals,
                name: name || symbol,
            };
            this.tokenCache.set(tokenAddress, info);
            return info;
        }
        catch (error) {
            logger.error(`Failed to get token info for ${tokenAddress}:`, error);
            throw error;
        }
    }
    /**
     * Approve token spending
     */
    async approveToken(tokenAddress, spenderAddress, amount) {
        if (!this.signer) {
            throw new Error('Signer required for approvals');
        }
        const tokenContract = new ethers_2.Contract(tokenAddress, abi_1.ERC20_ABI, this.signer);
        // Check current allowance
        const currentAllowance = await tokenContract.allowance(polygonProvider_1.wallet.getAddress(), spenderAddress);
        if (BigInt(currentAllowance) >= amount) {
            logger.debug('Sufficient allowance already exists');
            return 'already-approved';
        }
        // Approve max uint256 for convenience (common practice)
        const maxApproval = ethers_1.MaxUint256;
        if (config_1.Config.execution.mode === 'simulate') {
            logger.info(`SIMULATION: Would approve ${tokenAddress} for ${spenderAddress}`);
            return '0xsimulated';
        }
        const tx = await tokenContract.approve(spenderAddress, maxApproval);
        const receipt = await tx.wait();
        logger.info(`Approved ${tokenAddress} for ${spenderAddress}: ${receipt.hash}`);
        return receipt.hash;
    }
    /**
     * Get all available DEX adapters
     */
    getAdapters() {
        return this.adapters;
    }
    /**
     * Check if a pair exists on a DEX
     */
    async pairExists(dexName, tokenA, tokenB) {
        const adapter = this.adapters.get(dexName.toLowerCase());
        if (!adapter)
            return false;
        const pairAddress = await adapter.getPairAddress(tokenA, tokenB);
        return pairAddress !== null;
    }
}
exports.MultiDexRouter = MultiDexRouter;
// Export singleton instance
let multiDexRouter = null;
function getMultiDexRouter() {
    if (!multiDexRouter) {
        const currentProvider = polygonProvider_1.provider.get();
        const signer = config_1.Config.execution.mode === 'live' ? polygonProvider_1.wallet.getSigner() : undefined;
        multiDexRouter = new MultiDexRouter(currentProvider, signer);
    }
    return multiDexRouter;
}
//# sourceMappingURL=dexRouterAdapter.js.map