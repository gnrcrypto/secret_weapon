import { config as dotenvConfig } from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenvConfig();
export type DexName = 'quickswap' | 'sushiswap' | 'uniswapv3' | 'curveswap';

const configSchema = Joi.object({
  network: Joi.object({
    rpcUrl: Joi.string().uri().required(),
    rpcUrlBackup: Joi.string().uri().optional(),
    chainId: Joi.number().required(),
    blockPollingInterval: Joi.number().min(50).default(100),
  }),
  wallet: Joi.object({
    privateKey: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).optional(),
    mnemonic: Joi.string().optional(),
    address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
  }).or('privateKey', 'mnemonic'),
  providers: Joi.object({
    infuraKey: Joi.string().optional(),
    alchemyKey: Joi.string().optional(),
    quicknodeEndpoint: Joi.string().optional(),
  }),
  gas: Joi.object({
    strategy: Joi.string().valid('conservative', 'standard', 'aggressive').default('standard'),
    maxGasGwei: Joi.number().min(1).max(1000).required(),
    gasMultiplier: Joi.number().min(1).max(2).default(1.2),
    maxPriorityFeeGwei: Joi.number().min(0).default(30),
    baseFeeMultiplier: Joi.number().min(1).max(3).default(2),
    defaultGasLimit: Joi.number().min(100000).default(6000000),
    profitThresholdMultiplier: Joi.number().min(1).default(2),
  }),
  execution: Joi.object({
    mode: Joi.string().valid('simulate', 'live').default('simulate'),
    slippageBps: Joi.number().min(0).max(1000).default(50),
    minProfitThresholdUsd: Joi.number().min(0).default(5),
    maxTradeSizeUsd: Joi.number().min(0).default(10000),
    tradeCapPerTx: Joi.number().min(0).default(5000),
    maxPositionSizeUsd: Joi.number().min(0).default(50000),
    txDeadlineSeconds: Joi.number().min(60).default(1200),
  }),
  flashloan: Joi.object({
    enabled: Joi.boolean().default(true),
    provider: Joi.string().valid('aave', 'balancer', 'dodo').default('aave'),
    maxFlashloanUsd: Joi.number().min(0).default(100000),
    flashloanFeeBps: Joi.number().min(0).max(100).default(9),
  }),
  // Then update the dex schema:
  dex: Joi.object({
    enabledDexes: Joi.array().items(
      Joi.string().valid('quickswap', 'sushiswap', 'uniswapv3', 'curveswap')
    ).min(1).required(),
    quickswapRouter: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    sushiswapRouter: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    uniswapV3Router: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(), // Changed from optional to required
  }),
  database: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().default(5432),
    username: Joi.string().default('arbitrage_user'),
    password: Joi.string().default('pass'),
    database: Joi.string().default('arbitrage_bot'),
    accountingDbUrl: Joi.string().optional(),
    redisUrl: Joi.string().default('redis://localhost:6379'),
    poolSize: Joi.number().min(5).max(100).default(20),
  }),
  monitoring: Joi.object({
    sentryDsn: Joi.string().optional(),
    prometheusPort: Joi.number().default(9090),
    healthCheckPort: Joi.number().default(3000),
    logLevel: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
    opportunityScanInterval: Joi.number().min(1000).default(30000),
  }),
  alerts: Joi.object({
    slackWebhookUrl: Joi.string().uri().optional(),
    minProfitAlertUsd: Joi.number().min(0).default(100),
    maxLossAlertUsd: Joi.number().min(0).default(50),
  }),
  risk: Joi.object({
    dailyLossLimitUsd: Joi.number().min(0).default(500),
    maxConsecutiveFailures: Joi.number().min(1).default(5),
    circuitBreakerCooldownMs: Joi.number().min(0).default(60000),
    maxGasPerBlock: Joi.number().min(0).default(30000000),
    maxExposurePerTrade: Joi.number().min(0).default(25000),
    maxDailyExposure: Joi.number().min(0).default(100000),
    maxSingleTokenExposure: Joi.object().pattern(Joi.string(), Joi.number().min(0)).default({}),
    maxDailyTrades: Joi.number().min(1).default(100),
    maxPriceImpact: Joi.number().min(0).max(100).default(5),
    maxSlippage: Joi.number().min(0).max(100).default(1),
    minConfidence: Joi.number().min(0).max(1).default(0.8),
  }),
  performance: Joi.object({
    priceCacheTtlMs: Joi.number().min(0).default(500),
    pathCacheTtlMs: Joi.number().min(0).default(5000),
    maxConcurrentSimulations: Joi.number().min(1).max(50).default(10),
    workerPoolSize: Joi.number().min(1).max(20).default(4),
  }),
  security: Joi.object({
    apiKeyHeader: Joi.string().default('X-API-KEY'),
    apiKey: Joi.string().min(32).required(),
    enableReplayProtection: Joi.boolean().default(true),
    nonceManagerType: Joi.string().valid('redis', 'memory', 'db').default('redis'),
  }),
  features: Joi.object({
    enableTriangularArb: Joi.boolean().default(true),
    enableCrossDexArb: Joi.boolean().default(true),
    enableMevProtection: Joi.boolean().default(true),
    enableSandwichProtection: Joi.boolean().default(true),
  }),
  workers: Joi.object({
    poolSize: Joi.number().min(1).max(20).default(4),
  }),
});

// Helper function to construct database URL
function getDatabaseUrl(): string {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const username = process.env.DB_USERNAME || 'arbitrage_user';
  const password = process.env.DB_PASSWORD || 'pass';
  const database = process.env.DB_NAME || 'arbitrage_bot';
  
  return `postgresql://${username}:${password}@${host}:${port}/${database}`;
}

// Parse environment variables into config object
const rawConfig = {
  network: {
    rpcUrl: process.env.RPC_URL_POLYGON!,
    rpcUrlBackup: process.env.RPC_URL_POLYGON_BACKUP,
    chainId: parseInt(process.env.CHAIN_ID || '137'),
    blockPollingInterval: parseInt(process.env.BLOCK_POLLING_INTERVAL_MS || '1000'),
  },
  wallet: {
    privateKey: process.env.PRIVATE_KEY,
    mnemonic: process.env.MNEMONIC,
    address: process.env.HOT_WALLET_ADDRESS,
  },
  providers: {
    infuraKey: process.env.INFURA_KEY,
    alchemyKey: process.env.ALCHEMY_KEY,
    quicknodeEndpoint: process.env.QUICKNODE_ENDPOINT,
  },
  gas: {
    strategy: process.env.GAS_PRICE_STRATEGY as 'conservative' | 'standard' | 'aggressive',
    maxGasGwei: parseFloat(process.env.MAX_GAS_GWEI || '500'),
    gasMultiplier: parseFloat(process.env.GAS_MULTIPLIER || '1.2'),
    maxPriorityFeeGwei: parseFloat(process.env.MAX_PRIORITY_FEE_GWEI || '50'),
    baseFeeMultiplier: parseFloat(process.env.BASE_FEE_MULTIPLIER || '2'),
    defaultGasLimit: parseInt(process.env.DEFAULT_GAS_LIMIT || '6000000'),
    profitThresholdMultiplier: parseInt(process.env.PROFIT_THRESHOLD_MULTIPLIER || '2'),
  },
  execution: {
    mode: process.env.EXECUTOR_MODE as 'simulate' | 'live',
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50'),
    minProfitThresholdUsd: parseFloat(process.env.MIN_PROFIT_THRESHOLD_USD || '0.1'),
    maxTradeSizeUsd: parseFloat(process.env.MAX_TRADE_SIZE_USD || '100000'),
    tradeCapPerTx: parseFloat(process.env.TRADE_CAP_PER_TX || '50000'),
    maxPositionSizeUsd: parseFloat(process.env.MAX_POSITION_SIZE_USD || '50000'),
    txDeadlineSeconds: parseInt(process.env.TX_DEADLINE_SECONDS || '1200'),
  },
  flashloan: {
    enabled: process.env.ENABLE_FLASHLOANS === 'true',
    provider: process.env.FLASHLOAN_PROVIDER as 'aave' | 'balancer' | 'dodo',
    maxFlashloanUsd: parseFloat(process.env.MAX_FLASHLOAN_USD || '1000000'),
    flashloanFeeBps: parseFloat(process.env.FLASHLOAN_FEE_BPS || '0'),
  },
  dex: {
    enabledDexes: (process.env.ENABLED_DEXES?.split(',') as DexName[]) || ['quickswap', 'sushiswap', 'uniswapv3', 'curveswap'], // Default to all three
    quickswapRouter: process.env.QUICKSWAP_ROUTER!,
    sushiswapRouter: process.env.SUSHISWAP_ROUTER!,
    uniswapV3Router: process.env.UNISWAPV3_ROUTER!, // Changed from optional to required
    curveswapRouter: process.env.CURVESWAP_ROUTER!,
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'arbitrage_user',
    password: process.env.DB_PASSWORD || 'pass',
    database: process.env.DB_NAME || 'arbitrage_bot',
    accountingDbUrl: process.env.ACCOUNTING_DB_URL || getDatabaseUrl(),
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '20'),
  },
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN,
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9090'),
    healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT || '3000'),
    logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
    opportunityScanInterval: parseInt(process.env.OPPORTUNITY_SCAN_INTERVAL || '30000'),
  },
  alerts: {
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    minProfitAlertUsd: parseFloat(process.env.ALERT_MIN_PROFIT_USD || '100'),
    maxLossAlertUsd: parseFloat(process.env.ALERT_MAX_LOSS_USD || '50'),
  },
  risk: {
    dailyLossLimitUsd: parseFloat(process.env.DAILY_LOSS_LIMIT_USD || '500'),
    maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '5'),
    circuitBreakerCooldownMs: parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '60000'),
    maxGasPerBlock: parseInt(process.env.MAX_GAS_PER_BLOCK || '30000000'),
    maxExposurePerTrade: parseInt(process.env.MAX_EXPOSURE_PER_TRADE || '25000'),
    maxDailyExposure: parseInt(process.env.MAX_DAILY_EXPOSURE || '100000'),
    maxSingleTokenExposure: {},
    maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '100'),
    maxPriceImpact: parseInt(process.env.MAX_PRICE_IMPACT || '5'),
    maxSlippage: parseInt(process.env.MAX_SLIPPAGE || '1'),
    minConfidence: parseFloat(process.env.MIN_CONFIDENCE || '0.8'),
  },
  performance: {
    priceCacheTtlMs: parseInt(process.env.PRICE_CACHE_TTL_MS || '500'),
    pathCacheTtlMs: parseInt(process.env.PATH_CACHE_TTL_MS || '5000'),
    maxConcurrentSimulations: parseInt(process.env.MAX_CONCURRENT_SIMULATIONS || '2'),
    workerPoolSize: parseInt(process.env.WORKER_POOL_SIZE || '2'),
  },
  security: {
    apiKeyHeader: process.env.API_KEY_HEADER || 'X-API-KEY',
    apiKey: process.env.API_KEY!,
    enableReplayProtection: process.env.ENABLE_REPLAY_PROTECTION === 'false',
    nonceManagerType: process.env.NONCE_MANAGER_TYPE as 'redis' | 'memory' | 'db',
  },
  features: {
    enableTriangularArb: process.env.ENABLE_TRIANGULAR_ARB === 'true',
    enableCrossDexArb: process.env.ENABLE_CROSS_DEX_ARB === 'true',
    enableMevProtection: process.env.ENABLE_MEV_PROTECTION === 'false',
    enableSandwichProtection: process.env.ENABLE_SANDWICH_PROTECTION === 'false',
  },
  workers: {
    poolSize: parseInt(process.env.WORKER_POOL_SIZE || '2'),
  },
};

// Validate configuration
const { error, value: validatedConfig } = configSchema.validate(rawConfig, {
  abortEarly: false,
  stripUnknown: true,
});

if (error) {
  console.error('Configuration validation failed:');
  error.details.forEach(detail => {
    console.error(`  - ${detail.message}`);
  });
  process.exit(1);
}

export const Config = validatedConfig as typeof rawConfig;

export const ADDRESSES = {
  WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  LINK: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBd39c',
  AAVE: '0xD6DF932A45C0f255f85a35A5aF1F2b5B18390d62',
  UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  WBTC: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  AAVE_LENDING_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  ROUTERS: {
    QUICKSWAP: validatedConfig.dex.quickswapRouter,
    SUSHISWAP: validatedConfig.dex.sushiswapRouter,
    UNISWAPV3: validatedConfig.dex.uniswapV3Router,
    CURVESWAP: validatedConfig.dex.curveswapRouter,
  },
} as const;

export const NETWORK = {
  POLYGON_CHAIN_ID: 137,
  BLOCK_TIME: 2000,
  MAX_BLOCK_RANGE: 2048,
  CONFIRMATION_BLOCKS: 3,
} as const;

export const isSimulationMode = (): boolean => {
  return Config.execution.mode === 'simulate';
};

export const isProduction = (): boolean => {
  return process.env.NODE_ENV === 'production' && Config.execution.mode === 'live';
};

// FIXED: Added missing parameter name
export const validatePartialConfig = (partialConfig: Partial<typeof rawConfig>): boolean => {
  const mergedConfig = { ...Config, ...partialConfig };
  const { error } = configSchema.validate(mergedConfig);
  return !error;
};

export const logConfig = (): void => {
  const sanitized = JSON.parse(JSON.stringify(Config));

  // Remove sensitive fields
  if (sanitized.wallet.privateKey) sanitized.wallet.privateKey = '***HIDDEN***';
  if (sanitized.wallet.mnemonic) sanitized.wallet.mnemonic = '***HIDDEN***';
  if (sanitized.providers.infuraKey) sanitized.providers.infuraKey = '***HIDDEN***';
  if (sanitized.providers.alchemyKey) sanitized.providers.alchemyKey = '***HIDDEN***';
  if (sanitized.database.password) sanitized.database.password = '***HIDDEN***';
  if (sanitized.database.accountingDbUrl) {
    sanitized.database.accountingDbUrl = sanitized.database.accountingDbUrl.replace(/:\/\/[^@]+@/, '://***:***@');
  }
  if (sanitized.security.apiKey) sanitized.security.apiKey = '***HIDDEN***';
  if (sanitized.alerts.slackWebhookUrl) sanitized.alerts.slackWebhookUrl = '***HIDDEN***';

  console.log('Configuration loaded:', JSON.stringify(sanitized, null, 2));
};

// Export database connection helper
export const getDatabaseConnectionConfig = () => {
  return {
    host: Config.database.host,
    port: Config.database.port,
    username: Config.database.username,
    password: Config.database.password,
    database: Config.database.database,
    url: Config.database.accountingDbUrl,
  };
};
