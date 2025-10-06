import { ArbitragePath } from '../arb/pathfinder';
export interface Performance {
    totalTrades: number;
    successfulTrades: number;
    totalProfitUsd: number;
    totalLossUsd: number;
    avgProfitPerTradeUsd: number;
    winRate: number;
}
export interface Statistic {
    timestamp: Date;
    path: ArbitragePath;
    profitUsd: number;
    success: boolean;
    details: {
        priceImpact: number;
        slippage: number;
        confidence: number;
    };
}
//# sourceMappingURL=metrics.types.d.ts.map