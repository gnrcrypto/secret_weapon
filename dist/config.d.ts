export declare const ADDRESSES: {
    readonly WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
    readonly USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    readonly USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
    readonly DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
    readonly WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
    readonly WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
    readonly BALANCER_VAULT: "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
    readonly AAVE_LENDING_POOL: "0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf";
    readonly ROUTERS: {
        readonly QUICKSWAP: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
        readonly SUSHISWAP: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
        readonly UNISWAP: "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    };
};
export declare const Config: {
    network: {
        rpcUrl: string;
        rpcUrlBackup: string | undefined;
        chainId: number;
        blockPollingInterval: number;
        supportsEIP1559: boolean;
    };
    wallet: {
        privateKey: string | undefined;
        mnemonic: string | undefined;
        address: string | undefined;
    };
    providers: {
        alchemyKey: string | undefined;
        infuraKey: string | undefined;
        quicknodeEndpoint: string | undefined;
    };
    dex: {
        enabledDexes: string[];
    };
    gas: {
        strategy: string;
        maxGasGwei: number;
        minGasGwei: number;
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
        minProfitUsd: number;
        minConfidence: number;
        maxTradeSizeUsd: number;
        tradeCapPerTx: number;
        maxPositionSizeUsd: number;
        txDeadlineSeconds: number;
        enableFlashLoanArbitrage: boolean;
    };
    flashLoans: {
        maxFlashLoanAmountUsd: number;
        minProfitThresholdUsd: number;
        providers: readonly ["aave", "balancer"];
        defaultProvider: "aave" | "balancer";
        safetyMargin: number;
    };
    risk: {
        dailyLossLimitUsd: number;
        maxConsecutiveFailures: number;
        circuitBreakerCooldownMs: number;
        maxGasPerBlock: number;
        maxExposurePerTrade: number;
        maxDailyExposure: number;
        maxSingleTokenExposure: Record<string, number>;
        maxDailyTrades: number;
        maxPriceImpact: number;
        maxSlippage: number;
        minConfidence: number;
    };
    monitoring: {
        sentryDsn: string | undefined;
        prometheusPort: number;
        healthCheckPort: number;
        logLevel: "debug" | "info" | "warn" | "error";
        performanceWindowDays: number;
        opportunityScanInterval: number;
    };
    database: {
        accountingDbUrl: string;
        redisUrl: string;
        poolSize: number;
    };
    performance: {
        priceCacheTtlMs: number;
        pathCacheTtlMs: number;
    };
    features: {
        enableTriangularArb: boolean;
        enableCrossDexArb: boolean;
        enableFlashLoans: boolean;
        enableMevProtection: boolean;
    };
    workers: {
        poolSize: number;
    };
    ADDRESSES: {
        readonly WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
        readonly USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
        readonly USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
        readonly DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
        readonly WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
        readonly WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
        readonly BALANCER_VAULT: "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
        readonly AAVE_LENDING_POOL: "0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf";
        readonly ROUTERS: {
            readonly QUICKSWAP: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
            readonly SUSHISWAP: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
            readonly UNISWAP: "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        };
    };
};
export default Config;
//# sourceMappingURL=config.d.ts.map