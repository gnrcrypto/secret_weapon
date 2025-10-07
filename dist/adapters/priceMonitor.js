"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.priceMonitor = exports.PriceMonitor = void 0;
const priceOracleAdapter_1 = require("../adapters/priceOracleAdapter");
const winston_1 = __importDefault(require("winston"));
const logger = winston_1.default.createLogger({
    level: 'info',
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'price-monitor' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
class PriceMonitor {
    alertThresholds = {
        stalePriceSeconds: 300, // 5 minutes
        deviationPercent: 10, // 10% deviation triggers alert
        minConfidence: 0.7,
    };
    /**
     * Run comprehensive price oracle health check
     */
    async runHealthCheck() {
        const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
        const issues = [];
        logger.info('Running price oracle health check...');
        // 1. Check Chainlink oracle health
        const oracleHealth = oracle.getOracleHealth();
        for (const [pair, health] of Object.entries(oracleHealth)) {
            if (!health.isHealthy) {
                issues.push(`Chainlink oracle ${pair} is unhealthy (age: ${health.age})`);
            }
            if (health.confidence < this.alertThresholds.minConfidence) {
                issues.push(`${pair} confidence too low: ${health.confidence}`);
            }
        }
        // 2. Check critical token prices
        const criticalTokens = ['WMATIC', 'USDC', 'WETH'];
        for (const token of criticalTokens) {
            try {
                const price = await oracle.getTokenPriceUSD(token);
                if (!price) {
                    issues.push(`Failed to get price for ${token}`);
                }
                else {
                    logger.info(`${token} price: $${price.toFixed(4)}`);
                }
            }
            catch (error) {
                issues.push(`Error fetching ${token} price: ${error}`);
            }
        }
        // 3. Check cache performance
        const cacheStats = oracle.getCacheStats();
        logger.info('Cache stats:', cacheStats);
        // 4. Validate price consistency
        try {
            const maticPrice = await oracle.getTokenPriceUSD('WMATIC');
            const maticPriceViaEth = await oracle.getPrice('WMATIC', 'WETH');
            if (maticPrice && maticPriceViaEth) {
                const ethPrice = await oracle.getTokenPriceUSD('WETH');
                if (ethPrice) {
                    const derivedMaticPrice = maticPriceViaEth.price * ethPrice;
                    const deviation = Math.abs((maticPrice - derivedMaticPrice) / maticPrice * 100);
                    if (deviation > this.alertThresholds.deviationPercent) {
                        issues.push(`MATIC price inconsistency: ${deviation.toFixed(2)}% deviation`);
                    }
                }
            }
        }
        catch (error) {
            issues.push(`Price consistency check failed: ${error}`);
        }
        const isHealthy = issues.length === 0;
        if (!isHealthy) {
            logger.error('Price oracle health check FAILED:', issues);
        }
        else {
            logger.info('✅ Price oracle health check PASSED');
        }
        return {
            isHealthy,
            issues,
            stats: {
                oracleHealth,
                cacheStats,
            },
        };
    }
    /**
     * Test price fetching performance
     */
    async testPerformance() {
        const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
        const testTokens = ['WMATIC', 'USDC', 'WETH', 'WBTC'];
        const latencies = [];
        let successCount = 0;
        logger.info('Testing price oracle performance...');
        for (const token of testTokens) {
            const startTime = Date.now();
            try {
                await oracle.getTokenPriceUSD(token);
                const latency = Date.now() - startTime;
                latencies.push(latency);
                successCount++;
                logger.info(`${token} fetch latency: ${latency}ms`);
            }
            catch (error) {
                logger.error(`Failed to fetch ${token}:`, error);
            }
        }
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        const successRate = (successCount / testTokens.length) * 100;
        logger.info(`Performance: avg=${avgLatency.toFixed(0)}ms, max=${maxLatency}ms, success=${successRate.toFixed(0)}%`);
        return {
            avgLatency,
            maxLatency,
            successRate,
        };
    }
    /**
     * Compare Chainlink vs DEX prices
     */
    async comparePriceSources() {
        const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
        const comparison = {};
        const tokens = [
            { symbol: 'WMATIC', chainlinkPair: 'MATIC/USD' },
            { symbol: 'WETH', chainlinkPair: 'ETH/USD' },
        ];
        for (const { symbol, chainlinkPair } of tokens) {
            try {
                const chainlinkData = await oracle.getChainlinkPrice(chainlinkPair);
                const dexData = await oracle.getDexPrice(symbol === 'WMATIC' ? '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' : '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' // USDC
                );
                if (chainlinkData && dexData) {
                    const deviation = Math.abs((chainlinkData.price - dexData.price) / chainlinkData.price * 100);
                    comparison[symbol] = {
                        chainlink: {
                            price: chainlinkData.price,
                            confidence: chainlinkData.confidence,
                            age: Date.now() - chainlinkData.timestamp,
                        },
                        dex: {
                            price: dexData.price,
                            confidence: dexData.confidence,
                        },
                        deviation: `${deviation.toFixed(2)}%`,
                        recommended: deviation < 2 ? 'chainlink' : 'aggregated',
                    };
                }
            }
            catch (error) {
                logger.error(`Failed to compare prices for ${symbol}:`, error);
            }
        }
        return comparison;
    }
    /**
     * Monitor price updates in real-time
     */
    startRealtimeMonitoring(intervalMs = 10000) {
        logger.info(`Starting real-time price monitoring (interval: ${intervalMs}ms)`);
        return setInterval(async () => {
            try {
                const oracle = (0, priceOracleAdapter_1.getPriceOracle)();
                const maticPrice = await oracle.getTokenPriceUSD('WMATIC');
                const ethPrice = await oracle.getTokenPriceUSD('WETH');
                logger.info('Real-time prices:', {
                    MATIC: maticPrice ? `$${maticPrice.toFixed(4)}` : 'N/A',
                    ETH: ethPrice ? `$${ethPrice.toFixed(2)}` : 'N/A',
                    timestamp: new Date().toISOString(),
                });
            }
            catch (error) {
                logger.error('Real-time monitoring error:', error);
            }
        }, intervalMs);
    }
}
exports.PriceMonitor = PriceMonitor;
exports.priceMonitor = new PriceMonitor();
// CLI interface for testing
if (require.main === module) {
    (async () => {
        logger.info('🔍 Price Oracle Diagnostic Tool\n');
        // 1. Health check
        const health = await exports.priceMonitor.runHealthCheck();
        console.log('\n📊 Health Check Result:');
        console.log(`Status: ${health.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
        if (health.issues.length > 0) {
            console.log('Issues:', health.issues);
        }
        // 2. Performance test
        console.log('\n⚡ Performance Test:');
        const perf = await exports.priceMonitor.testPerformance();
        console.log(`Average Latency: ${perf.avgLatency.toFixed(0)}ms`);
        console.log(`Max Latency: ${perf.maxLatency}ms`);
        console.log(`Success Rate: ${perf.successRate.toFixed(0)}%`);
        // 3. Price source comparison
        console.log('\n🔄 Price Source Comparison:');
        const comparison = await exports.priceMonitor.comparePriceSources();
        console.log(JSON.stringify(comparison, null, 2));
        process.exit(0);
    })();
}
//# sourceMappingURL=priceMonitor.js.map