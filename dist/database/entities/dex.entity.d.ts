export declare class DexEntity {
    id: string;
    name: string;
    protocol: string;
    totalTradeVolume: number;
    totalProfitGenerated: number;
    totalTrades: number;
    averagePriceImpact: number;
    liquidityPools: Array<{
        token0: string;
        token1: string;
        liquidity: string;
    }>;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=dex.entity.d.ts.map