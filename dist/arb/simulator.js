"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Simulator = void 0;
exports.getSimulator = getSimulator;
const config_1 = require("../config");
const polygonProvider_1 = require("../providers/polygonProvider");
const dexRouterAdapter_1 = require("../adapters/dexRouterAdapter");
const priceOracleAdapter_1 = require("../adapters/priceOracleAdapter");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'simulator' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
/**
 * Arbitrage Simulator
 */
class Simulator {
    gasPrice = BigInt(0);
    maticPriceUsd = 0.8;
    constructor() {
        this.updateGasPrice();
        this.updateMaticPrice();
    }
    /**
     * Update gas price periodically
     */
    async updateGasPrice() {
        try {
            const currentProvider = polygonProvider_1.provider.get();
            const feeData = await currentProvider.getFeeData();
            if (feeData.gasPrice) {
                this.gasPrice = feeData.gasPrice;
            }
            else if (feeData.maxFeePerGas) {
                this.gasPrice = feeData.maxFeePerGas;
            }
            else {
                // Default to config value
                this.gasPrice = (0, math_1.toWei)(config_1.Config.gas.maxGasGwei, 9); // Gwei to Wei
            }
            logger.debug(`Gas price updated: ${(0, math_1.fromWei)(this.gasPrice, 9)} Gwei`);
        }
        catch (error) {
            // Polygon gas station often fails - use manual fallback
            logger.debug('Using manual gas price fallback');
            this.gasPrice = (0, math_1.toWei)(config_1.Config.gas.maxGasGwei, 9);
        }
        // Schedule next update
        setTimeout(() => this.updateGasPrice(), 30000); // Every 30 seconds
    }
    /**
     * Update MATIC price periodically
     */
    async updateMaticPrice() {
        try {
            const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
            const price = await oracle.getTokenPriceUSD(config_1.ADDRESSES.WMATIC);
            if (price) {
                this.maticPriceUsd = price;
                logger.debug(`MATIC price updated: $${price.toFixed(4)}`);
            }
        }
        catch (error) {
            logger.error('Failed to update MATIC price:', error);
        }
        // Schedule next update
        setTimeout(() => this.updateMaticPrice(), 60000); // Every minute
    }
    /**
     * Simulate arbitrage path execution
     */
    async simulatePathOnChain(path, inputAmount, slippageBps = config_1.Config.execution.slippageBps) {
        const warnings = [];
        const breakdown = [];
        let currentAmount = inputAmount;
        let totalGasEstimate = BigInt(0);
        let totalPriceImpact = 0;
        // Validate input amount
        if (inputAmount === BigInt(0)) {
            logger.warn('Input amount is 0, using default 100 tokens');
            currentAmount = (0, math_1.toWei)('100', path.tokens[0].decimals);
        }
        try {
            const router = (0, dexRouterAdapter_1.getMultiDexRouter)();
            const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
            // Simulate each step
            if (path.type === 'triangular') {
                for (let i = 0; i < path.tokens.length; i++) {
                    const fromToken = path.tokens[i];
                    const toToken = path.tokens[(i + 1) % path.tokens.length];
                    const dexName = path.dexes[i];
                    // Get swap quote
                    const adapter = router.getAdapters().get(dexName.toLowerCase());
                    if (!adapter) {
                        throw new Error(`Adapter not found for ${dexName}`);
                    }
                    const amounts = await adapter.getAmountsOut([fromToken.address, toToken.address], currentAmount);
                    // Calculate price impact
                    const impact = await oracle.calculatePriceImpact(fromToken.address, toToken.address, currentAmount, dexName);
                    // Estimate gas
                    const gasEstimate = await this.estimateSwapGas(fromToken.address, toToken.address, currentAmount, dexName);
                    // Record breakdown
                    breakdown.push({
                        step: i + 1,
                        from: fromToken.symbol,
                        to: toToken.symbol,
                        dex: dexName,
                        amountIn: currentAmount,
                        amountOut: amounts[1],
                        priceImpact: impact,
                        gasEstimate,
                    });
                    // Check for warnings
                    if (impact > 2) {
                        warnings.push(`High price impact on ${dexName}: ${impact.toFixed(2)}%`);
                    }
                    currentAmount = amounts[1];
                    totalGasEstimate += gasEstimate;
                    totalPriceImpact += impact;
                }
            }
            else if (path.type === 'cross-dex') {
                // Cross-DEX arbitrage simulation
                const [buyDex, sellDex] = path.dexes;
                const [tokenA, tokenB] = path.tokens;
                // Step 1: Buy on first DEX
                const buyAdapter = router.getAdapters().get(buyDex.toLowerCase());
                const buyAmounts = await buyAdapter.getAmountsOut([tokenA.address, tokenB.address], currentAmount);
                const buyImpact = await oracle.calculatePriceImpact(tokenA.address, tokenB.address, currentAmount, buyDex);
                const buyGas = await this.estimateSwapGas(tokenA.address, tokenB.address, currentAmount, buyDex);
                breakdown.push({
                    step: 1,
                    from: tokenA.symbol,
                    to: tokenB.symbol,
                    dex: buyDex,
                    amountIn: currentAmount,
                    amountOut: buyAmounts[1],
                    priceImpact: buyImpact,
                    gasEstimate: buyGas,
                });
                // Step 2: Sell on second DEX
                const sellAdapter = router.getAdapters().get(sellDex.toLowerCase());
                const sellAmounts = await sellAdapter.getAmountsOut([tokenB.address, tokenA.address], buyAmounts[1]);
                const sellImpact = await oracle.calculatePriceImpact(tokenB.address, tokenA.address, buyAmounts[1], sellDex);
                const sellGas = await this.estimateSwapGas(tokenB.address, tokenA.address, buyAmounts[1], sellDex);
                breakdown.push({
                    step: 2,
                    from: tokenB.symbol,
                    to: tokenA.symbol,
                    dex: sellDex,
                    amountIn: buyAmounts[1],
                    amountOut: sellAmounts[1],
                    priceImpact: sellImpact,
                    gasEstimate: sellGas,
                });
                currentAmount = sellAmounts[1];
                totalGasEstimate = buyGas + sellGas;
                totalPriceImpact = buyImpact + sellImpact;
                // Check for arbitrage opportunity
                const priceDifference = await this.calculatePriceDifference(tokenA.address, tokenB.address, buyDex, sellDex);
                if (priceDifference < 0.1) {
                    warnings.push('Price difference too small for profitable arbitrage');
                }
            }
            // Apply slippage to output
            const outputWithSlippage = (0, math_1.calculateMinimumOutput)(currentAmount, slippageBps);
            // Calculate profits
            const grossProfit = outputWithSlippage > inputAmount
                ? outputWithSlippage - inputAmount
                : BigInt(0);
            const gasCost = totalGasEstimate * this.gasPrice;
            const netProfitResult = (0, math_1.calculateNetProfit)(grossProfit, totalGasEstimate, this.gasPrice, this.maticPriceUsd);
            // Calculate confidence score
            const confidence = this.calculateConfidence(totalPriceImpact, netProfitResult.profitUsd, warnings.length);
            // Check profitability threshold
            const isProfitable = netProfitResult.isProfitable &&
                netProfitResult.profitUsd >= config_1.Config.execution.minProfitThresholdUsd;
            // Calculate execution price
            const executionPrice = parseFloat((0, math_1.fromWei)(outputWithSlippage, path.tokens[0].decimals)) /
                parseFloat((0, math_1.fromWei)(inputAmount, path.tokens[0].decimals));
            return {
                path,
                inputAmount,
                outputAmount: outputWithSlippage,
                grossProfit,
                gasCost,
                netProfit: netProfitResult.profitWei,
                netProfitUsd: netProfitResult.profitUsd,
                priceImpact: totalPriceImpact,
                slippage: slippageBps / 100,
                executionPrice,
                isProfitable,
                confidence,
                warnings,
                breakdown,
            };
        }
        catch (error) {
            logger.error(`Simulation failed for path ${path.id}:`, error);
            return {
                path,
                inputAmount,
                outputAmount: BigInt(0),
                grossProfit: BigInt(0),
                gasCost: totalGasEstimate * this.gasPrice,
                netProfit: -totalGasEstimate * this.gasPrice,
                netProfitUsd: -(0, math_1.calculateGasCostUsd)(totalGasEstimate, this.gasPrice, this.maticPriceUsd),
                priceImpact: 100,
                slippage: slippageBps / 100,
                executionPrice: 0,
                isProfitable: false,
                confidence: 0,
                warnings: [`Simulation error: ${error}`],
                breakdown,
            };
        }
    }
    /**
     * Simulate with flash loan
     */
    async simulateWithFlashLoan(path, flashLoanAmount, flashLoanProvider = 'balancer') {
        const flashLoanFee = this.calculateFlashLoanFee(flashLoanAmount, flashLoanProvider);
        const requiredRepayment = flashLoanAmount + flashLoanFee;
        // Simulate the arbitrage with the flash loan amount
        const baseSimulation = await this.simulatePathOnChain(path, flashLoanAmount);
        // Adjust for flash loan costs
        const netProfitAfterFlashLoan = baseSimulation.outputAmount - requiredRepayment - baseSimulation.gasCost;
        const netProfitUsd = parseFloat((0, math_1.fromWei)(netProfitAfterFlashLoan, path.tokens[0].decimals)) *
            (await (0, priceOracleAdapter_1.getPriceOracle)().getTokenPriceUSD(path.tokens[0].address) || 0);
        // Add flash loan warning if not profitable
        if (netProfitAfterFlashLoan <= BigInt(0)) {
            baseSimulation.warnings.push('Flash loan fees make this trade unprofitable');
        }
        return {
            ...baseSimulation,
            netProfit: netProfitAfterFlashLoan,
            netProfitUsd,
            isProfitable: netProfitAfterFlashLoan > BigInt(0) && netProfitUsd >= config_1.Config.execution.minProfitThresholdUsd,
            warnings: [
                ...baseSimulation.warnings,
                `Flash loan fee: ${(0, math_1.fromWei)(flashLoanFee, path.tokens[0].decimals)} ${path.tokens[0].symbol}`,
            ],
        };
    }
    /**
     * Batch simulate multiple paths
     */
    async batchSimulate(paths, inputAmounts) {
        const simulations = await Promise.all(paths.map(async (path) => {
            const inputAmount = inputAmounts.get(path.tokens[0].address) || (0, math_1.toWei)('100', path.tokens[0].decimals);
            return this.simulatePathOnChain(path, inputAmount);
        }));
        // Sort by profitability
        simulations.sort((a, b) => {
            if (a.netProfitUsd > b.netProfitUsd)
                return -1;
            if (a.netProfitUsd < b.netProfitUsd)
                return 1;
            return 0;
        });
        return simulations;
    }
    /**
     * Estimate gas for a swap
     */
    async estimateSwapGas(tokenIn, tokenOut, amountIn, dexName) {
        try {
            const router = (0, dexRouterAdapter_1.getMultiDexRouter)();
            const adapter = router.getAdapters().get(dexName.toLowerCase());
            if (!adapter) {
                return BigInt(150000); // Default estimate
            }
            // Build transaction for gas estimation
            const tx = await adapter.buildSwapTx({
                tokenIn,
                tokenOut,
                amountIn,
                amountOutMin: BigInt(0), // For estimation only
                recipient: '0x0000000000000000000000000000000000000001', // Dummy address
                deadline: Math.floor(Date.now() / 1000) + 300,
            });
            const gasEstimate = await adapter.estimateGas(tx);
            return gasEstimate;
        }
        catch (error) {
            logger.debug(`Gas estimation failed for ${dexName} swap, using default`);
            return BigInt(150000); // Default estimate
        }
    }
    /**
     * Calculate price difference between DEXs
     */
    async calculatePriceDifference(tokenA, tokenB, dex1, dex2) {
        try {
            const router = (0, dexRouterAdapter_1.getMultiDexRouter)();
            // Get token info to use correct decimals
            const tokenAInfo = await router.getTokenInfo(tokenA);
            const oneUnit = (0, math_1.toWei)('1', tokenAInfo.decimals);
            // Validate that we have a non-zero amount
            if (oneUnit === BigInt(0)) {
                logger.warn(`One unit of token ${tokenAInfo.symbol} is 0, using fallback`);
                return 0;
            }
            // Get prices from both DEXs
            const adapter1 = router.getAdapters().get(dex1.toLowerCase());
            const adapter2 = router.getAdapters().get(dex2.toLowerCase());
            if (!adapter1 || !adapter2)
                return 0;
            const [amounts1, amounts2] = await Promise.all([
                adapter1.getAmountsOut([tokenA, tokenB], oneUnit),
                adapter2.getAmountsOut([tokenA, tokenB], oneUnit),
            ]);
            const price1 = parseFloat((0, math_1.fromWei)(amounts1[1], tokenAInfo.decimals));
            const price2 = parseFloat((0, math_1.fromWei)(amounts2[1], tokenAInfo.decimals));
            return Math.abs((price1 - price2) / price1 * 100);
        }
        catch (error) {
            logger.error('Failed to calculate price difference:', error);
            return 0;
        }
    }
    /**
     * Calculate flash loan fee
     */
    calculateFlashLoanFee(amount, provider) {
        const feeBps = provider === 'aave' ? 9 : provider === 'balancer' ? 0 : 1; // Balancer has no fee
        return (amount * BigInt(feeBps)) / BigInt(10000);
    }
    /**
     * Calculate confidence score
     */
    calculateConfidence(priceImpact, profitUsd, warningCount) {
        let confidence = 1.0;
        // Reduce confidence based on price impact
        if (priceImpact > 1)
            confidence *= 0.9;
        if (priceImpact > 2)
            confidence *= 0.8;
        if (priceImpact > 3)
            confidence *= 0.7;
        if (priceImpact > 5)
            confidence *= 0.5;
        // Reduce confidence based on profit size
        if (profitUsd < 10)
            confidence *= 0.8;
        if (profitUsd < 5)
            confidence *= 0.6;
        // Reduce confidence based on warnings
        confidence *= Math.pow(0.9, warningCount);
        return Math.max(0, Math.min(1, confidence));
    }
    /**
     * Simulate MEV protection
     */
    async simulateWithMEVProtection(path, inputAmount) {
        const baseSimulation = await this.simulatePathOnChain(path, inputAmount);
        if (config_1.Config.features.enableMevProtection) {
            // Add MEV protection costs (private mempool fee)
            const mevProtectionCost = baseSimulation.gasCost * BigInt(20) / BigInt(100); // 20% premium
            baseSimulation.gasCost += mevProtectionCost;
            baseSimulation.netProfit -= mevProtectionCost;
            baseSimulation.netProfitUsd = parseFloat((0, math_1.fromWei)(baseSimulation.netProfit, path.tokens[0].decimals)) *
                (await (0, priceOracleAdapter_1.getPriceOracle)().getTokenPriceUSD(path.tokens[0].address) || 0);
            baseSimulation.warnings.push('MEV protection enabled - additional gas costs applied');
            baseSimulation.confidence *= 1.2; // Higher confidence with MEV protection
        }
        return baseSimulation;
    }
    /**
     * Validate simulation result
     */
    validateSimulation(result) {
        // Check basic profitability
        if (!result.isProfitable) {
            logger.debug(`Simulation not profitable: ${result.netProfitUsd} USD`);
            return false;
        }
        // Check minimum thresholds
        if (result.netProfitUsd < config_1.Config.execution.minProfitThresholdUsd) {
            logger.debug(`Profit below threshold: ${result.netProfitUsd} < ${config_1.Config.execution.minProfitThresholdUsd}`);
            return false;
        }
        // Check price impact
        if (result.priceImpact > 10) {
            logger.warn(`Price impact too high: ${result.priceImpact}%`);
            return false;
        }
        // Check confidence
        if (result.confidence < 0.5) {
            logger.warn(`Confidence too low: ${result.confidence}`);
            return false;
        }
        // Check gas cost ratio
        const gasCostRatio = parseFloat((0, math_1.fromWei)(result.gasCost)) / parseFloat((0, math_1.fromWei)(result.grossProfit));
        if (gasCostRatio > 0.5) {
            logger.warn(`Gas cost ratio too high: ${(gasCostRatio * 100).toFixed(2)}%`);
            return false;
        }
        return true;
    }
    /**
     * Get current gas price
     */
    getGasPrice() {
        return this.gasPrice;
    }
    /**
     * Get current MATIC price
     */
    getMaticPrice() {
        return this.maticPriceUsd;
    }
}
exports.Simulator = Simulator;
// Export singleton instance
let simulator = null;
function getSimulator() {
    if (!simulator) {
        simulator = new Simulator();
    }
    return simulator;
}
//# sourceMappingURL=simulator.js.map