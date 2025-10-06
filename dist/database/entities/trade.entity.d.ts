export declare class TradeEntity {
    id: string;
    pathType: 'triangular' | 'cross-dex' | 'flash-arb';
    tokens: string[];
    dexes: string[];
    inputAmount: string;
    outputAmount: string;
    netProfitUsd: number;
    priceImpact: number;
    slippage: number;
    confidence: number;
    isSuccessful: boolean;
    transactionHash: string;
    blockNumber: string;
    gasUsed: string;
    gasPrice: string;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=trade.entity.d.ts.map