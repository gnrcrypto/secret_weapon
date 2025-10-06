"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flashloanExecutor = exports.FlashloanExecutor = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const polygonProvider_1 = require("../providers/polygonProvider");
const winston_1 = __importDefault(require("winston"));
// Balancer Flashloan Arbitrage Contract ABI
const FLASHLOAN_ABI = [
    "function executeArbitrage(address token, uint256 amount, bytes calldata params) external",
    "function simulateArbitrage(tuple(address[] path, address[] routers, uint256[] minAmountsOut, uint256 deadline) params, uint256 borrowAmount) external view returns (uint256)",
    "function owner() external view returns (address)",
    "function emergencyWithdraw(address token, uint256 amount) external",
];
class FlashloanExecutor {
    contract;
    wallet;
    constructor() {
        const currentProvider = polygonProvider_1.provider.get();
        const privateKey = config_1.Config.wallet.privateKey;
        if (!privateKey) {
            throw new Error('Private key is required for flashloan executor');
        }
        this.wallet = new ethers_1.ethers.Wallet(privateKey, currentProvider);
        const contractAddress = process.env.FLASHLOAN_CONTRACT_ADDRESS;
        if (!contractAddress) {
            throw new Error('FLASHLOAN_CONTRACT_ADDRESS not set in .env');
        }
        this.contract = new ethers_1.ethers.Contract(contractAddress, FLASHLOAN_ABI, this.wallet);
    }
    /**
     * Execute flashloan arbitrage
     */
    async executeArbitrage(path, amountIn, minAmountsOut, deadline) {
        try {
            // Prepare arbitrage parameters
            const params = {
                path: path.tokens.map(t => t.address),
                routers: path.dexes.map(dex => this.getRouterAddress(dex)),
                minAmountsOut: minAmountsOut,
                deadline: deadline,
            };
            // Encode parameters
            const encodedParams = ethers_1.ethers.AbiCoder.defaultAbiCoder().encode(['tuple(address[] path, address[] routers, uint256[] minAmountsOut, uint256 deadline)'], [params]);
            // Get the first token (what we'll borrow)
            const borrowToken = path.tokens[0].address;
            winston_1.default.info('Executing flashloan arbitrage', {
                token: borrowToken,
                amount: amountIn.toString(),
                path: path.tokens.map(t => t.symbol).join(' -> '),
                dexes: path.dexes.join(' -> '),
            });
            // Execute the flashloan
            const tx = await this.contract.executeArbitrage(borrowToken, amountIn, encodedParams, {
                gasLimit: BigInt(config_1.Config.gas.defaultGasLimit),
            });
            const receipt = await tx.wait();
            if (!receipt || receipt.status !== 1) {
                return { success: false, error: 'Transaction failed' };
            }
            // Parse events to get profit
            const arbEvent = receipt.logs
                .map((log) => {
                try {
                    return this.contract.interface.parseLog(log);
                }
                catch {
                    return null;
                }
            })
                .find((event) => event?.name === 'ArbitrageExecuted');
            if (arbEvent) {
                winston_1.default.info('Arbitrage executed successfully', {
                    profit: arbEvent.args.profit.toString(),
                    txHash: receipt.hash,
                });
            }
            return { success: true, transactionHash: receipt.hash };
        }
        catch (error) {
            winston_1.default.error('Flashloan execution failed:', error);
            // Parse revert reason if available
            let errorMsg = String(error);
            if (error.data) {
                try {
                    const decodedError = this.contract.interface.parseError(error.data);
                    errorMsg = decodedError?.name || errorMsg;
                }
                catch { }
            }
            return { success: false, error: errorMsg };
        }
    }
    /**
     * Simulate arbitrage before executing
     */
    async simulateArbitrage(path, amountIn, minAmountsOut, deadline) {
        try {
            const params = {
                path: path.tokens.map(t => t.address),
                routers: path.dexes.map(dex => this.getRouterAddress(dex)),
                minAmountsOut: minAmountsOut,
                deadline: deadline,
            };
            const expectedProfit = await this.contract.simulateArbitrage(params, amountIn);
            return expectedProfit;
        }
        catch (error) {
            winston_1.default.error('Simulation failed:', error);
            return BigInt(0);
        }
    }
    /**
     * Get router address for a DEX
     */
    getRouterAddress(dex) {
        const routers = {
            'quickswap': config_1.Config.ADDRESSES.ROUTERS.QUICKSWAP,
            'sushiswap': config_1.Config.ADDRESSES.ROUTERS.SUSHISWAP,
            'uniswapv3': config_1.Config.ADDRESSES.ROUTERS.UNISWAP,
            'uniswap': config_1.Config.ADDRESSES.ROUTERS.UNISWAP,
        };
        const router = routers[dex.toLowerCase()];
        if (!router) {
            throw new Error(`Unknown DEX: ${dex}`);
        }
        return router;
    }
    /**
     * Check if contract is properly configured
     */
    async verifySetup() {
        try {
            const owner = await this.contract.owner();
            const expectedOwner = this.wallet.address;
            if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
                winston_1.default.error('Contract owner mismatch', {
                    contractOwner: owner,
                    walletAddress: expectedOwner
                });
                return false;
            }
            winston_1.default.info('Flashloan contract verified', {
                address: await this.contract.getAddress(),
                owner: owner
            });
            return true;
        }
        catch (error) {
            winston_1.default.error('Failed to verify contract setup:', error);
            return false;
        }
    }
    /**
     * Emergency withdraw tokens from contract
     */
    async emergencyWithdraw(tokenAddress, amount) {
        try {
            const tx = await this.contract.emergencyWithdraw(tokenAddress, amount);
            await tx.wait();
            winston_1.default.info('Emergency withdrawal successful', { token: tokenAddress, amount: amount.toString() });
        }
        catch (error) {
            winston_1.default.error('Emergency withdrawal failed:', error);
            throw error;
        }
    }
}
exports.FlashloanExecutor = FlashloanExecutor;
exports.flashloanExecutor = new FlashloanExecutor();
//# sourceMappingURL=flashloanExecutor.js.map