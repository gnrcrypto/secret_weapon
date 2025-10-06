"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ledger = void 0;
const trade_entity_1 = require("../database/entities/trade.entity");
const wallet_entity_1 = require("../database/entities/wallet.entity");
const token_entity_1 = require("../database/entities/token.entity");
const dex_entity_1 = require("../database/entities/dex.entity");
const winston_1 = __importDefault(require("winston"));
const logger = winston_1.default.createLogger({
    level: 'info',
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'ledger' },
    transports: [
        new winston_1.default.transports.Console({ format: winston_1.default.format.simple() }),
    ],
});
class Ledger {
    tradeRepo;
    walletRepo;
    tokenRepo;
    dexRepo;
    constructor(dataSource) {
        this.tradeRepo = dataSource.getRepository(trade_entity_1.TradeEntity);
        this.walletRepo = dataSource.getRepository(wallet_entity_1.WalletEntity);
        this.tokenRepo = dataSource.getRepository(token_entity_1.TokenEntity);
        this.dexRepo = dataSource.getRepository(dex_entity_1.DexEntity);
    }
    async recordTrade(simulation, execution, walletAddress) {
        const trade = new trade_entity_1.TradeEntity();
        trade.pathType = simulation.path.type;
        trade.tokens = simulation.path.tokens.map(t => t.symbol);
        trade.dexes = simulation.path.dexes;
        trade.inputAmount = simulation.inputAmount.toString();
        trade.outputAmount = simulation.outputAmount.toString();
        trade.netProfitUsd = simulation.netProfitUsd;
        trade.priceImpact = simulation.priceImpact;
        trade.slippage = simulation.slippage;
        trade.confidence = simulation.confidence;
        trade.isSuccessful = execution.success;
        if (execution.transactionHash) {
            trade.transactionHash = execution.transactionHash;
        }
        if (execution.receipt) {
            trade.blockNumber = execution.receipt.blockNumber.toString();
            trade.gasUsed = execution.gasUsed?.toString() || '0';
            trade.gasPrice = execution.effectiveGasPrice?.toString() || '0';
        }
        const savedTrade = await this.tradeRepo.save(trade);
        await this.updateWalletStats(walletAddress, trade);
        await this.updateTokenStats(simulation.path.tokens[0].address, trade);
        await this.updateDexStats(simulation.path.dexes[0], trade);
        logger.info(`Trade recorded: ${savedTrade.id} - Profit: $${trade.netProfitUsd}`);
        return savedTrade;
    }
    async updateWalletStats(address, trade) {
        let wallet = await this.walletRepo.findOne({ where: { address } });
        if (!wallet) {
            wallet = new wallet_entity_1.WalletEntity();
            wallet.address = address;
            wallet.totalProfitUsd = 0;
            wallet.totalLossUsd = 0;
            wallet.totalTrades = 0;
            wallet.successfulTrades = 0;
            wallet.tokenBalances = {};
        }
        wallet.totalTrades++;
        if (trade.isSuccessful) {
            wallet.successfulTrades++;
            if (trade.netProfitUsd > 0) {
                wallet.totalProfitUsd += trade.netProfitUsd;
            }
            else {
                wallet.totalLossUsd += Math.abs(trade.netProfitUsd);
            }
        }
        else {
            wallet.totalLossUsd += Math.abs(trade.netProfitUsd);
        }
        await this.walletRepo.save(wallet);
    }
    async updateTokenStats(address, trade) {
        let token = await this.tokenRepo.findOne({ where: { address } });
        if (!token) {
            token = new token_entity_1.TokenEntity();
            token.address = address;
            token.symbol = trade.tokens[0];
            token.name = trade.tokens[0];
            token.decimals = 18;
            token.totalTradeVolume = 0;
            token.totalProfitGenerated = 0;
        }
        const tradeVolume = parseFloat(trade.inputAmount) / 1e18;
        token.totalTradeVolume += tradeVolume;
        if (trade.isSuccessful && trade.netProfitUsd > 0) {
            token.totalProfitGenerated += trade.netProfitUsd;
        }
        await this.tokenRepo.save(token);
    }
    async updateDexStats(dexName, trade) {
        let dex = await this.dexRepo.findOne({ where: { name: dexName } });
        if (!dex) {
            dex = new dex_entity_1.DexEntity();
            dex.name = dexName;
            dex.protocol = dexName;
            dex.totalTradeVolume = 0;
            dex.totalProfitGenerated = 0;
            dex.totalTrades = 0;
            dex.averagePriceImpact = 0;
        }
        dex.totalTrades++;
        const tradeVolume = parseFloat(trade.inputAmount) / 1e18;
        dex.totalTradeVolume += tradeVolume;
        if (trade.isSuccessful && trade.netProfitUsd > 0) {
            dex.totalProfitGenerated += trade.netProfitUsd;
        }
        dex.averagePriceImpact =
            (dex.averagePriceImpact * (dex.totalTrades - 1) + trade.priceImpact) / dex.totalTrades;
        await this.dexRepo.save(dex);
    }
    async getPnL(startDate, endDate
    // removed walletAddress? param as it was unused
    ) {
        const query = this.tradeRepo
            .createQueryBuilder('trade')
            .where('trade.createdAt BETWEEN :startDate AND :endDate', {
            startDate,
            endDate,
        });
        const trades = await query.getMany();
        const totalProfit = trades
            .filter(t => t.isSuccessful && t.netProfitUsd > 0)
            .reduce((sum, t) => sum + t.netProfitUsd, 0);
        const totalLoss = trades
            .filter(t => !t.isSuccessful || t.netProfitUsd < 0)
            .reduce((sum, t) => sum + Math.abs(t.netProfitUsd), 0);
        const successfulTrades = trades.filter(t => t.isSuccessful).length;
        return {
            totalProfit,
            totalLoss,
            netPnL: totalProfit - totalLoss,
            tradeCount: trades.length,
            successRate: trades.length > 0 ? (successfulTrades / trades.length) * 100 : 0,
        };
    }
    async getTopTokens(limit = 10) {
        return this.tokenRepo
            .createQueryBuilder('token')
            .orderBy('token.totalProfitGenerated', 'DESC')
            .limit(limit)
            .getMany();
    }
    async getTopDexes(limit = 5) {
        return this.dexRepo
            .createQueryBuilder('dex')
            .orderBy('dex.totalProfitGenerated', 'DESC')
            .limit(limit)
            .getMany();
    }
    async getRecentTrades(limit = 20) {
        return this.tradeRepo
            .createQueryBuilder('trade')
            .orderBy('trade.createdAt', 'DESC')
            .limit(limit)
            .getMany();
    }
    async getWalletPerformance(address) {
        return this.walletRepo.findOne({ where: { address } });
    }
}
exports.Ledger = Ledger;
//# sourceMappingURL=ledger.js.map