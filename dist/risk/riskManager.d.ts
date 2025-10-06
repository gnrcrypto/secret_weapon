import { Token } from '../arb/pathfinder';
import { SimulationResult } from '../arb/simulator';
export declare class RiskManager {
    private maxExposurePerTrade;
    private maxDailyExposure;
    private maxSingleTokenExposure;
    private dailyTradeCount;
    private dailyTotalExposure;
    private lastResetTimestamp;
    constructor();
    validateOpportunity(simulationResult: SimulationResult, tokens: Token[]): {
        isValid: boolean;
        reasons?: string[];
    };
    private checkDailyTradeLimit;
    private checkExposureLimits;
    private checkSimulationRisks;
    recordSuccessfulTrade(simulationResult: SimulationResult): void;
    private resetDailyCountersIfNeeded;
    emergencyRiskMitigation(): void;
}
export declare const riskManager: RiskManager;
//# sourceMappingURL=riskManager.d.ts.map