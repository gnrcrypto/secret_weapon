"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskManager = exports.RiskManager = void 0;
const config_1 = require("../config");
const winston_1 = __importDefault(require("winston"));
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'riskManager' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
class RiskManager {
    maxExposurePerTrade;
    maxDailyExposure;
    maxSingleTokenExposure;
    dailyTradeCount = 0;
    dailyTotalExposure = 0;
    lastResetTimestamp = Date.now();
    constructor() {
        this.maxExposurePerTrade = config_1.Config.risk.maxExposurePerTrade;
        this.maxDailyExposure = config_1.Config.risk.maxDailyExposure;
        this.maxSingleTokenExposure = new Map(Object.entries(config_1.Config.risk.maxSingleTokenExposure));
    }
    validateOpportunity(simulationResult, tokens) {
        const reasons = [];
        this.resetDailyCountersIfNeeded();
        if (!this.checkDailyTradeLimit(reasons)) {
            return { isValid: false, reasons };
        }
        if (!this.checkExposureLimits(simulationResult, tokens, reasons)) {
            return { isValid: false, reasons };
        }
        if (!this.checkSimulationRisks(simulationResult, reasons)) {
            return { isValid: false, reasons };
        }
        return {
            isValid: reasons.length === 0,
            reasons: reasons.length > 0 ? reasons : undefined
        };
    }
    checkDailyTradeLimit(reasons) {
        const maxDailyTrades = config_1.Config.risk.maxDailyTrades;
        if (this.dailyTradeCount >= maxDailyTrades) {
            reasons.push(`Exceeded max daily trades (${maxDailyTrades})`);
            return false;
        }
        return true;
    }
    checkExposureLimits(simulationResult, tokens, reasons) {
        const tradeExposure = Math.abs(simulationResult.netProfitUsd);
        if (this.dailyTotalExposure + tradeExposure > this.maxDailyExposure) {
            reasons.push(`Exceeds max daily exposure (${this.maxDailyExposure})`);
            return false;
        }
        if (tradeExposure > this.maxExposurePerTrade) {
            reasons.push(`Exceeds max trade exposure (${this.maxExposurePerTrade})`);
            return false;
        }
        for (const token of tokens) {
            const maxTokenExposure = this.maxSingleTokenExposure.get(token.address.toLowerCase());
            if (maxTokenExposure && tradeExposure > maxTokenExposure) {
                reasons.push(`Exceeds max exposure for token ${token.symbol}`);
                return false;
            }
        }
        return true;
    }
    checkSimulationRisks(simulationResult, reasons) {
        const { priceImpact, slippage, confidence } = simulationResult;
        const maxPriceImpact = config_1.Config.risk.maxPriceImpact;
        if (priceImpact > maxPriceImpact) {
            reasons.push(`High price impact (${priceImpact.toFixed(2)}%)`);
            return false;
        }
        const maxSlippage = config_1.Config.risk.maxSlippage;
        if (slippage > maxSlippage) {
            reasons.push(`High slippage (${slippage.toFixed(2)}%)`);
            return false;
        }
        const minConfidence = config_1.Config.risk.minConfidence;
        if (confidence < minConfidence) {
            reasons.push(`Low confidence (${confidence.toFixed(2)})`);
            return false;
        }
        return true;
    }
    recordSuccessfulTrade(simulationResult) {
        this.dailyTradeCount++;
        this.dailyTotalExposure += Math.abs(simulationResult.netProfitUsd);
    }
    resetDailyCountersIfNeeded() {
        const currentTime = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (currentTime - this.lastResetTimestamp > oneDayMs) {
            this.dailyTradeCount = 0;
            this.dailyTotalExposure = 0;
            this.lastResetTimestamp = currentTime;
        }
    }
    emergencyRiskMitigation() {
        logger.warn('Emergency risk mitigation triggered');
    }
}
exports.RiskManager = RiskManager;
exports.riskManager = new RiskManager();
//# sourceMappingURL=riskManager.js.map