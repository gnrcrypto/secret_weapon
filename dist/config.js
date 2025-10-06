"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logConfig = exports.validatePartialConfig = exports.isProduction = exports.isSimulationMode = exports.NETWORK = exports.ADDRESSES = exports.Config = void 0;
const dotenv_1 = require("dotenv");
const joi_1 = __importDefault(require("joi"));
// Load environment variables
(0, dotenv_1.config)();
const configSchema = joi_1.default.object({
    network: joi_1.default.object({
        rpcUrl: joi_1.default.string().uri().required(),
        rpcUrlBackup: joi_1.default.string().uri().optional(),
        chainId: joi_1.default.number().required(),
        blockPollingInterval: joi_1.default.number().min(50).default(100),
    }),
    wallet: joi_1.default.object({
        privateKey: joi_1.default.string().pattern(/^0x[a-fA-F0-9]{64}$/).optional(),
        mnemonic: joi_1.default.string().optional(),
        address: joi_1.default.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
    }).or('privateKey', 'mnemonic'),
    providers: joi_1.default.object({
        infuraKey: joi_1.default.string().optional(),
        alchemyKey: joi_1.default.string().optional(),
        quicknodeEndpoint: joi_1.default.string().optional(),
    }),
    gas: joi_1.default.object({
        strategy: joi_1.default.string().valid('conservative', 'standard', 'aggressive').default('standard'),
        maxGasGwei: joi_1.default.number().min(1).max(1000).required(),
        gasMultiplier: joi_1.default.number().min(1).max(2).default(1.2),
        maxPriorityFeeGwei: joi_1.default.number().min(0).default(30),
        baseFeeMultiplier: joi_1.default.number().min(1).max(3).default(2),
        defaultGasLimit: joi_1.default.number().min(100000).default(6000000),
        profitThresholdMultiplier: joi_1.default.number().min(1).default(2),
    }),
    execution: joi_1.default.object({
        mode: joi_1.default.string().valid('simulate', 'live').default('simulate'),
        slippageBps: joi_1.default.number().min(0).max(1000).default(50),
        minProfitThresholdUsd: joi_1.default.number().min(0).default(5),
        maxTradeSizeUsd: joi_1.default.number().min(0).default(10000),
        tradeCapPerTx: joi_1.default.number().min(0).default(5000),
        maxPositionSizeUsd: joi_1.default.number().min(0).default(50000),
        txDeadlineSeconds: joi_1.default.number().min(60).default(1200),
    }),
    flashloan: joi_1.default.object({
        enabled: joi_1.default.boolean().default(true),
        provider: joi_1.default.string().valid('aave', 'balancer', 'dodo').default('aave'),
        maxFlashloanUsd: joi_1.default.number().min(0).default(100000),
        flashloanFeeBps: joi_1.default.number().min(0).max(100).default(9),
    }),
    dex: joi_1.default.object({
        enabledDexes: joi_1.default.array().items(joi_1.default.string()).min(1).required(),
        quickswapRouter: joi_1.default.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        sushiswapRouter: joi_1.default.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        uniswapV3Router: joi_1.default.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
    }),
    database: joi_1.default.object({
        accountingDbUrl: joi_1.default.string().required(),
        redisUrl: joi_1.default.string().default('redis://localhost:6379'),
        poolSize: joi_1.default.number().min(5).max(100).default(20),
    }),
    monitoring: joi_1.default.object({
        sentryDsn: joi_1.default.string().optional(),
        prometheusPort: joi_1.default.number().default(9090),
        healthCheckPort: joi_1.default.number().default(3000),
        logLevel: joi_1.default.string().valid('debug', 'info', 'warn', 'error').default('info'),
        opportunityScanInterval: joi_1.default.number().min(1000).default(30000),
    }),
    alerts: joi_1.default.object({
        slackWebhookUrl: joi_1.default.string().uri().optional(),
        minProfitAlertUsd: joi_1.default.number().min(0).default(100),
        maxLossAlertUsd: joi_1.default.number().min(0).default(50),
    }),
    risk: joi_1.default.object({
        dailyLossLimitUsd: joi_1.default.number().min(0).default(500),
        maxConsecutiveFailures: joi_1.default.number().min(1).default(5),
        circuitBreakerCooldownMs: joi_1.default.number().min(0).default(60000),
        maxGasPerBlock: joi_1.default.number().min(0).default(30000000),
        maxExposurePerTrade: joi_1.default.number().min(0).default(25000),
        maxDailyExposure: joi_1.default.number().min(0).default(100000),
        maxSingleTokenExposure: joi_1.default.object().pattern(joi_1.default.string(), joi_1.default.number().min(0)).default({}),
        maxDailyTrades: joi_1.default.number().min(1).default(100),
        maxPriceImpact: joi_1.default.number().min(0).max(100).default(5),
        maxSlippage: joi_1.default.number().min(0).max(100).default(1),
        minConfidence: joi_1.default.number().min(0).max(1).default(0.8),
    }),
    performance: joi_1.default.object({
        priceCacheTtlMs: joi_1.default.number().min(0).default(500),
        pathCacheTtlMs: joi_1.default.number().min(0).default(5000),
        maxConcurrentSimulations: joi_1.default.number().min(1).max(50).default(10),
        workerPoolSize: joi_1.default.number().min(1).max(20).default(4),
    }),
    security: joi_1.default.object({
        apiKeyHeader: joi_1.default.string().default('X-API-KEY'),
        apiKey: joi_1.default.string().min(32).required(),
        enableReplayProtection: joi_1.default.boolean().default(true),
        nonceManagerType: joi_1.default.string().valid('redis', 'memory', 'db').default('redis'),
    }),
    features: joi_1.default.object({
        enableTriangularArb: joi_1.default.boolean().default(true),
        enableCrossDexArb: joi_1.default.boolean().default(true),
        enableMevProtection: joi_1.default.boolean().default(true),
        enableSandwichProtection: joi_1.default.boolean().default(true),
    }),
    workers: joi_1.default.object({
        poolSize: joi_1.default.number().min(1).max(20).default(4),
    }),
});
// Parse environment variables into config object
const rawConfig = {
    network: {
        rpcUrl: process.env.RPC_URL_POLYGON,
        rpcUrlBackup: process.env.RPC_URL_POLYGON_BACKUP,
        chainId: parseInt(process.env.CHAIN_ID || '137'),
        blockPollingInterval: parseInt(process.env.BLOCK_POLLING_INTERVAL_MS || '100'),
    },
    wallet: {
        privateKey: process.env.PRIVATE_KEY_PLACEHOLDER,
        mnemonic: process.env.MNEMONIC_PLACEHOLDER,
        address: process.env.HOT_WALLET_ADDRESS,
    },
    providers: {
        infuraKey: process.env.INFURA_KEY,
        alchemyKey: process.env.ALCHEMY_KEY,
        quicknodeEndpoint: process.env.QUICKNODE_ENDPOINT,
    },
    gas: {
        strategy: process.env.GAS_PRICE_STRATEGY,
        maxGasGwei: parseFloat(process.env.MAX_GAS_GWEI || '500'),
        gasMultiplier: parseFloat(process.env.GAS_MULTIPLIER || '1.2'),
        maxPriorityFeeGwei: parseFloat(process.env.MAX_PRIORITY_FEE_GWEI || '50'),
        baseFeeMultiplier: parseFloat(process.env.BASE_FEE_MULTIPLIER || '2'),
        defaultGasLimit: parseInt(process.env.DEFAULT_GAS_LIMIT || '6000000'),
        profitThresholdMultiplier: parseInt(process.env.PROFIT_THRESHOLD_MULTIPLIER || '2'),
    },
    execution: {
        mode: process.env.EXECUTOR_MODE,
        slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50'),
        minProfitThresholdUsd: parseFloat(process.env.MIN_PROFIT_THRESHOLD_USD || '5'),
        maxTradeSizeUsd: parseFloat(process.env.MAX_TRADE_SIZE_USD || '10000'),
        tradeCapPerTx: parseFloat(process.env.TRADE_CAP_PER_TX || '5000'),
        maxPositionSizeUsd: parseFloat(process.env.MAX_POSITION_SIZE_USD || '50000'),
        txDeadlineSeconds: parseInt(process.env.TX_DEADLINE_SECONDS || '1200'),
    },
    flashloan: {
        enabled: process.env.ENABLE_FLASHLOANS === 'true',
        provider: process.env.FLASHLOAN_PROVIDER,
        maxFlashloanUsd: parseFloat(process.env.MAX_FLASHLOAN_USD || '100000'),
        flashloanFeeBps: parseFloat(process.env.FLASHLOAN_FEE_BPS || '9'),
    },
    dex: {
        enabledDexes: process.env.ENABLED_DEXES?.split(',') || ['quickswap'],
        quickswapRouter: process.env.QUICKSWAP_ROUTER,
        sushiswapRouter: process.env.SUSHISWAP_ROUTER,
        uniswapV3Router: process.env.UNISWAPV3_ROUTER,
    },
    database: {
        accountingDbUrl: process.env.ACCOUNTING_DB_URL,
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        poolSize: parseInt(process.env.DB_POOL_SIZE || '20'),
    },
    monitoring: {
        sentryDsn: process.env.SENTRY_DSN,
        prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9090'),
        healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT || '3000'),
        logLevel: process.env.LOG_LEVEL,
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
        maxConcurrentSimulations: parseInt(process.env.MAX_CONCURRENT_SIMULATIONS || '10'),
        workerPoolSize: parseInt(process.env.WORKER_POOL_SIZE || '4'),
    },
    security: {
        apiKeyHeader: process.env.API_KEY_HEADER || 'X-API-KEY',
        apiKey: process.env.API_KEY,
        enableReplayProtection: process.env.ENABLE_REPLAY_PROTECTION === 'true',
        nonceManagerType: process.env.NONCE_MANAGER_TYPE,
    },
    features: {
        enableTriangularArb: process.env.ENABLE_TRIANGULAR_ARB === 'true',
        enableCrossDexArb: process.env.ENABLE_CROSS_DEX_ARB === 'true',
        enableMevProtection: process.env.ENABLE_MEV_PROTECTION === 'true',
        enableSandwichProtection: process.env.ENABLE_SANDWICH_PROTECTION === 'true',
    },
    workers: {
        poolSize: parseInt(process.env.WORKER_POOL_SIZE || '4'),
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
exports.Config = validatedConfig;
exports.ADDRESSES = {
    WMATIC: '0x0d500B1d8E8eF31E21C99d1DbD9735AFf958023239c6A063',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    WBTC: '0x1bFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
    AAVE_LENDING_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    ROUTERS: {
        QUICKSWAP: validatedConfig.dex.quickswapRouter,
        SUSHISWAP: validatedConfig.dex.sushiswapRouter,
        UNISWAPV3: validatedConfig.dex.uniswapV3Router,
    },
};
exports.NETWORK = {
    POLYGON_CHAIN_ID: 137,
    BLOCK_TIME: 2000,
    MAX_BLOCK_RANGE: 2048,
    CONFIRMATION_BLOCKS: 3,
};
const isSimulationMode = () => {
    return exports.Config.execution.mode === 'simulate';
};
exports.isSimulationMode = isSimulationMode;
const isProduction = () => {
    return process.env.NODE_ENV === 'production' && exports.Config.execution.mode === 'live';
};
exports.isProduction = isProduction;
const validatePartialConfig = (partialConfig) => {
    const mergedConfig = { ...exports.Config, ...partialConfig };
    const { error } = configSchema.validate(mergedConfig);
    return !error;
};
exports.validatePartialConfig = validatePartialConfig;
const logConfig = () => {
    const sanitized = JSON.parse(JSON.stringify(exports.Config));
    // Remove sensitive fields
    if (sanitized.wallet.privateKey)
        sanitized.wallet.privateKey = '***HIDDEN***';
    if (sanitized.wallet.mnemonic)
        sanitized.wallet.mnemonic = '***HIDDEN***';
    if (sanitized.providers.infuraKey)
        sanitized.providers.infuraKey = '***HIDDEN***';
    if (sanitized.providers.alchemyKey)
        sanitized.providers.alchemyKey = '***HIDDEN***';
    if (sanitized.database.accountingDbUrl) {
        sanitized.database.accountingDbUrl = sanitized.database.accountingDbUrl.replace(/:\/\/[^@]+@/, '://***:***@');
    }
    if (sanitized.security.apiKey)
        sanitized.security.apiKey = '***HIDDEN***';
    if (sanitized.alerts.slackWebhookUrl)
        sanitized.alerts.slackWebhookUrl = '***HIDDEN***';
    console.log('Configuration loaded:', JSON.stringify(sanitized, null, 2));
};
exports.logConfig = logConfig;
//# sourceMappingURL=config.js.map