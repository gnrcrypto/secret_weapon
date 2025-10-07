"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskManager = void 0;
exports.getRiskManager = getRiskManager;
const config_1 = require("../config");
const priceOracleAdapter_1 = require("../adapters/priceOracleAdapter");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
const events_1 = require("events");
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'risk-manager' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
/**
 * Risk Manager - Protects capital and prevents catastrophic losses
 */
class RiskManager extends events_1.EventEmitter {
    metrics;
    limits;
    positions = new Map();
    tradeHistory = [];
    circuitBreakerResetTimer = null;
    dailyResetTimer = null;
    constructor() {
        super();
        this.metrics = this.initializeMetrics();
        this.limits = this.loadLimits();
        this.startDailyReset();
    }
    /**
     * Initialize risk metrics
     */
    initializeMetrics() {
        return {
            dailyLoss: 0,
            dailyProfit: 0,
            dailyTrades: 0,
            consecutiveFailures: 0,
            totalExposureUsd: 0,
            tokenExposures: new Map(),
            gasSpentToday: BigInt(0),
            highestRiskScore: 0,
            circuitBreakerActive: false,
            lastCircuitBreakerTime: 0,
        };
    }
    /**
     * Load risk limits from configuration
     */
    loadLimits() {
        return {
            maxDailyLossUsd: config_1.Config.risk.dailyLossLimitUsd,
            maxConsecutiveFailures: config_1.Config.risk.maxConsecutiveFailures,
            maxExposurePerToken: config_1.Config.execution.maxTradeSizeUsd,
            maxTotalExposure: config_1.Config.execution.maxPositionSizeUsd,
            maxDailyTrades: 100, // Default limit
            maxGasPerDay: (0, math_1.toWei)('100', 18), // 100 MATIC default
            maxPriceImpact: 5, // 5% max
            minLiquidity: (0, math_1.toWei)('10000', 18), // $10k minimum liquidity
            maxSlippage: 100, // 1% max slippage
        };
    }
    /**
     * Pre-trade risk check
     */
    async checkRisk(opportunity) {
        const reasons = [];
        // Check if circuit breaker is active
        if (this.metrics.circuitBreakerActive) {
            const timeRemaining = this.getCircuitBreakerTimeRemaining();
            reasons.push(`Circuit breaker active (${timeRemaining}s remaining)`);
            return { allowed: false, reasons, riskScore: this.calculateRiskScore(opportunity) };
        }
        // Check daily loss limit
        if (this.metrics.dailyLoss >= this.limits.maxDailyLossUsd) {
            reasons.push(`Daily loss limit reached: $${this.metrics.dailyLoss.toFixed(2)}`);
            this.triggerCircuitBreaker('daily_loss_limit');
        }
        // Check consecutive failures
        if (this.metrics.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
            reasons.push(`Max consecutive failures reached: ${this.metrics.consecutiveFailures}`);
            this.triggerCircuitBreaker('consecutive_failures');
        }
        // Check daily trade limit
        if (this.metrics.dailyTrades >= this.limits.maxDailyTrades) {
            reasons.push(`Daily trade limit reached: ${this.metrics.dailyTrades}`);
        }
        // Check exposure limits
        const exposureCheck = await this.checkExposureLimits(opportunity);
        if (!exposureCheck.allowed) {
            reasons.push(...exposureCheck.reasons);
        }
        // Check market conditions
        const marketCheck = await this.checkMarketConditions(opportunity);
        if (!marketCheck.allowed) {
            reasons.push(...marketCheck.reasons);
        }
        // Check liquidity
        const liquidityCheck = await this.checkLiquidity(opportunity);
        if (!liquidityCheck.allowed) {
            reasons.push(...liquidityCheck.reasons);
        }
        // Calculate risk score
        const riskScore = this.calculateRiskScore(opportunity);
        // Block critical risk trades
        if (riskScore.rating === 'critical') {
            reasons.push(`Risk score too high: ${riskScore.total.toFixed(2)} (critical)`);
        }
        // Update highest risk score
        if (riskScore.total > this.metrics.highestRiskScore) {
            this.metrics.highestRiskScore = riskScore.total;
        }
        const allowed = reasons.length === 0;
        // Emit events
        if (allowed) {
            this.emit('risk-check-passed', opportunity.simulation.path.id);
        }
        else {
            this.emit('risk-check-failed', opportunity.simulation.path.id, reasons);
            logger.warn(`Risk check failed for ${opportunity.simulation.path.id}: ${reasons.join(', ')}`);
        }
        return { allowed, reasons, riskScore };
    }
    /**
     * Check exposure limits
     */
    async checkExposureLimits(opportunity) {
        const reasons = [];
        const simulation = opportunity.simulation;
        const token = simulation.path.tokens[0];
        // Calculate trade value in USD
        const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
        const tokenPrice = await oracle.getTokenPriceUSD(token.address) || 0;
        const tradeValueUsd = (0, math_1.tokenAmountToUsd)(simulation.inputAmount, tokenPrice, token.decimals);
        // Check per-token exposure
        const currentTokenExposure = this.metrics.tokenExposures.get(token.address) || 0;
        if (currentTokenExposure + tradeValueUsd > this.limits.maxExposurePerToken) {
            reasons.push(`Token exposure limit exceeded for ${token.symbol}: $${(currentTokenExposure + tradeValueUsd).toFixed(2)}`);
        }
        // Check total exposure
        if (this.metrics.totalExposureUsd + tradeValueUsd > this.limits.maxTotalExposure) {
            reasons.push(`Total exposure limit exceeded: $${(this.metrics.totalExposureUsd + tradeValueUsd).toFixed(2)}`);
        }
        // Check concentration risk
        const concentrationRatio = (currentTokenExposure + tradeValueUsd) / this.limits.maxTotalExposure;
        if (concentrationRatio > 0.3) { // No more than 30% in one token
            reasons.push(`Concentration risk too high for ${token.symbol}: ${(concentrationRatio * 100).toFixed(1)}%`);
        }
        return { allowed: reasons.length === 0, reasons };
    }
    /**
     * Check market conditions
     */
    async checkMarketConditions(opportunity) {
        const reasons = [];
        const simulation = opportunity.simulation;
        // Check price impact
        if (simulation.priceImpact > this.limits.maxPriceImpact) {
            reasons.push(`Price impact too high: ${simulation.priceImpact.toFixed(2)}%`);
        }
        // Check slippage
        const slippageBps = simulation.slippage * 100;
        if (slippageBps > this.limits.maxSlippage) {
            reasons.push(`Slippage too high: ${simulation.slippage.toFixed(2)}%`);
        }
        // Check gas costs
        const gasRatio = parseFloat((0, math_1.fromWei)(simulation.gasCost)) / parseFloat((0, math_1.fromWei)(simulation.grossProfit));
        if (gasRatio > 0.5) { // Gas shouldn't be more than 50% of profit
            reasons.push(`Gas cost ratio too high: ${(gasRatio * 100).toFixed(1)}%`);
        }
        // Check for volatility spikes
        const volatilityCheck = await this.checkVolatility();
        if (volatilityCheck.isHigh) {
            reasons.push(`Market volatility too high: ${volatilityCheck.level}`);
        }
        return { allowed: reasons.length === 0, reasons };
    }
    /**
     * Check liquidity conditions
     */
    async checkLiquidity(opportunity) {
        const reasons = [];
        const path = opportunity.simulation.path;
        // Check minimum liquidity in pools
        for (const pair of path.pairs || []) {
            const totalLiquidity = (pair.reserveA || BigInt(0)) + (pair.reserveB || BigInt(0));
            if (totalLiquidity < this.limits.minLiquidity) {
                reasons.push(`Insufficient liquidity in ${pair.dexName}: ${(0, math_1.fromWei)(totalLiquidity)}`);
            }
        }
        // Check for liquidity imbalance
        if (path.pairs && path.pairs.length > 0) {
            const pair = path.pairs[0];
            if (pair.reserveA && pair.reserveB) {
                const ratio = Number(pair.reserveA) / Number(pair.reserveB);
                if (ratio > 10 || ratio < 0.1) {
                    reasons.push(`Liquidity imbalance detected: ${ratio.toFixed(2)}`);
                }
            }
        }
        return { allowed: reasons.length === 0, reasons };
    }
    /**
     * Calculate comprehensive risk score
     */
    calculateRiskScore(opportunity) {
        const simulation = opportunity.simulation;
        // Market risk (price impact, slippage)
        const marketRisk = Math.min(100, (simulation.priceImpact * 10) +
            (simulation.slippage * 100));
        // Liquidity risk
        const liquidityRisk = simulation.path.pairs
            ? Math.min(100, 100 - (simulation.confidence * 100))
            : 50;
        // Concentration risk
        const concentrationRisk = (this.metrics.totalExposureUsd / this.limits.maxTotalExposure) * 100;
        // Historical risk (based on recent failures)
        const historicalRisk = Math.min(100, (this.metrics.consecutiveFailures * 20) +
            (this.metrics.dailyLoss / this.limits.maxDailyLossUsd * 50));
        // Technical risk (gas costs, complexity)
        const gasRatio = parseFloat((0, math_1.fromWei)(simulation.gasCost)) / parseFloat((0, math_1.fromWei)(simulation.grossProfit));
        const technicalRisk = Math.min(100, gasRatio * 100);
        // Calculate total risk score (weighted average)
        const total = (marketRisk * 0.3 +
            liquidityRisk * 0.2 +
            concentrationRisk * 0.2 +
            historicalRisk * 0.2 +
            technicalRisk * 0.1);
        // Determine rating
        let rating;
        if (total < 25)
            rating = 'low';
        else if (total < 50)
            rating = 'medium';
        else if (total < 75)
            rating = 'high';
        else
            rating = 'critical';
        return {
            total,
            components: {
                market: marketRisk,
                liquidity: liquidityRisk,
                concentration: concentrationRisk,
                historical: historicalRisk,
                technical: technicalRisk,
            },
            rating,
        };
    }
    /**
     * Post-trade risk update
     */
    async updatePostTrade(result, opportunity) {
        this.tradeHistory.push(result);
        this.metrics.dailyTrades++;
        if (result.success) {
            // Update profit metrics
            const profitUsd = (0, math_1.tokenAmountToUsd)(result.actualProfit || BigInt(0), await this.getTokenPrice(opportunity.simulation.path.tokens[0].address), opportunity.simulation.path.tokens[0].decimals);
            this.metrics.dailyProfit += profitUsd;
            this.metrics.consecutiveFailures = 0; // Reset on success
            // Update position
            this.updatePosition(opportunity, true);
            logger.info(`Trade successful - Profit: $${profitUsd.toFixed(2)}, Daily P&L: $${(this.metrics.dailyProfit - this.metrics.dailyLoss).toFixed(2)}`);
        }
        else {
            // Update loss metrics
            this.metrics.consecutiveFailures++;
            // Estimate loss (gas costs at minimum)
            const lossUsd = (0, math_1.tokenAmountToUsd)(result.gasUsed || BigInt(0), 0.8, // Approximate MATIC price
            18);
            this.metrics.dailyLoss += lossUsd;
            // Update position
            this.updatePosition(opportunity, false);
            logger.warn(`Trade failed - Loss: $${lossUsd.toFixed(2)}, Consecutive failures: ${this.metrics.consecutiveFailures}`);
            // Check if we need to trigger circuit breaker
            if (this.metrics.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
                this.triggerCircuitBreaker('consecutive_failures_post_trade');
            }
        }
        // Update gas spent
        if (result.gasUsed) {
            this.metrics.gasSpentToday += result.gasUsed * (result.effectiveGasPrice || BigInt(0));
        }
        // Check daily gas limit
        if (this.metrics.gasSpentToday > this.limits.maxGasPerDay) {
            logger.error('Daily gas limit exceeded');
            this.triggerCircuitBreaker('gas_limit_exceeded');
        }
    }
    /**
     * Update position tracking
     */
    async updatePosition(opportunity, success) {
        const token = opportunity.simulation.path.tokens[0];
        const tokenPrice = await this.getTokenPrice(token.address);
        if (success) {
            const position = {
                token: token.address,
                amount: opportunity.simulation.inputAmount,
                valueUsd: (0, math_1.tokenAmountToUsd)(opportunity.simulation.inputAmount, tokenPrice, token.decimals),
                entryPrice: tokenPrice,
                timestamp: Date.now(),
                dex: opportunity.simulation.path.dexes[0],
            };
            this.positions.set(token.address, position);
            // Update exposures
            const currentExposure = this.metrics.tokenExposures.get(token.address) || 0;
            this.metrics.tokenExposures.set(token.address, currentExposure + position.valueUsd);
            this.metrics.totalExposureUsd = Array.from(this.metrics.tokenExposures.values())
                .reduce((sum, exp) => sum + exp, 0);
        }
        else {
            // Reduce exposure on failure
            const currentExposure = this.metrics.tokenExposures.get(token.address) || 0;
            const tradeValue = (0, math_1.tokenAmountToUsd)(opportunity.simulation.inputAmount, tokenPrice, token.decimals);
            this.metrics.tokenExposures.set(token.address, Math.max(0, currentExposure - tradeValue));
            this.metrics.totalExposureUsd = Array.from(this.metrics.tokenExposures.values())
                .reduce((sum, exp) => sum + exp, 0);
        }
    }
    /**
     * Trigger circuit breaker
     */
    triggerCircuitBreaker(reason) {
        if (this.metrics.circuitBreakerActive) {
            logger.warn('Circuit breaker already active');
            return;
        }
        logger.error(`CIRCUIT BREAKER TRIGGERED: ${reason}`);
        this.metrics.circuitBreakerActive = true;
        this.metrics.lastCircuitBreakerTime = Date.now();
        // Emit event
        this.emit('circuit-breaker-triggered', reason);
        // Set automatic reset timer
        const cooldownMs = config_1.Config.risk.circuitBreakerCooldownMs;
        this.circuitBreakerResetTimer = setTimeout(() => {
            this.resetCircuitBreaker();
        }, cooldownMs);
        logger.info(`Circuit breaker will reset in ${cooldownMs / 1000} seconds`);
    }
    /**
     * Reset circuit breaker
     */
    resetCircuitBreaker() {
        logger.info('Circuit breaker reset');
        this.metrics.circuitBreakerActive = false;
        this.metrics.consecutiveFailures = 0;
        if (this.circuitBreakerResetTimer) {
            clearTimeout(this.circuitBreakerResetTimer);
            this.circuitBreakerResetTimer = null;
        }
    }
    /**
     * Get circuit breaker time remaining
     */
    getCircuitBreakerTimeRemaining() {
        if (!this.metrics.circuitBreakerActive)
            return 0;
        const elapsed = Date.now() - this.metrics.lastCircuitBreakerTime;
        const remaining = config_1.Config.risk.circuitBreakerCooldownMs - elapsed;
        return Math.max(0, Math.ceil(remaining / 1000));
    }
    /**
     * Check market volatility
     */
    async checkVolatility() {
        // Simplified volatility check - in production, use actual volatility indicators
        const recentFailureRate = this.metrics.dailyTrades > 0
            ? (this.metrics.consecutiveFailures / this.metrics.dailyTrades) * 100
            : 0;
        if (recentFailureRate > 50) {
            return { isHigh: true, level: 'extreme' };
        }
        else if (recentFailureRate > 30) {
            return { isHigh: true, level: 'high' };
        }
        else if (recentFailureRate > 15) {
            return { isHigh: false, level: 'moderate' };
        }
        else {
            return { isHigh: false, level: 'low' };
        }
    }
    /**
     * Get token price
     */
    async getTokenPrice(tokenAddress) {
        const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
        return await oracle.getTokenPriceUSD(tokenAddress) || 0;
    }
    /**
     * Start daily reset timer
     */
    startDailyReset() {
        // Calculate time until midnight UTC
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        tomorrow.setUTCHours(0, 0, 0, 0);
        const msUntilMidnight = tomorrow.getTime() - now.getTime();
        // Set timer for midnight reset
        setTimeout(() => {
            this.resetDailyMetrics();
            // Then reset every 24 hours
            this.dailyResetTimer = setInterval(() => {
                this.resetDailyMetrics();
            }, 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
        logger.info(`Daily metrics will reset in ${(msUntilMidnight / 1000 / 60).toFixed(0)} minutes`);
    }
    /**
     * Reset daily metrics
     */
    resetDailyMetrics() {
        logger.info('Resetting daily risk metrics');
        const previousPnL = this.metrics.dailyProfit - this.metrics.dailyLoss;
        this.metrics.dailyLoss = 0;
        this.metrics.dailyProfit = 0;
        this.metrics.dailyTrades = 0;
        this.metrics.gasSpentToday = BigInt(0);
        // Keep consecutive failures and circuit breaker state
        logger.info(`Previous day P&L: $${previousPnL.toFixed(2)}`);
    }
    /**
     * Get current risk metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * Get risk limits
     */
    getLimits() {
        return { ...this.limits };
    }
    /**
     * Update risk limits (admin only)
     */
    updateLimits(newLimits) {
        this.limits = { ...this.limits, ...newLimits };
        logger.info('Risk limits updated:', this.limits);
    }
    /**
     * Emergency stop - trigger circuit breaker immediately
     */
    emergencyStop() {
        logger.error('EMERGENCY STOP ACTIVATED');
        this.triggerCircuitBreaker('emergency_stop');
    }
    /**
     * Get risk report
     */
    getRiskReport() {
        const netPnL = this.metrics.dailyProfit - this.metrics.dailyLoss;
        const winRate = this.metrics.dailyTrades > 0
            ? ((this.metrics.dailyTrades - this.metrics.consecutiveFailures) / this.metrics.dailyTrades * 100)
            : 0;
        return {
            summary: {
                circuitBreakerActive: this.metrics.circuitBreakerActive,
                dailyPnL: netPnL.toFixed(2),
                dailyTrades: this.metrics.dailyTrades,
                winRate: winRate.toFixed(1) + '%',
                consecutiveFailures: this.metrics.consecutiveFailures,
                highestRiskScore: this.metrics.highestRiskScore.toFixed(1),
            },
            exposures: {
                total: this.metrics.totalExposureUsd.toFixed(2),
                byToken: Object.fromEntries(Array.from(this.metrics.tokenExposures.entries()).map(([k, v]) => [k, v.toFixed(2)])),
            },
            limits: {
                maxDailyLossUsd: this.limits.maxDailyLossUsd,
                maxConsecutiveFailures: this.limits.maxConsecutiveFailures,
                maxExposurePerToken: this.limits.maxExposurePerToken,
                maxTotalExposure: this.limits.maxTotalExposure,
                maxDailyTrades: this.limits.maxDailyTrades,
                maxGasPerDay: this.limits.maxGasPerDay.toString(), // Convert BigInt to string
                maxPriceImpact: this.limits.maxPriceImpact,
                minLiquidity: this.limits.minLiquidity.toString(), // Convert BigInt to string
                maxSlippage: this.limits.maxSlippage,
            },
            positions: Array.from(this.positions.values()).map(p => ({
                ...p,
                amount: p.amount.toString(), // Convert BigInt to string
            })),
            gasSpent: {
                wei: this.metrics.gasSpentToday.toString(), // Convert BigInt to string
                matic: (0, math_1.fromWei)(this.metrics.gasSpentToday, 18),
            },
        };
    }
    /**
     * Cleanup
     */
    destroy() {
        if (this.circuitBreakerResetTimer) {
            clearTimeout(this.circuitBreakerResetTimer);
        }
        if (this.dailyResetTimer) {
            clearInterval(this.dailyResetTimer);
        }
    }
}
exports.RiskManager = RiskManager;
// Singleton instance
let riskManager = null;
function getRiskManager() {
    if (!riskManager) {
        riskManager = new RiskManager();
    }
    return riskManager;
}
//# sourceMappingURL=riskManager.js.map