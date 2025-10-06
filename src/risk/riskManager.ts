import { Config } from '../config';
import { Token } from '../arb/pathfinder';
import { SimulationResult } from '../arb/simulator';
import winston from 'winston';

const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'riskManager' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

export class RiskManager {
  private maxExposurePerTrade: number;
  private maxDailyExposure: number;
  private maxSingleTokenExposure: Map<string, number>;
  private dailyTradeCount: number = 0;
  private dailyTotalExposure: number = 0;
  private lastResetTimestamp: number = Date.now();

  constructor() {
    this.maxExposurePerTrade = Config.risk.maxExposurePerTrade;
    this.maxDailyExposure = Config.risk.maxDailyExposure;
    this.maxSingleTokenExposure = new Map(
      Object.entries(Config.risk.maxSingleTokenExposure)
    );
  }

  validateOpportunity(
    simulationResult: SimulationResult, 
    tokens: Token[]
  ): { isValid: boolean; reasons?: string[] } {
    const reasons: string[] = [];

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

  private checkDailyTradeLimit(reasons: string[]): boolean {
    const maxDailyTrades = Config.risk.maxDailyTrades;
    
    if (this.dailyTradeCount >= maxDailyTrades) {
      reasons.push(`Exceeded max daily trades (${maxDailyTrades})`);
      return false;
    }

    return true;
  }

  private checkExposureLimits(
    simulationResult: SimulationResult, 
    tokens: Token[],
    reasons: string[]
  ): boolean {
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

  private checkSimulationRisks(
    simulationResult: SimulationResult, 
    reasons: string[]
  ): boolean {
    const { priceImpact, slippage, confidence } = simulationResult;

    const maxPriceImpact = Config.risk.maxPriceImpact;
    if (priceImpact > maxPriceImpact) {
      reasons.push(`High price impact (${priceImpact.toFixed(2)}%)`);
      return false;
    }

    const maxSlippage = Config.risk.maxSlippage;
    if (slippage > maxSlippage) {
      reasons.push(`High slippage (${slippage.toFixed(2)}%)`);
      return false;
    }

    const minConfidence = Config.risk.minConfidence;
    if (confidence < minConfidence) {
      reasons.push(`Low confidence (${confidence.toFixed(2)})`);
      return false;
    }

    return true;
  }

  recordSuccessfulTrade(simulationResult: SimulationResult): void {
    this.dailyTradeCount++;
    this.dailyTotalExposure += Math.abs(simulationResult.netProfitUsd);
  }

  private resetDailyCountersIfNeeded(): void {
    const currentTime = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (currentTime - this.lastResetTimestamp > oneDayMs) {
      this.dailyTradeCount = 0;
      this.dailyTotalExposure = 0;
      this.lastResetTimestamp = currentTime;
    }
  }

  emergencyRiskMitigation(): void {
    logger.warn('Emergency risk mitigation triggered');
  }
}

export const riskManager = new RiskManager();
