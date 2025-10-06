"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_DECIMALS = exports.BASIS_POINTS = exports.WEI_PER_ETHER = exports.ONE = exports.ZERO = void 0;
exports.toWei = toWei;
exports.fromWei = fromWei;
exports.formatWei = formatWei;
exports.calculateMinimumOutput = calculateMinimumOutput;
exports.calculateMaximumInput = calculateMaximumInput;
exports.applySlippage = applySlippage;
exports.calculatePriceImpact = calculatePriceImpact;
exports.safeDiv = safeDiv;
exports.calculatePercentage = calculatePercentage;
exports.isApproximatelyEqual = isApproximatelyEqual;
exports.getAmountOut = getAmountOut;
exports.getAmountIn = getAmountIn;
exports.calculateNetProfit = calculateNetProfit;
exports.calculateCompoundInterest = calculateCompoundInterest;
exports.calculateOptimalTradeSize = calculateOptimalTradeSize;
exports.usdToTokenAmount = usdToTokenAmount;
exports.tokenAmountToUsd = tokenAmountToUsd;
exports.calculateBpsDifference = calculateBpsDifference;
exports.parseEther = parseEther;
exports.formatEther = formatEther;
exports.isAboveThreshold = isAboveThreshold;
exports.calculateGasCostUsd = calculateGasCostUsd;
exports.normalizeDecimals = normalizeDecimals;
exports.safeAdd = safeAdd;
exports.safeMul = safeMul;
const ethers_1 = require("ethers");
const decimal_js_1 = __importDefault(require("decimal.js"));
// Configure Decimal for high precision
decimal_js_1.default.set({
    precision: 40,
    rounding: decimal_js_1.default.ROUND_DOWN,
    toExpNeg: -40,
    toExpPos: 40,
});
/**
 * Convert a human-readable amount to wei
 */
function toWei(amount, decimals = 18) {
    if (typeof amount === 'number') {
        // Handle floating point numbers carefully
        const decimal = new decimal_js_1.default(amount);
        const scaled = decimal.mul(new decimal_js_1.default(10).pow(decimals));
        return BigInt(scaled.toFixed(0));
    }
    // Parse string amounts
    const decimal = new decimal_js_1.default(amount);
    const scaled = decimal.mul(new decimal_js_1.default(10).pow(decimals));
    return BigInt(scaled.toFixed(0));
}
/**
 * Convert wei to human-readable amount
 */
function fromWei(amount, decimals = 18) {
    const divisor = new decimal_js_1.default(10).pow(decimals);
    const decimal = new decimal_js_1.default(amount.toString());
    return decimal.div(divisor).toFixed();
}
/**
 * Format wei to human-readable with specified decimal places
 */
function formatWei(amount, decimals = 18, displayDecimals = 6) {
    const value = fromWei(amount, decimals);
    const decimal = new decimal_js_1.default(value);
    return decimal.toFixed(displayDecimals);
}
/**
 * Calculate output amount with slippage
 */
function calculateMinimumOutput(expectedOutput, slippageBps) {
    // slippageBps is in basis points (1 bps = 0.01%)
    const slippageMultiplier = BigInt(10000 - slippageBps);
    return (expectedOutput * slippageMultiplier) / BigInt(10000);
}
/**
 * Calculate maximum input with slippage
 */
function calculateMaximumInput(expectedInput, slippageBps) {
    // slippageBps is in basis points (1 bps = 0.01%)
    const slippageMultiplier = BigInt(10000 + slippageBps);
    return (expectedInput * slippageMultiplier) / BigInt(10000);
}
/**
 * Apply slippage to an amount
 */
function applySlippage(amount, slippageBps, isInput = false) {
    return isInput
        ? calculateMaximumInput(amount, slippageBps)
        : calculateMinimumOutput(amount, slippageBps);
}
/**
 * Calculate price impact
 */
function calculatePriceImpact(inputAmount, outputAmount, reserveIn, _reserveOut) {
    // Calculate spot price before trade
    const spotPrice = new decimal_js_1.default(_reserveOut.toString()).div(reserveIn.toString());
    // Calculate execution price
    const executionPrice = new decimal_js_1.default(outputAmount.toString()).div(inputAmount.toString());
    // Calculate price impact as percentage
    const priceImpact = spotPrice.sub(executionPrice).div(spotPrice).mul(100);
    return Math.abs(priceImpact.toNumber());
}
/**
 * Safe division with zero check
 */
function safeDiv(numerator, denominator, defaultValue = BigInt(0)) {
    if (denominator === BigInt(0)) {
        return defaultValue;
    }
    return numerator / denominator;
}
/**
 * Calculate percentage
 */
function calculatePercentage(value, total, precision = 2) {
    if (total === BigInt(0))
        return '0';
    const percentage = new decimal_js_1.default(value.toString())
        .div(new decimal_js_1.default(total.toString()))
        .mul(100);
    return percentage.toFixed(precision);
}
/**
 * Compare two BigInt values with tolerance
 */
function isApproximatelyEqual(a, b, toleranceBps = 10 // 0.1% default tolerance
) {
    const diff = a > b ? a - b : b - a;
    const tolerance = (a > b ? a : b) * BigInt(toleranceBps) / BigInt(10000);
    return diff <= tolerance;
}
/**
 * Calculate AMM output using constant product formula (Uniswap V2 style)
 */
function getAmountOut(amountIn, reserveIn, reserveOut, feeBps = 30 // 0.3% default fee
) {
    if (amountIn === BigInt(0))
        return BigInt(0);
    if (reserveIn === BigInt(0) || reserveOut === BigInt(0))
        return BigInt(0);
    const amountInWithFee = amountIn * BigInt(10000 - feeBps);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * BigInt(10000) + amountInWithFee;
    return numerator / denominator;
}
/**
 * Calculate AMM input using constant product formula (Uniswap V2 style)
 */
function getAmountIn(amountOut, reserveIn, reserveOut, feeBps = 30 // 0.3% default fee
) {
    if (amountOut === BigInt(0))
        return BigInt(0);
    if (reserveIn === BigInt(0) || reserveOut === BigInt(0))
        return BigInt(0);
    if (amountOut >= reserveOut)
        return BigInt(0); // Not enough liquidity
    const numerator = reserveIn * amountOut * BigInt(10000);
    const denominator = (reserveOut - amountOut) * BigInt(10000 - feeBps);
    return numerator / denominator + BigInt(1); // Round up
}
/**
 * Calculate profit after gas costs
 */
function calculateNetProfit(grossProfit, gasUsed, gasPrice, nativeTokenPriceUsd = 0.8 // MATIC price
) {
    const gasCost = gasUsed * gasPrice;
    const profitWei = grossProfit - gasCost;
    // Convert to USD (assuming grossProfit is in MATIC wei)
    const profitInMatic = parseFloat(fromWei(profitWei, 18));
    const profitUsd = profitInMatic * nativeTokenPriceUsd;
    return {
        profitWei,
        profitUsd,
        isProfitable: profitWei > BigInt(0),
    };
}
/**
 * Calculate compound interest for yield calculations
 */
function calculateCompoundInterest(principal, ratePerPeriod, // As decimal (e.g., 0.05 for 5%)
periods) {
    const decimal = new decimal_js_1.default(principal.toString());
    const rate = new decimal_js_1.default(1 + ratePerPeriod);
    const compound = decimal.mul(rate.pow(periods));
    return BigInt(compound.toFixed(0));
}
/**
 * Calculate optimal trade size for maximum profit
 */
function calculateOptimalTradeSize(reserveIn, _reserveOut, maxInput, _feeBps = 30) {
    // This is a simplified version
    // In practice, you'd want to use calculus or binary search
    // to find the optimal trade size that maximizes profit
    // For now, return a conservative estimate (1% of reserves)
    const optimalSize = reserveIn / BigInt(100);
    return optimalSize < maxInput ? optimalSize : maxInput;
}
/**
 * Convert USD value to token amount
 */
function usdToTokenAmount(usdValue, tokenPriceUsd, tokenDecimals) {
    const tokenAmount = new decimal_js_1.default(usdValue).div(tokenPriceUsd);
    return toWei(tokenAmount.toString(), tokenDecimals);
}
/**
 * Convert token amount to USD value
 */
function tokenAmountToUsd(amount, tokenPriceUsd, tokenDecimals) {
    return parseFloat(fromWei(amount, tokenDecimals)) * tokenPriceUsd;
}
/**
 * Calculate basis points difference between two values
 */
function calculateBpsDifference(value1, value2) {
    if (value2 === BigInt(0))
        return 0;
    const diff = value1 > value2 ? value1 - value2 : value2 - value1;
    const bps = new decimal_js_1.default(diff.toString())
        .div(new decimal_js_1.default(value2.toString()))
        .mul(10000);
    return Math.abs(bps.toNumber());
}
/**
 * Parse ether string safely (handles decimal places)
 */
function parseEther(value) {
    return ethers_1.ethers.parseEther(value);
}
/**
 * Format ether for display
 */
function formatEther(value) {
    return ethers_1.ethers.formatEther(value);
}
/**
 * Check if value is above minimum threshold
 */
function isAboveThreshold(value, threshold) {
    return value >= threshold;
}
/**
 * Calculate gas cost in USD
 */
function calculateGasCostUsd(gasLimit, gasPrice, // in wei
nativeTokenPriceUsd = 0.8) {
    const gasCostWei = gasLimit * gasPrice;
    const gasCostEther = parseFloat(fromWei(gasCostWei, 18));
    return gasCostEther * nativeTokenPriceUsd;
}
/**
 * Normalize token amount to 18 decimals
 */
function normalizeDecimals(amount, fromDecimals, toDecimals = 18) {
    if (fromDecimals === toDecimals)
        return amount;
    if (fromDecimals < toDecimals) {
        return amount * BigInt(10) ** BigInt(toDecimals - fromDecimals);
    }
    else {
        return amount / BigInt(10) ** BigInt(fromDecimals - toDecimals);
    }
}
/**
 * Add amounts safely (handles overflow)
 */
function safeAdd(...amounts) {
    return amounts.reduce((acc, amount) => {
        const sum = acc + amount;
        if (sum < acc) {
            throw new Error('Addition overflow detected');
        }
        return sum;
    }, BigInt(0));
}
/**
 * Multiply amounts safely (handles overflow)
 */
function safeMul(a, b) {
    const result = a * b;
    if (a !== BigInt(0) && result / a !== b) {
        throw new Error('Multiplication overflow detected');
    }
    return result;
}
// Export commonly used constants
exports.ZERO = BigInt(0);
exports.ONE = BigInt(1);
exports.WEI_PER_ETHER = BigInt(10) ** BigInt(18);
exports.BASIS_POINTS = BigInt(10000);
// Common token decimals
exports.TOKEN_DECIMALS = {
    USDC: 6,
    USDT: 6,
    DAI: 18,
    WETH: 18,
    WBTC: 8,
    WMATIC: 18,
};
//# sourceMappingURL=math.js.map