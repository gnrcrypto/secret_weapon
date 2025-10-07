export type DexName = 'quickswap' | 'sushiswap' | 'uniswapv3';
declare const rawConfig: {
    network: {
        rpcUrl: string;
        rpcUrlBackup: string | undefined;
        chainId: number;
        blockPollingInterval: number;
    };
    wallet: {
        privateKey: string | undefined;
        mnemonic: string | undefined;
        address: string | undefined;
    };
    providers: {
        infuraKey: string | undefined;
        alchemyKey: string | undefined;
        quicknodeEndpoint: string | undefined;
    };
    gas: {
        strategy: "conservative" | "standard" | "aggressive";
        maxGasGwei: number;
        gasMultiplier: number;
        maxPriorityFeeGwei: number;
        baseFeeMultiplier: number;
        defaultGasLimit: number;
        profitThresholdMultiplier: number;
    };
    execution: {
        mode: "simulate" | "live";
        slippageBps: number;
        minProfitThresholdUsd: number;
        maxTradeSizeUsd: number;
        tradeCapPerTx: number;
        maxPositionSizeUsd: number;
        txDeadlineSeconds: number;
    };
    flashloan: {
        enabled: boolean;
        provider: "aave" | "balancer" | "dodo";
        maxFlashloanUsd: number;
        flashloanFeeBps: number;
    };
    dex: {
        enabledDexes: DexName[];
        quickswapRouter: string;
        sushiswapRouter: string;
        uniswapV3Router: string;
    };
    database: {
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
        accountingDbUrl: string;
        redisUrl: string;
        poolSize: number;
    };
    monitoring: {
        sentryDsn: string | undefined;
        prometheusPort: number;
        healthCheckPort: number;
        logLevel: "debug" | "info" | "warn" | "error";
        opportunityScanInterval: number;
    };
    alerts: {
        slackWebhookUrl: string | undefined;
        minProfitAlertUsd: number;
        maxLossAlertUsd: number;
    };
    risk: {
        dailyLossLimitUsd: number;
        maxConsecutiveFailures: number;
        circuitBreakerCooldownMs: number;
        maxGasPerBlock: number;
        maxExposurePerTrade: number;
        maxDailyExposure: number;
        maxSingleTokenExposure: {};
        maxDailyTrades: number;
        maxPriceImpact: number;
        maxSlippage: number;
        minConfidence: number;
    };
    performance: {
        priceCacheTtlMs: number;
        pathCacheTtlMs: number;
        maxConcurrentSimulations: number;
        workerPoolSize: number;
    };
    security: {
        apiKeyHeader: string;
        apiKey: string;
        enableReplayProtection: boolean;
        nonceManagerType: "redis" | "memory" | "db";
    };
    features: {
        enableTriangularArb: boolean;
        enableCrossDexArb: boolean;
        enableMevProtection: boolean;
        enableSandwichProtection: boolean;
    };
    workers: {
        poolSize: number;
    };
};
export declare const Config: typeof rawConfig;
export declare const ADDRESSES: {
    readonly WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
    readonly USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    readonly USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
    readonly DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
    readonly WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
    readonly WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
    readonly AAVE_LENDING_POOL: "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
    readonly BALANCER_VAULT: "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
    readonly ROUTERS: {
        readonly QUICKSWAP: any;
        readonly SUSHISWAP: any;
        readonly UNISWAPV3: any;
    };
};
export declare const NETWORK: {
    readonly POLYGON_CHAIN_ID: 137;
    readonly BLOCK_TIME: 2000;
    readonly MAX_BLOCK_RANGE: 2048;
    readonly CONFIRMATION_BLOCKS: 3;
};
export declare const isSimulationMode: () => boolean;
export declare const isProduction: () => boolean;
export declare const validatePartialConfig: (partialConfig: Partial<typeof rawConfig>) => boolean;
export declare const logConfig: () => void;
export declare const getDatabaseConnectionConfig: () => {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    url: string;
};
export {};
//# sourceMappingURL=config.d.ts.map