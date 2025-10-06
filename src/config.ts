import Joi from 'joi';

export const ADDRESSES = {
  WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  WBTC: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  AAVE_LENDING_POOL: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
  ROUTERS: {
    QUICKSWAP: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    SUSHISWAP: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    UNISWAP: '0xE592427A0AEce92De3Edee1F18E0157C05861564'
  }
} as const;

export const Config = {
  network: {
    rpcUrl: process.env.RPC_URL || 'https://polygon-rpc.com',
    rpcUrlBackup: process.env.RPC_URL_BACKUP,
    chainId: parseInt(process.env.CHAIN_ID || '137'),
    blockPollingInterval: parseInt(process.env.BLOCK_POLLING_INTERVAL || '2000'),
    supportsEIP1559: true,
  },
  wallet: {
    privateKey: process.env.PRIVATE_KEY,
    mnemonic: process.env.MNEMONIC,
    address: process.env.WALLET_ADDRESS,
  },
  providers: {
    alchemyKey: process.env.ALCHEMY_KEY,
    infuraKey: process.env.INFURA_KEY,
    quicknodeEndpoint: process.env.QUICKNODE_ENDPOINT,
  },
  dex: {
    enabledDexes: (process.env.ENABLED_DEXES || 'quickswap,sushiswap').split(','),
  },
  gas: {
    strategy: process.env.GAS_STRATEGY || 'standard',
    maxGasGwei: parseFloat(process.env.MAX_GAS_GWEI || '500'),
    minGasGwei: parseFloat(process.env.MIN_GAS_GWEI || '30'),
    gasMultiplier: parseFloat(process.env.GAS_MULTIPLIER || '1.2'),
    maxPriorityFeeGwei: parseFloat(process.env.MAX_PRIORITY_FEE_GWEI || '50'),
    baseFeeMultiplier: parseFloat(process.env.BASE_FEE_MULTIPLIER || '1.5'),
    defaultGasLimit: 300000,
    profitThresholdMultiplier: 2,
  },
  execution: {
    mode: (process.env.EXECUTION_MODE || 'simulate') as 'simulate' | 'live',
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50'),
    minProfitThresholdUsd: parseFloat(process.env.MIN_PROFIT_USD || '10'),
    minProfitUsd: parseFloat(process.env.MIN_PROFIT_USD || '10'),
    minConfidence: 0.7,
    maxTradeSizeUsd: parseFloat(process.env.MAX_TRADE_SIZE_USD || '10000'),
    tradeCapPerTx: parseInt(process.env.TRADE_CAP_PER_TX || '3'),
    maxPositionSizeUsd: parseFloat(process.env.MAX_POSITION_SIZE_USD || '50000'),
    txDeadlineSeconds: 300,
    enableFlashLoanArbitrage: process.env.ENABLE_FLASH_LOAN_ARBITRAGE === 'true',
  },
  flashLoans: {
    maxFlashLoanAmountUsd: parseFloat(process.env.MAX_FLASH_LOAN_AMOUNT_USD || '50000'),
    minProfitThresholdUsd: parseFloat(process.env.MIN_FLASH_LOAN_PROFIT_USD || '50'),
    providers: ['aave', 'balancer'] as const,
    defaultProvider: (process.env.DEFAULT_FLASH_LOAN_PROVIDER || 'aave') as 'aave' | 'balancer',
    safetyMargin: parseFloat(process.env.FLASH_LOAN_SAFETY_MARGIN || '1.1'),
  },
  risk: {
    dailyLossLimitUsd: parseFloat(process.env.DAILY_LOSS_LIMIT_USD || '1000'),
    maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '5'),
    circuitBreakerCooldownMs: parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '300000'),
    maxGasPerBlock: parseInt(process.env.MAX_GAS_PER_BLOCK || '30000000'),
    maxExposurePerTrade: 1000,
    maxDailyExposure: 5000,
    maxSingleTokenExposure: {} as Record<string, number>,
    maxDailyTrades: 50,
    maxPriceImpact: 5,
    maxSlippage: 1,
    minConfidence: 0.7,
  },
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN,
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9090'),
    healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT || '3000'),
    logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
    performanceWindowDays: 30,
    opportunityScanInterval: 30000,
  },
  database: {
    accountingDbUrl: process.env.ACCOUNTING_DB_URL || 'postgresql://localhost:5432/arbitrage',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10'),
  },
  performance: {
    priceCacheTtlMs: parseInt(process.env.PRICE_CACHE_TTL_MS || '30000'),
    pathCacheTtlMs: parseInt(process.env.PATH_CACHE_TTL_MS || '60000'),
  },
  features: {
    enableTriangularArb: process.env.ENABLE_TRIANGULAR_ARB !== 'false',
    enableCrossDexArb: process.env.ENABLE_CROSS_DEX_ARB !== 'false',
    enableFlashLoans: process.env.ENABLE_FLASH_LOANS === 'true',
    enableMevProtection: process.env.ENABLE_MEV_PROTECTION === 'true',
  },
  workers: {
    poolSize: 4,
  },
  ADDRESSES,
};

const schema = Joi.object({
  network: Joi.object().required(),
  wallet: Joi.object().required(),
  execution: Joi.object().required(),
}).unknown(true);

const { error } = schema.validate(Config);
if (error) {
  error.details.forEach((detail: Joi.ValidationErrorItem) => {
    console.error(`Config validation error: ${detail.message}`);
  });
  throw new Error('Configuration validation failed');
}

export default Config;
