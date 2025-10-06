import { DataSource } from 'typeorm';
import { TradeEntity } from '../database/entities/trade.entity';
import { WalletEntity } from '../database/entities/wallet.entity';
import { TokenEntity } from '../database/entities/token.entity';
import { DexEntity } from '../database/entities/dex.entity';
import { SimulationResult } from '../arb/simulator';
import { ExecutionResult } from '../exec/executor';
export declare class Ledger {
    private dataSource;
    private tradeRepo;
    private walletRepo;
    private tokenRepo;
    private dexRepo;
    constructor(dataSource: DataSource);
    /**
     * Record a trade execution
     */
    recordTrade(simulation: SimulationResult, execution: ExecutionResult, walletAddress: string): Promise<TradeEntity>;
    /**
     * Update wallet statistics
     */
    private updateWalletStats;
    /**
     * Update token statistics
     */
    private updateTokenStats;
    /**
     * Update DEX statistics
     */
    private updateDexStats;
    /**
     * Get P&L for a period
     */
    getPnL(startDate: Date, endDate: Date, walletAddress?: string): Promise<{
        totalProfit: number;
        totalLoss: number;
        netPnL: number;
        tradeCount: number;
        successRate: number;
    }>;
    /**
     * Get top performing tokens
     */
    getTopTokens(limit?: number): Promise<TokenEntity[]>;
    /**
     * Get top performing DEXes
     */
    getTopDexes(limit?: number): Promise<DexEntity[]>;
    /**
     * Get recent trades
     */
    getRecentTrades(limit?: number): Promise<TradeEntity[]>;
    /**
     * Get wallet performance
     */
    getWalletPerformance(address: string): Promise<WalletEntity | null>;
}
//# sourceMappingURL=ledger.d.ts.map