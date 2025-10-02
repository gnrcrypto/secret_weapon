# Polygon Arbitrage Bot

A production-grade arbitrage bot for the Polygon network with flashloan support, designed to identify and execute profitable arbitrage opportunities across multiple DEXs.

⚠️ **DISCLAIMER**: This software is for educational purposes. Trading cryptocurrencies carries significant risk. Never trade with funds you cannot afford to lose.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Market Data    │────▶│   Opportunity   │────▶│   Execution     │
│   Collection    │     │    Detection    │     │     Engine      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                        │
         ▼                       ▼                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Price Oracle   │     │   Simulator     │     │  Risk Manager   │
│    Adapters     │     │    & Strategy   │     │  & Circuit      │
└─────────────────┘     └─────────────────┘     │    Breakers     │
                                                 └─────────────────┘
                        ┌─────────────────┐
                        │   Monitoring    │
                        │   & Alerting    │
                        └─────────────────┘
```

## Features

- **Multi-DEX Support**: QuickSwap, SushiSwap, UniswapV3, Balancer
- **Flashloan Integration**: Aave, Balancer, DODO flashloans for capital efficiency
- **Advanced Risk Management**: Circuit breakers, position limits, daily loss limits
- **High Performance**: WebSocket providers, concurrent simulations, optimized gas strategies
- **Production Ready**: Comprehensive logging, monitoring, alerting, and database persistence
- **Safety First**: Simulation mode, gradual rollout, emergency stops

## Prerequisites

- Node.js v18+ and npm v9+
- PostgreSQL database
- Redis server
- Polygon RPC endpoints (Alchemy/Infura/QuickNode)
- Minimum 10 MATIC for gas (production)
- Private key or mnemonic for hot wallet

## Installation

1. Clone the repository:
```bash
git clone https://github.com/gnrcrypto/secret_weapon/
cd secret_weapon
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Set up the database:
```bash
# Create PostgreSQL database
createdb arbitrage

# Run migrations (when implemented)
npm run db:migrate
```

5. Build the project:
```bash
npm run build
```

## Configuration

### Essential Environment Variables

- `RPC_URL_POLYGON`: Primary Polygon RPC endpoint
- `PRIVATE_KEY_PLACEHOLDER`: Your wallet private key (never commit!)
- `EXECUTOR_MODE`: Set to `simulate` for testing, `live` for production
- `ACCOUNTING_DB_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string

### Risk Parameters

- `MIN_PROFIT_THRESHOLD_USD`: Minimum profit to execute trade (default: $5)
- `MAX_TRADE_SIZE_USD`: Maximum size per trade (default: $10,000)
- `DAILY_LOSS_LIMIT_USD`: Stop trading after this loss (default: $500)
- `SLIPPAGE_BPS`: Allowed slippage in basis points (default: 50 = 0.5%)

## Usage

### Development Mode
```bash
npm run dev
```

### Simulation Mode (Recommended First)
```bash
npm run start:sim
```

### Production Mode
```bash
npm start
```

### Running Tests
```bash
npm test
npm run test:watch  # Watch mode
```

## Project Structure

```
polygon-arbitrage-bot/
├── src/
│   ├── config.ts           # Configuration management
│   ├── providers/          # Blockchain providers
│   ├── adapters/           # DEX and oracle adapters
│   ├── arb/               # Arbitrage logic
│   ├── exec/              # Transaction execution
│   ├── risk/              # Risk management
│   ├── services/          # Core services
│   ├── db/                # Database entities
│   ├── utils/             # Utility functions
│   ├── monitoring/        # Metrics and monitoring
│   ├── api/               # HTTP endpoints
│   └── index.ts           # Main entry point
├── tests/                 # Test files
├── logs/                  # Log files
├── docs/                  # Documentation
└── scripts/              # Utility scripts
```

## Safety Checklist

Before going live:

- [ ] Run extensive simulations (minimum 1 week)
- [ ] Test with small amounts first
- [ ] Configure circuit breakers and limits
- [ ] Set up monitoring and alerts
- [ ] Review gas price strategies
- [ ] Test emergency stop procedures
- [ ] Backup wallet keys securely
- [ ] Document runbook for operations
- [ ] Set up on-call rotation

## Emergency Procedures

### Emergency Stop
```bash
curl -X POST http://localhost:3000/pause \
  -H "X-API-KEY: your_api_key"
```

### Resume Operations
```bash
curl -X POST http://localhost:3000/resume \
  -H "X-API-KEY: your_api_key"
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Monitoring

The bot exposes Prometheus metrics on port 9090:
- `opportunities_found_total`: Total arbitrage opportunities detected
- `trades_executed_total`: Total successful trades
- `failed_trades_total`: Failed trade attempts  
- `total_profit_usd`: Cumulative profit in USD
- `gas_spent_wei`: Total gas consumed

## Security Considerations

1. **Never commit private keys or mnemonics**
2. Use a dedicated hot wallet with limited funds
3. Implement IP whitelisting for API endpoints
4. Use hardware wallets or HSM for production
5. Regular security audits of dependencies
6. Monitor for unusual activity patterns
7. Implement rate limiting on all endpoints
8. Use encrypted connections for database

## Common Issues

### "Insufficient balance for live trading"
- Ensure wallet has minimum 10 MATIC
- Check wallet address matches configuration

### "All providers are unhealthy"
- Verify RPC endpoints are accessible
- Check API keys are valid
- Review network connectivity

### High gas consumption
- Adjust `GAS_PRICE_STRATEGY` to "conservative"
- Reduce `MAX_CONCURRENT_SIMULATIONS`
- Increase `MIN_PROFIT_THRESHOLD_USD`

## Development Roadmap

- [ ] Core arbitrage engine
- [ ] Flashloan integration
- [ ] MEV protection
- [ ] Cross-chain arbitrage
- [ ] Machine learning optimization
- [ ] Advanced orderbook integration
- [ ] Automated strategy backtesting

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct and the process for submitting pull requests.

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/your-repo/issues)
- Documentation: [Read the docs](./docs)

## Acknowledgments

- Ethers.js team for the excellent Web3 library
- Polygon team for the scalable blockchain
- DEX protocols for providing liquidity

---

⚡ Built with focus on performance, safety, and profitability
