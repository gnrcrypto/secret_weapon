import { ethers } from 'ethers';
import Decimal from 'decimal.js';

// Configure Decimal for high precision
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -40,
  toExpPos: 40,
});

/**
 * Convert a human-readable amount to wei
 */
export function toWei(amount: string | number, decimals: number = 18): bigint {
  const multiplier = BigInt(10) ** BigInt(decimals);
  
  if (typeof amount === 'number') {
    // Handle floating point numbers carefully
    const decimal = new Decimal(amount);
    const scaled = decimal.mul(new Decimal(10).pow(decimals));
    return BigInt(scaled.toFixed(0));
  }
  
  // Parse string amounts
  const decimal = new Decimal(amount);
  const scaled = decimal.mul(new Decimal(10).pow(decimals));
  return BigInt(scaled.toFixed(0));
}

/**
 * Convert wei to human-readable amount
 */
export function fromWei(amount: bigint | string, decimals: number = 18): string {
  const divisor = new Decimal(10).pow(decimals);
  const decimal = new Decimal(amount.toString());
  return decimal.div(divisor).toFixed();
}

/**
 * Format wei to human-readable with specified decimal places
 */
export function formatWei(amount: bigint | string, decimals: number = 18, displayDecimals: number = 6): string {
  const value = fromWei(amount, decimals);
  const decimal = new Decimal(value);
  return decimal.toFixed(displayDecimals);
}

/**
 * Calculate output amount with slippage
 */
export function calculateMinimumOutput(
  expectedOutput: bigint,
  slippageBps: number
): bigint {
  // slippageBps is in basis points (1 bps = 0.01%)
  const slippageMultiplier = BigInt(10000 - slippageBps);
  return (expectedOutput * slippageMultiplier) / BigInt(10000);
}

/**
 * Calculate maximum input with slippage
 */
export function calculateMaximumInput(
  expectedInput: bigint,
  slippageBps: number
): bigint {
  // slippageBps is in basis points (1 bps = 0.01%)
  const slippageMultiplier = BigInt(10000 + slippageBps);
  return (expectedInput * slippageMultiplier) / BigInt(10000);
}

/**
 * Apply slippage to an amount
 */
export function applySlippage(
  amount: bigint,
  slippageBps: number,
  isInput: boolean = false
): bigint {
  return isInput 
    ? calculateMaximumInput(amount, slippageBps)
    : calculateMinimumOutput(amount, slippageBps);
}

/**
 * Calculate price impact
 */
export function calculatePriceImpact(
  inputAmount: bigint,
  outputAmount: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  // Calculate spot price before trade
  const spotPrice = new Decimal(reserveOut.toString()).div(reserveIn.toString());
  
  // Calculate execution price
  const executionPrice = new Decimal(outputAmount.toString()).div(inputAmount.toString());
  
  // Calculate price impact as percentage
  const priceImpact = spotPrice.sub(executionPrice).div(spotPrice).mul(100);
  
  return Math.abs(priceImpact.toNumber());
}

/**
 * Safe division with zero check
 */
export function safeDiv(numerator: bigint, denominator: bigint, defaultValue: bigint = BigInt(0)): bigint {
  if (denominator === BigInt(0)) {
    return defaultValue;
  }
  return numerator / denominator;
}

/**
 * Calculate percentage
 */
export function calculatePercentage(value: bigint, total: bigint, precision: number = 2): string {
  if (total === BigInt(0)) return '0';
  
  const percentage = new Decimal(value.toString())
    .div(new Decimal(total.toString()))
    .mul(100);
  
  return percentage.toFixed(precision);
}

/**
 * Compare two BigInt values with tolerance
 */
export function isApproximatelyEqual(
  a: bigint,
  b: bigint,
  toleranceBps: number = 10 // 0.1% default tolerance
): boolean {
  const diff = a > b ? a - b : b - a;
  const tolerance = (a > b ? a : b) * BigInt(toleranceBps) / BigInt(10000);
  return diff <= tolerance;
}

/**
 * Calculate AMM output using constant product formula (Uniswap V2 style)
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = 30 // 0.3% default fee
): bigint {
  if (amountIn === BigInt(0)) return BigInt(0);
  if (reserveIn === BigInt(0) || reserveOut === BigInt(0)) return BigInt(0);
  
  const amountInWithFee = amountIn * BigInt(10000 - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BigInt(10000) + amountInWithFee;
  
  return numerator / denominator;
}

/**
 * Calculate AMM input using constant product formula (Uniswap V2 style)
 */
export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = 30 // 0.3% default fee
): bigint {
  if (amountOut === BigInt(0)) return BigInt(0);
  if (reserveIn === BigInt(0) || reserveOut === BigInt(0)) return BigInt(0);
  if (amountOut >= reserveOut) return BigInt(0); // Not enough liquidity
  
  const numerator = reserveIn * amountOut * BigInt(10000);
  const denominator = (reserveOut - amountOut) * BigInt(10000 - feeBps);
  
  return numerator / denominator + BigInt(1); // Round up
}

/**
 * Calculate profit after gas costs
 */
export function calculateNetProfit(
  grossProfit: bigint,
  gasUsed: bigint,
  gasPrice: bigint,
  nativeTokenPriceUsd: number = 0.8 // MATIC price
): { profitWei: bigint; profitUsd: number; isProfitable: boolean } {
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
export function calculateCompoundInterest(
  principal: bigint,
  ratePerPeriod: number, // As decimal (e.g., 0.05 for 5%)
  periods: number
): bigint {
  const decimal = new Decimal(principal.toString());
  const rate = new Decimal(1 + ratePerPeriod);
  const compound = decimal.mul(rate.pow(periods));
  
  return BigInt(compound.toFixed(0));
}

/**
 * Calculate optimal trade size for maximum profit
 */
export function calculateOptimalTradeSize(
  reserveIn: bigint,
  reserveOut: bigint,
  maxInput: bigint,
  feeBps: number = 30
): bigint {
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
export function usdToTokenAmount(
  usdValue: number,
  tokenPriceUsd: number,
  tokenDecimals: number
): bigint {
  const tokenAmount = new Decimal(usdValue).div(tokenPriceUsd);
  return toWei(tokenAmount.toString(), tokenDecimals);
}

/**
 * Convert token amount to USD value
 */
export function tokenAmountToUsd(
  amount: bigint,
  tokenPriceUsd: number,
  tokenDecimals: number
): number {
  const tokenAmount = fromWei(amount, tokenDecimals);
  return parseFloat(tokenAmount) * tokenPriceUsd;
}

/**
 * Calculate basis points difference between two values
 */
export function calculateBpsDifference(value1: bigint, value2: bigint): number {
  if (value2 === BigInt(0)) return 0;
  
  const diff = value1 > value2 ? value1 - value2 : value2 - value1;
  const bps = new Decimal(diff.toString())
    .div(new Decimal(value2.toString()))
    .mul(10000);
  
  return Math.abs(bps.toNumber());
}

/**
 * Parse ether string safely (handles decimal places)
 */
export function parseEther(value: string): bigint {
  return ethers.parseEther(value);
}

/**
 * Format ether for display
 */
export function formatEther(value: bigint): string {
  return ethers.formatEther(value);
}

/**
 * Check if value is above minimum threshold
 */
export function isAboveThreshold(
  value: bigint,
  threshold: bigint
): boolean {
  return value >= threshold;
}

/**
 * Calculate gas cost in USD
 */
export function calculateGasCostUsd(
  gasLimit: bigint,
  gasPrice: bigint, // in wei
  nativeTokenPriceUsd: number = 0.8
): number {
  const gasCostWei = gasLimit * gasPrice;
  const gasCostEther = parseFloat(fromWei(gasCostWei, 18));
  return gasCostEther * nativeTokenPriceUsd;
}

/**
 * Normalize token amount to 18 decimals
 */
export function normalizeDecimals(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number = 18
): bigint {
  if (fromDecimals === toDecimals) return amount;
  
  if (fromDecimals < toDecimals) {
    return amount * BigInt(10) ** BigInt(toDecimals - fromDecimals);
  } else {
    return amount / BigInt(10) ** BigInt(fromDecimals - toDecimals);
  }
}

/**
 * Add amounts safely (handles overflow)
 */
export function safeAdd(...amounts: bigint[]): bigint {
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
export function safeMul(a: bigint, b: bigint): bigint {
  const result = a * b;
  if (a !== BigInt(0) && result / a !== b) {
    throw new Error('Multiplication overflow detected');
  }
  return result;
}

// Export commonly used constants
export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const WEI_PER_ETHER = BigInt(10) ** BigInt(18);
export const BASIS_POINTS = BigInt(10000);

// Common token decimals
export const TOKEN_DECIMALS = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WETH: 18,
  WBTC: 8,
  WMATIC: 18,
} as const;
