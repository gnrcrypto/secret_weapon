import { DataSource } from 'typeorm';
import { TradeEntity } from '../database/entities/trade.entity';
import { WalletEntity } from '../database/entities/wallet.entity';
import { TokenEntity } from '../database/entities/token.entity';
import { DexEntity } from '../database/entities/dex.entity';
import { SimulationResult } from '../arb/simulator';
import { ExecutionResult } from '../exec/executor';
export declare class Ledger {
    private tradeRepo;
    private walletRepo;
    private tokenRepo;
    private dexRepo;
    constructor(dataSource: DataSource);
    recordTrade(simulation: SimulationResult, execution: ExecutionResult, walletAddress: string): Promise<TradeEntity>;
    private updateWalletStats;
    private updateTokenStats;
    private updateDexStats;
    getPnL(startDate: Date, endDate: Date): Promise<{
        totalProfit: number;
        totalLoss: number;
        netPnL: number;
        tradeCount: number;
        successRate: number;
    }>;
    getTopTokens(limit?: number): Promise<TokenEntity[]>;
    getTopDexes(limit?: number): Promise<DexEntity[]>;
    getRecentTrades(limit?: number): Promise<TradeEntity[]>;
    getWalletPerformance(address: string): Promise<WalletEntity | null>;
}
//# sourceMappingURL=ledger.d.ts.map