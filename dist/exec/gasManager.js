"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GasManager = void 0;
exports.getGasManager = getGasManager;
const config_1 = require("../config");
const polygonProvider_1 = require("../providers/polygonProvider");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'gas-manager' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
/**
 * Gas Manager for optimal gas price strategies
 */
class GasManager {
    currentGasPrice = null;
    gasHistory = [];
    maxHistorySize = 100;
    updateInterval = null;
    constructor() {
        this.startGasPriceMonitoring();
    }
    /**
     * Start monitoring gas prices
     */
    startGasPriceMonitoring() {
        // Initial update
        this.updateGasPrice();
        // Schedule periodic updates
        this.updateInterval = setInterval(() => {
            this.updateGasPrice();
        }, 15000); // Every 15 seconds
        logger.info('Gas price monitoring started');
    }
    /**
     * Update current gas price
     */
    async updateGasPrice() {
        try {
            const currentProvider = polygonProvider_1.provider.get();
            const feeData = await currentProvider.getFeeData();
            const block = await currentProvider.getBlock('latest');
            let gasPriceData;
            if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas && block?.baseFeePerGas) {
                // EIP-1559 pricing
                gasPriceData = {
                    baseFee: block.baseFeePerGas,
                    priorityFee: feeData.maxPriorityFeePerGas,
                    maxFeePerGas: feeData.maxFeePerGas,
                    gasPrice: block.baseFeePerGas + feeData.maxPriorityFeePerGas,
                    timestamp: Date.now(),
                    source: 'provider',
                };
            }
            else if (feeData.gasPrice) {
                // Legacy pricing
                gasPriceData = {
                    baseFee: feeData.gasPrice,
                    priorityFee: BigInt(0),
                    maxFeePerGas: feeData.gasPrice,
                    gasPrice: feeData.gasPrice,
                    timestamp: Date.now(),
                    source: 'provider',
                };
            }
            else {
                // Fallback pricing
                const fallbackGasPrice = (0, math_1.toWei)(config_1.Config.gas.maxGasGwei, 9);
                gasPriceData = {
                    baseFee: fallbackGasPrice,
                    priorityFee: (0, math_1.toWei)(config_1.Config.gas.maxPriorityFeeGwei, 9),
                    maxFeePerGas: fallbackGasPrice,
                    gasPrice: fallbackGasPrice,
                    timestamp: Date.now(),
                    source: 'fallback',
                };
            }
            this.currentGasPrice = gasPriceData;
            this.addToHistory(gasPriceData);
            logger.debug(`Gas price updated: ${(0, math_1.fromWei)(gasPriceData.gasPrice, 9)} Gwei (${gasPriceData.source})`);
        }
        catch (error) {
            logger.error('Failed to update gas price:', error);
        }
    }
    /**
     * Add gas price to history
     */
    addToHistory(gasPriceData) {
        this.gasHistory.push(gasPriceData);
        // Maintain max history size
        if (this.gasHistory.length > this.maxHistorySize) {
            this.gasHistory.shift();
        }
    }
    /**
     * Get current gas price based on strategy
     */
    getGasPriceHint(urgency = 'standard') {
        if (!this.currentGasPrice) {
            throw new Error('Gas price not available');
        }
        const strategy = config_1.Config.gas.strategy;
        let adjustedGasPrice = { ...this.currentGasPrice };
        // Apply strategy
        switch (strategy) {
            case 'conservative':
                // Use lower gas price, willing to wait
                adjustedGasPrice.priorityFee = adjustedGasPrice.priorityFee * BigInt(80) / BigInt(100);
                adjustedGasPrice.maxFeePerGas = adjustedGasPrice.baseFee + adjustedGasPrice.priorityFee;
                break;
            case 'aggressive':
                // Use higher gas price for faster inclusion
                adjustedGasPrice.priorityFee = adjustedGasPrice.priorityFee * BigInt(150) / BigInt(100);
                adjustedGasPrice.maxFeePerGas = adjustedGasPrice.baseFee * BigInt(2) + adjustedGasPrice.priorityFee;
                break;
            case 'standard':
            default:
                // Use standard pricing with small buffer
                adjustedGasPrice.priorityFee = adjustedGasPrice.priorityFee * BigInt(110) / BigInt(100);
                adjustedGasPrice.maxFeePerGas = adjustedGasPrice.baseFee * BigInt(15) / BigInt(10) + adjustedGasPrice.priorityFee;
        }
        // Apply urgency modifier
        if (urgency === 'high') {
            adjustedGasPrice.priorityFee = adjustedGasPrice.priorityFee * BigInt(150) / BigInt(100);
            adjustedGasPrice.maxFeePerGas = adjustedGasPrice.maxFeePerGas * BigInt(130) / BigInt(100);
        }
        else if (urgency === 'low') {
            adjustedGasPrice.priorityFee = adjustedGasPrice.priorityFee * BigInt(70) / BigInt(100);
            adjustedGasPrice.maxFeePerGas = adjustedGasPrice.maxFeePerGas * BigInt(90) / BigInt(100);
        }
        // Apply multiplier from config
        const multiplier = BigInt(Math.floor(config_1.Config.gas.gasMultiplier * 100));
        adjustedGasPrice.gasPrice = adjustedGasPrice.gasPrice * multiplier / BigInt(100);
        adjustedGasPrice.maxFeePerGas = adjustedGasPrice.maxFeePerGas * multiplier / BigInt(100);
        // Enforce limits
        const maxGasWei = (0, math_1.toWei)(config_1.Config.gas.maxGasGwei, 9);
        if (adjustedGasPrice.maxFeePerGas > maxGasWei) {
            adjustedGasPrice.maxFeePerGas = maxGasWei;
            adjustedGasPrice.gasPrice = maxGasWei;
        }
        return adjustedGasPrice;
    }
    /**
     * Check if gas price is acceptable for trade
     */
    isGasPriceAcceptable(expectedProfitWei, gasLimit) {
        const gasPriceData = this.getGasPriceHint();
        const gasCost = gasLimit * gasPriceData.gasPrice;
        const profitThresholdMultiplier = config_1.Config.gas.profitThresholdMultiplier || 2;
        const requiredProfit = gasCost * BigInt(profitThresholdMultiplier);
        if (expectedProfitWei < requiredProfit) {
            logger.warn(`Gas cost too high: Expected profit ${(0, math_1.fromWei)(expectedProfitWei)} < Required ${(0, math_1.fromWei)(requiredProfit)}`);
            return false;
        }
        return true;
    }
    /**
     * Set gas price for transaction
     */
    setGasPriceForTx(tx, urgency = 'standard') {
        const gasPriceData = this.getGasPriceHint(urgency);
        if (config_1.Config.network.supportsEIP1559) {
            // EIP-1559 transaction
            tx.maxFeePerGas = gasPriceData.maxFeePerGas;
            tx.maxPriorityFeePerGas = gasPriceData.priorityFee;
            delete tx.gasPrice; // Remove legacy gas price
        }
        else {
            // Legacy transaction
            tx.gasPrice = gasPriceData.gasPrice;
            delete tx.maxFeePerGas;
            delete tx.maxPriorityFeePerGas;
        }
        logger.debug(`Set gas price for tx: ${(0, math_1.fromWei)(gasPriceData.gasPrice, 9)} Gwei (${urgency} urgency)`);
        return tx;
    }
    /**
     * Estimate gas for a transaction
     */
    async estimateGas(tx, bufferPercent = 20) {
        try {
            const currentProvider = polygonProvider_1.provider.get();
            const estimate = await currentProvider.estimateGas(tx);
            // Add buffer
            const buffered = estimate * BigInt(100 + bufferPercent) / BigInt(100);
            // Cap at block gas limit
            const maxGas = BigInt(config_1.Config.risk.maxGasPerBlock);
            const final = buffered > maxGas ? maxGas : buffered;
            logger.debug(`Gas estimate: ${estimate} -> ${final} (with ${bufferPercent}% buffer)`);
            return final;
        }
        catch (error) {
            logger.error('Gas estimation failed:', error);
            throw error;
        }
    }
    /**
     * Compute gas budget for complexity
     */
    computeGasBudget(txComplexity) {
        const baseGas = {
            simple: BigInt(100000), // Single swap
            medium: BigInt(200000), // Two swaps
            complex: BigInt(400000), // Multi-hop or flash loan
        };
        return baseGas[txComplexity] || BigInt(200000);
    }
    /**
     * Calculate total gas cost
     */
    calculateGasCost(gasLimit, urgency = 'standard') {
        const gasPriceData = this.getGasPriceHint(urgency);
        const totalCostWei = gasLimit * gasPriceData.gasPrice;
        // Calculate confidence based on source and history
        let confidence = 1.0;
        if (gasPriceData.source === 'fallback')
            confidence = 0.5;
        if (this.gasHistory.length < 10)
            confidence *= 0.8;
        return {
            gasLimit,
            gasPrice: gasPriceData,
            totalCostWei,
            totalCostGwei: (0, math_1.fromWei)(totalCostWei, 9),
            confidence,
        };
    }
    /**
     * Get gas price history analysis
     */
    getGasHistory() {
        if (this.gasHistory.length === 0) {
            return {
                prices: [],
                averageGasPrice: BigInt(0),
                minGasPrice: BigInt(0),
                maxGasPrice: BigInt(0),
                volatility: 0,
            };
        }
        const prices = [...this.gasHistory];
        const gasPrices = prices.map(p => p.gasPrice);
        const sum = gasPrices.reduce((acc, price) => acc + price, BigInt(0));
        const average = sum / BigInt(gasPrices.length);
        const min = gasPrices.reduce((a, b) => a < b ? a : b);
        const max = gasPrices.reduce((a, b) => a > b ? a : b);
        // Calculate volatility (simplified)
        const avgNumber = Number(average);
        const variance = gasPrices.reduce((acc, price) => {
            const diff = Number(price) - avgNumber;
            return acc + diff * diff;
        }, 0) / gasPrices.length;
        const volatility = Math.sqrt(variance) / avgNumber;
        return {
            prices,
            averageGasPrice: average,
            minGasPrice: min,
            maxGasPrice: max,
            volatility,
        };
    }
    /**
     * Wait for gas price to drop below threshold
     */
    async waitForLowerGas(maxGasPriceGwei, timeoutMs = 60000) {
        const startTime = Date.now();
        const maxGasWei = (0, math_1.toWei)(maxGasPriceGwei, 9);
        while (Date.now() - startTime < timeoutMs) {
            const current = this.getGasPriceHint();
            if (current.gasPrice <= maxGasWei) {
                logger.info(`Gas price acceptable: ${(0, math_1.fromWei)(current.gasPrice, 9)} <= ${maxGasPriceGwei} Gwei`);
                return true;
            }
            // Wait before checking again
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        logger.warn(`Timeout waiting for gas price to drop below ${maxGasPriceGwei} Gwei`);
        return false;
    }
    /**
     * Check if gas price is spiking
     */
    isGasSpiking() {
        const history = this.getGasHistory();
        if (history.prices.length < 10) {
            return false;
        }
        const current = this.currentGasPrice?.gasPrice || BigInt(0);
        const average = history.averageGasPrice;
        // Consider it spiking if current is 50% above average
        return current > average * BigInt(150) / BigInt(100);
    }
    /**
     * Get recommended gas limit for transaction type
     */
    getRecommendedGasLimit(txType) {
        const limits = {
            approve: BigInt(50000),
            swap: BigInt(150000),
            multiSwap: BigInt(300000),
            flashLoan: BigInt(500000),
        };
        return limits[txType] || BigInt(200000);
    }
    /**
     * Stop gas monitoring
     */
    stopMonitoring() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            logger.info('Gas price monitoring stopped');
        }
    }
}
exports.GasManager = GasManager;
// Export singleton instance
let gasManager = null;
function getGasManager() {
    if (!gasManager) {
        gasManager = new GasManager();
    }
    return gasManager;
}
//# sourceMappingURL=gasManager.js.map