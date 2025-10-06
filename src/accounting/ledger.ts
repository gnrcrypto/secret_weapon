import { DataSource, Repository } from 'typeorm';
import { TradeEntity } from '../database/entities/trade.entity';
import { WalletEntity } from '../database/entities/wallet.entity';
import { TokenEntity } from '../database/entities/token.entity';
import { DexEntity } from '../database/entities/dex.entity';
import { SimulationResult } from '../arb/simulator';
import { ExecutionResult } from '../exec/executor';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'ledger' },
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

export class Ledger {
  private tradeRepo: Repository<TradeEntity>;
  private walletRepo: Repository<WalletEntity>;
  private tokenRepo: Repository<TokenEntity>;
  private dexRepo: Repository<DexEntity>;

  constructor(dataSource: DataSource) {
    this.tradeRepo = dataSource.getRepository(TradeEntity);
    this.walletRepo = dataSource.getRepository(WalletEntity);
    this.tokenRepo = dataSource.getRepository(TokenEntity);
    this.dexRepo = dataSource.getRepository(DexEntity);
  }

  async recordTrade(
    simulation: SimulationResult,
    execution: ExecutionResult,
    walletAddress: string
  ): Promise<TradeEntity> {
    const trade = new TradeEntity();

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

  private async updateWalletStats(address: string, trade: TradeEntity): Promise<void> {
    let wallet = await this.walletRepo.findOne({ where: { address } });

    if (!wallet) {
      wallet = new WalletEntity();
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
      } else {
        wallet.totalLossUsd += Math.abs(trade.netProfitUsd);
      }
    } else {
      wallet.totalLossUsd += Math.abs(trade.netProfitUsd);
    }

    await this.walletRepo.save(wallet);
  }

  private async updateTokenStats(address: string, trade: TradeEntity): Promise<void> {
    let token = await this.tokenRepo.findOne({ where: { address } });

    if (!token) {
      token = new TokenEntity();
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

  private async updateDexStats(dexName: string, trade: TradeEntity): Promise<void> {
    let dex = await this.dexRepo.findOne({ where: { name: dexName } });

    if (!dex) {
      dex = new DexEntity();
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

  async getPnL(
    startDate: Date,
    endDate: Date,
    walletAddress?: string
  ): Promise<{
    totalProfit: number;
    totalLoss: number;
    netPnL: number;
    tradeCount: number;
    successRate: number;
  }> {
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

  async getTopTokens(limit: number = 10): Promise<TokenEntity[]> {
    return this.tokenRepo
      .createQueryBuilder('token')
      .orderBy('token.totalProfitGenerated', 'DESC')
      .limit(limit)
      .getMany();
  }

  async getTopDexes(limit: number = 5): Promise<DexEntity[]> {
    return this.dexRepo
      .createQueryBuilder('dex')
      .orderBy('dex.totalProfitGenerated', 'DESC')
      .limit(limit)
      .getMany();
  }

  async getRecentTrades(limit: number = 20): Promise<TradeEntity[]> {
    return this.tradeRepo
      .createQueryBuilder('trade')
      .orderBy('trade.createdAt', 'DESC')
      .limit(limit)
      .getMany();
  }

  async getWalletPerformance(address: string): Promise<WalletEntity | null> {
    return this.walletRepo.findOne({ where: { address } });
  }
}
