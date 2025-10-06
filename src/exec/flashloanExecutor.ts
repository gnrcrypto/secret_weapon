import { ethers } from 'ethers';
import { ADDRESSES, Config } from '../config';
import { provider } from '../providers/polygonProvider';
import { ArbitragePath } from '../arb/pathfinder';
import winston from 'winston';

// Balancer Flashloan Arbitrage Contract ABI
const FLASHLOAN_ABI = [
  "function executeArbitrage(address token, uint256 amount, bytes calldata params) external",
  "function simulateArbitrage(tuple(address[] path, address[] routers, uint256[] minAmountsOut, uint256 deadline) params, uint256 borrowAmount) external view returns (uint256)",
  "function owner() external view returns (address)",
  "function emergencyWithdraw(address token, uint256 amount) external",
];

export class FlashloanExecutor {
  private contract: ethers.Contract;
  private wallet: ethers.Wallet;

  constructor() {
    const currentProvider = provider.get();
    const privateKey = Config.wallet.privateKey;

    if (!privateKey) {
      throw new Error('Private key is required for flashloan executor');
    }

    this.wallet = new ethers.Wallet(privateKey, currentProvider);

    const contractAddress = process.env.FLASHLOAN_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error('FLASHLOAN_CONTRACT_ADDRESS not set in .env');
    }

    this.contract = new ethers.Contract(
      contractAddress,
      FLASHLOAN_ABI,
      this.wallet
    );
  }

  /**
   * Execute flashloan arbitrage
   */
  async executeArbitrage(
    path: ArbitragePath,
    amountIn: bigint,
    minAmountsOut: bigint[],
    deadline: number
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Prepare arbitrage parameters
      const params = {
        path: path.tokens.map(t => t.address),
        routers: path.dexes.map(dex => this.getRouterAddress(dex)),
        minAmountsOut: minAmountsOut,
        deadline: deadline,
      };

      // Encode parameters
      const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(address[] path, address[] routers, uint256[] minAmountsOut, uint256 deadline)'],
        [params]
      );

      // Get the first token (what we'll borrow)
      const borrowToken = path.tokens[0].address;

      winston.info('Executing flashloan arbitrage', {
        token: borrowToken,
        amount: amountIn.toString(),
        path: path.tokens.map(t => (t as any).symbol).join(' -> '),
        dexes: path.dexes.join(' -> '),
      });

      // Execute the flashloan
      const tx = await this.contract.executeArbitrage(
        borrowToken,
        amountIn,
        encodedParams,
        {
          gasLimit: BigInt(Config.gas.defaultGasLimit),
        }
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        return { success: false, error: 'Transaction failed' };
      }

      // Parse events to get profit
      const arbEvent = receipt.logs
        .map((log: any) => {
          try {
            return this.contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((event: any) => event?.name === 'ArbitrageExecuted');

      if (arbEvent) {
        winston.info('Arbitrage executed successfully', {
          profit: arbEvent.args.profit.toString(),
          txHash: receipt.hash,
        });
      }

      return { success: true, transactionHash: receipt.hash };

    } catch (error: any) {
      winston.error('Flashloan execution failed:', error);

      // Parse revert reason if available
      let errorMsg = String(error);
      if (error.data) {
        try {
          const decodedError = this.contract.interface.parseError(error.data);
          errorMsg = decodedError?.name || errorMsg;
        } catch { }
      }

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Simulate arbitrage before executing
   */
  async simulateArbitrage(
    path: ArbitragePath,
    amountIn: bigint,
    minAmountsOut: bigint[],
    deadline: number
  ): Promise<bigint> {
    try {
      const params = {
        path: path.tokens.map(t => t.address),
        routers: path.dexes.map(dex => this.getRouterAddress(dex)),
        minAmountsOut: minAmountsOut,
        deadline: deadline,
      };

      const expectedProfit = await this.contract.simulateArbitrage(params, amountIn);
      return expectedProfit;

    } catch (error) {
      winston.error('Simulation failed:', error);
      return BigInt(0);
    }
  }

  /**
   * Get router address for a DEX
   */
  private getRouterAddress(dex: string): string {
    const routers: Record<string, string> = {
      'quickswap': ADDRESSES.ROUTERS.QUICKSWAP,
      'sushiswap': ADDRESSES.ROUTERS.SUSHISWAP,
      'uniswapv3': ADDRESSES.ROUTERS.UNISWAPV3,
      'uniswap': ADDRESSES.ROUTERS.UNISWAPV3,
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
  async verifySetup(): Promise<boolean> {
    try {
      const owner = await this.contract.owner();
      const expectedOwner = this.wallet.address;

      if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
        winston.error('Contract owner mismatch', {
          contractOwner: owner,
          walletAddress: expectedOwner
        });
        return false;
      }

      winston.info('Flashloan contract verified', {
        address: await this.contract.getAddress(),
        owner: owner
      });

      return true;
    } catch (error) {
      winston.error('Failed to verify contract setup:', error);
      return false;
    }
  }

  /**
   * Emergency withdraw tokens from contract
   */
  async emergencyWithdraw(tokenAddress: string, amount: bigint): Promise<void> {
    try {
      const tx = await this.contract.emergencyWithdraw(tokenAddress, amount);
      await tx.wait();
      winston.info('Emergency withdrawal successful', { token: tokenAddress, amount: amount.toString() });
    } catch (error) {
      winston.error('Emergency withdrawal failed:', error);
      throw error;
    }
  }
}

export const flashloanExecutor = new FlashloanExecutor();
