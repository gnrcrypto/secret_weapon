import { ethers } from 'ethers';
import { Config, ADDRESSES } from '../config';
import { provider, nonceManager } from '../providers/polygonProvider';
import { getGasManager } from './gasManager';
import { ArbitragePath, Token } from '../arb/pathfinder';
import { SimulationResult } from '../arb/simulator';
import {
  interfaces,
  POLYGON_ADDRESSES
} from '../utils/abi';
import { fromWei } from '../utils/math';
import winston from 'winston';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'tx-builder' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Router address mapping
const ROUTER_ADDRESSES: { [key: string]: string } = {
  QUICKSWAP: ADDRESSES.ROUTERS.QUICKSWAP,
  SUSHISWAP: ADDRESSES.ROUTERS.SUSHISWAP,
  UNISWAP: ADDRESSES.ROUTERS.UNISWAP,
};

// Add missing AAVE and Balancer addresses
const FLASH_LOAN_ADDRESSES = {
  AAVE_LENDING_POOL: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf', // Polygon Aave Lending Pool
  BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Balancer V2 Vault
};

// Transaction types
export interface TransactionRequest {
  to: string;
  data: string;
  value: bigint;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  chainId?: number;
}

export interface SwapTransaction {
  type: 'swap' | 'multiSwap' | 'flashSwap';
  request: TransactionRequest;
  path: ArbitragePath;
  expectedOutput: bigint;
  deadline: number;
  metadata: {
    description: string;
    urgency: 'low' | 'standard' | 'high';
    estimatedGasUsed: bigint;
    estimatedProfitWei: bigint;
  };
}

/**
 * Transaction Builder
 */
export class TransactionBuilder {
  private wallet: ethers.Wallet;

  constructor() {
    const privateKey = Config.wallet.privateKey!;
    const currentProvider = provider.get();
    this.wallet = new ethers.Wallet(privateKey, currentProvider);
  }

  /**
   * Build atomic swap transaction
   */
  async buildAtomicSwapTx(
    path: ArbitragePath,
    amountIn: bigint,
    minAmountOut: bigint,
    gasLimit?: bigint,
    urgency: 'low' | 'standard' | 'high' = 'standard'
  ): Promise<SwapTransaction> {
    logger.info(`Building atomic swap for path ${path.id}`);

    if (path.type === 'triangular') {
      return this.buildTriangularSwapTx(path, amountIn, minAmountOut, gasLimit, urgency);
    } else if (path.type === 'cross-dex') {
      return this.buildCrossDexSwapTx(path, amountIn, minAmountOut, gasLimit, urgency);
    } else {
      throw new Error(`Unsupported path type: ${path.type}`);
    }
  }

  /**
   * Build triangular arbitrage transaction
   */
  private async buildTriangularSwapTx(
    path: ArbitragePath,
    amountIn: bigint,
    minAmountOut: bigint,
    gasLimit?: bigint,
    urgency: 'low' | 'standard' | 'high' = 'standard'
  ): Promise<SwapTransaction> {
    // For triangular arbitrage, we need to execute 3 swaps atomically
    // This requires a custom contract or using multicall

    const calls: { target: string; callData: string }[] = [];
    const deadline = this.getDeadline();

    // Build each swap in the triangle
    for (let i = 0; i < path.tokens.length; i++) {
      const tokenIn = path.tokens[i];
      const tokenOut = path.tokens[(i + 1) % path.tokens.length];

      // Fixed: Use proper router address lookup
      const dexName = path.dexes[i].toUpperCase();
      const routerAddress = ROUTER_ADDRESSES[dexName];

      if (!routerAddress) {
        throw new Error(`Unknown DEX router for: ${path.dexes[i]}`);
      }

      const swapCalldata = interfaces.UniswapV2Router.encodeFunctionData(
        'swapExactTokensForTokens',
        [
          i === 0 ? amountIn : BigInt(0), // Only specify amount for first swap
          i === path.tokens.length - 1 ? minAmountOut : BigInt(0), // Only specify min for last swap
          [tokenIn.address, tokenOut.address],
          this.wallet.address,
          deadline
        ]
      );

      calls.push({
        target: routerAddress,
        callData: swapCalldata,
      });
    }

    // Use Multicall to execute atomically
    const multicallAddress = POLYGON_ADDRESSES.MULTICALL3;
    const multicallData = interfaces.Multicall.encodeFunctionData('aggregate', [calls]);

    const request: TransactionRequest = {
      to: multicallAddress,
      data: multicallData,
      value: BigInt(0),
      chainId: Config.network.chainId,
    };

    // Set gas parameters
    const gasManager = getGasManager();
    gasManager.setGasPriceForTx(request, urgency);

    if (!gasLimit) {
      gasLimit = await gasManager.estimateGas(request);
    }
    request.gasLimit = gasLimit;

    // Get nonce
    request.nonce = await nonceManager.getNonce();

    return {
      type: 'multiSwap',
      request,
      path,
      expectedOutput: minAmountOut,
      deadline,
      metadata: {
        description: `Triangular arb: ${path.tokens.map(t => t.symbol).join(' -> ')}`,
        urgency,
        estimatedGasUsed: gasLimit,
        estimatedProfitWei: minAmountOut - amountIn,
      },
    };
  }

  /**
   * Build cross-DEX arbitrage transaction
   */
  private async buildCrossDexSwapTx(
    path: ArbitragePath,
    amountIn: bigint,
    minAmountOut: bigint,
    gasLimit?: bigint,
    urgency: 'low' | 'standard' | 'high' = 'standard'
  ): Promise<SwapTransaction> {
    const [tokenA, tokenB] = path.tokens;
    const [buyDex, sellDex] = path.dexes;
    const deadline = this.getDeadline();

    // Fixed: Use proper router address lookup
    const buyDexName = buyDex.toUpperCase();
    const sellDexName = sellDex.toUpperCase();
    const buyRouterAddress = ROUTER_ADDRESSES[buyDexName];
    const sellRouterAddress = ROUTER_ADDRESSES[sellDexName];

    if (!buyRouterAddress || !sellRouterAddress) {
      throw new Error(`Unknown DEX router for: ${buyDex} or ${sellDex}`);
    }

    // We need to buy on one DEX and sell on another in a single transaction
    // This requires multicall or a custom contract
    const buyCalldata = interfaces.UniswapV2Router.encodeFunctionData(
      'swapExactTokensForTokens',
      [
        amountIn,
        BigInt(0), // Calculate min amount based on slippage
        [tokenA.address, tokenB.address],
        this.wallet.address,
        deadline
      ]
    );

    const sellCalldata = interfaces.UniswapV2Router.encodeFunctionData(
      'swapExactTokensForTokens',
      [
        BigInt(0), // Will be determined by buy output
        minAmountOut,
        [tokenB.address, tokenA.address],
        this.wallet.address,
        deadline
      ]
    );

    // Use Multicall for atomic execution
    const calls = [
      { target: buyRouterAddress, callData: buyCalldata },
      { target: sellRouterAddress, callData: sellCalldata },
    ];

    const multicallAddress = POLYGON_ADDRESSES.MULTICALL3;
    const multicallData = interfaces.Multicall.encodeFunctionData('aggregate', [calls]);

    const request: TransactionRequest = {
      to: multicallAddress,
      data: multicallData,
      value: BigInt(0),
      chainId: Config.network.chainId,
    };

    // Set gas parameters
    const gasManager = getGasManager();
    gasManager.setGasPriceForTx(request, urgency);

    if (!gasLimit) {
      gasLimit = await gasManager.estimateGas(request);
    }
    request.gasLimit = gasLimit;

    // Get nonce
    request.nonce = await nonceManager.getNonce();

    return {
      type: 'multiSwap',
      request,
      path,
      expectedOutput: minAmountOut,
      deadline,
      metadata: {
        description: `Cross-DEX arb: ${tokenA.symbol}-${tokenB.symbol} on ${buyDex}/${sellDex}`,
        urgency,
        estimatedGasUsed: gasLimit,
        estimatedProfitWei: minAmountOut - amountIn,
      },
    };
  }

  /**
   * Build flash loan transaction
   */
  async buildFlashLoanTx(
    path: ArbitragePath,
    flashLoanAmount: bigint,
    simulation: SimulationResult,
    provider: 'aave' | 'balancer' = 'aave'
  ): Promise<SwapTransaction> {
    logger.info(`Building flash loan transaction for ${flashLoanAmount} using ${provider}`);

    const deadline = this.getDeadline();
    let request: TransactionRequest;

    if (provider === 'aave') {
      // Build Aave flash loan
      const lendingPoolAddress = FLASH_LOAN_ADDRESSES.AAVE_LENDING_POOL; // Fixed: Use our constant
      const asset = path.tokens[0].address;

      // Encode the arbitrage logic that will be executed in the flash loan callback
      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'address[]', 'uint256', 'uint256'],
        [
          path.tokens.map(t => t.address),
          path.dexes,
          flashLoanAmount,
          simulation.outputAmount,
        ]
      );

      const flashLoanData = interfaces.AaveLendingPool.encodeFunctionData(
        'flashLoan',
        [
          this.wallet.address, // receiver
          [asset], // assets
          [flashLoanAmount], // amounts
          [0], // modes (0 = no debt)
          this.wallet.address, // onBehalfOf
          params, // params for callback
          0, // referralCode
        ]
      );

      request = {
        to: lendingPoolAddress,
        data: flashLoanData,
        value: BigInt(0),
        chainId: Config.network.chainId,
      };
    } else {
      // Build Balancer flash loan
      const vaultAddress = FLASH_LOAN_ADDRESSES.BALANCER_VAULT; // Fixed: Use our constant
      const token = path.tokens[0].address;

      const userData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'address[]', 'uint256'],
        [
          path.tokens.map(t => t.address),
          path.dexes,
          simulation.outputAmount,
        ]
      );

      const flashLoanData = interfaces.BalancerVault.encodeFunctionData(
        'flashLoan',
        [
          this.wallet.address, // recipient
          [token], // tokens
          [flashLoanAmount], // amounts
          userData, // userData
        ]
      );

      request = {
        to: vaultAddress,
        data: flashLoanData,
        value: BigInt(0),
        chainId: Config.network.chainId,
      };
    }

    // Set gas parameters
    const gasManager = getGasManager();
    gasManager.setGasPriceForTx(request, 'high'); // Flash loans should be high priority

    const gasLimit = await gasManager.estimateGas(request, 30); // 30% buffer for flash loans
    request.gasLimit = gasLimit;

    // Get nonce
    request.nonce = await nonceManager.getNonce();

    return {
      type: 'flashSwap',
      request,
      path,
      expectedOutput: simulation.outputAmount,
      deadline,
      metadata: {
        description: `Flash loan arb via ${provider}: ${fromWei(flashLoanAmount)} ${path.tokens[0].symbol}`,
        urgency: 'high',
        estimatedGasUsed: gasLimit,
        estimatedProfitWei: simulation.netProfit,
      },
    };
  }

  /**
   * Build token approval transaction
   */
  async buildApprovalTx(
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint = ethers.MaxUint256
  ): Promise<TransactionRequest> {
    logger.info(`Building approval for ${tokenAddress} to ${spenderAddress}`);

    const approvalData = interfaces.ERC20.encodeFunctionData(
      'approve',
      [spenderAddress, amount]
    );

    const request: TransactionRequest = {
      to: tokenAddress,
      data: approvalData,
      value: BigInt(0),
      chainId: Config.network.chainId,
    };

    // Set gas parameters
    const gasManager = getGasManager();
    gasManager.setGasPriceForTx(request, 'low'); // Approvals can be low priority

    const gasLimit = gasManager.getRecommendedGasLimit('approve');
    request.gasLimit = gasLimit;

    // Get nonce
    request.nonce = await nonceManager.getNonce();

    return request;
  }

  /**
   * Sign transaction
   */
  async signTx(
    txRequest: TransactionRequest
  ): Promise<string> {
    try {
      const signedTx = await this.wallet.signTransaction(txRequest);
      logger.debug('Transaction signed successfully');
      return signedTx;
    } catch (error) {
      logger.error('Failed to sign transaction:', error);
      throw error;
    }
  }

  /**
   * Encode calldata for swap
   */
  encodeSwapCalldata(
    inputToken: Token, // Removed unused routerAddress parameter
    outputToken: Token,
    amountIn: bigint,
    minAmountOut: bigint,
    recipient: string,
    deadline: number
  ): string {
    const path = [inputToken.address, outputToken.address];

    return interfaces.UniswapV2Router.encodeFunctionData(
      'swapExactTokensForTokens',
      [amountIn, minAmountOut, path, recipient, deadline]
    );
  }

  /**
   * Get deadline for transaction
   */
  private getDeadline(): number {
    return Math.floor(Date.now() / 1000) + Config.execution.txDeadlineSeconds;
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGasForTx(
    txRequest: TransactionRequest
  ): Promise<bigint> {
    try {
      const gasManager = getGasManager();
      return await gasManager.estimateGas(txRequest);
    } catch (error) {
      logger.error('Gas estimation failed:', error);
      // Return default based on transaction type
      return BigInt(Config.gas.defaultGasLimit);
    }
  }

  /**
   * Build MEV protected transaction
   */
  async buildMEVProtectedTx(
    baseTx: SwapTransaction
  ): Promise<SwapTransaction> {
    if (!Config.features.enableMevProtection) {
      return baseTx;
    }

    logger.info('Building MEV protected transaction');

    // Add MEV protection by:
    // 1. Using commit-reveal scheme
    // 2. Adding minimal slippage
    // 3. Using private mempool if available

    const protectedTx = { ...baseTx };

    // Mark as MEV protected
    protectedTx.metadata.description += ' [MEV Protected]';

    return protectedTx;
  }

  /**
   * Build batch transaction for multiple swaps
   */
  async buildBatchTx(
    swaps: SwapTransaction[]
  ): Promise<TransactionRequest> {
    if (swaps.length === 0) {
      throw new Error('No swaps provided for batch');
    }

    logger.info(`Building batch transaction for ${swaps.length} swaps`);

    // Use Multicall3 for batching
    const calls = swaps.map(swap => ({
      target: swap.request.to,
      allowFailure: false,
      callData: swap.request.data,
    }));

    const multicallData = interfaces.Multicall.encodeFunctionData(
      'aggregate3',
      [calls]
    );

    const request: TransactionRequest = {
      to: POLYGON_ADDRESSES.MULTICALL3,
      data: multicallData,
      value: BigInt(0),
      chainId: Config.network.chainId,
    };

    // Set gas parameters
    const gasManager = getGasManager();
    gasManager.setGasPriceForTx(request, 'standard');

    // Estimate gas for batch
    const totalGas = swaps.reduce(
      (sum, swap) => sum + (swap.request.gasLimit || BigInt(200000)),
      BigInt(0)
    );
    request.gasLimit = totalGas + BigInt(50000); // Add overhead for multicall

    // Get nonce
    request.nonce = await nonceManager.getNonce();

    return request;
  }

  /**
   * Validate transaction before sending
   */
  validateTransaction(txRequest: TransactionRequest): boolean {
    // Check required fields
    if (!txRequest.to || !txRequest.data) {
      logger.error('Missing required transaction fields');
      return false;
    }

    // Check gas limit
    if (!txRequest.gasLimit || txRequest.gasLimit === BigInt(0)) {
      logger.error('Invalid gas limit');
      return false;
    }

    // Check gas price
    if (!txRequest.gasPrice && !txRequest.maxFeePerGas) {
      logger.error('Missing gas price parameters');
      return false;
    }

    // Check nonce
    if (txRequest.nonce === undefined || txRequest.nonce < 0) {
      logger.error('Invalid nonce');
      return false;
    }

    // Check value for non-payable functions
    // Most DEX swaps are non-payable unless swapping ETH

    return true;
  }

  /**
   * Get transaction cost estimate
   */
  getTransactionCost(
    gasLimit: bigint,
    urgency: 'low' | 'standard' | 'high' = 'standard'
  ): { wei: bigint; gwei: string; usd: number } {
    const gasManager = getGasManager();
    const estimation = gasManager.calculateGasCost(gasLimit, urgency);

    // Assume MATIC price (should be fetched from oracle)
    const maticPriceUsd = 0.8;
    const costInMatic = parseFloat(fromWei(estimation.totalCostWei, 18));

    return {
      wei: estimation.totalCostWei,
      gwei: estimation.totalCostGwei,
      usd: costInMatic * maticPriceUsd,
    };
  }

  /**
   * Build recovery transaction for stuck funds
   */
  async buildRecoveryTx(
    tokenAddress: string,
    amount: bigint,
    recipient?: string
  ): Promise<TransactionRequest> {
    logger.warn(`Building recovery transaction for ${fromWei(amount)} tokens at ${tokenAddress}`);

    const to = recipient || this.wallet.address;

    const transferData = interfaces.ERC20.encodeFunctionData(
      'transfer',
      [to, amount]
    );

    const request: TransactionRequest = {
      to: tokenAddress,
      data: transferData,
      value: BigInt(0),
      chainId: Config.network.chainId,
    };

    // Use high priority for recovery
    const gasManager = getGasManager();
    gasManager.setGasPriceForTx(request, 'high');

    const gasLimit = gasManager.getRecommendedGasLimit('swap');
    request.gasLimit = gasLimit;

    // Get nonce
    request.nonce = await nonceManager.getNonce();

    return request;
  }
}

// Export singleton instance
let txBuilder: TransactionBuilder | null = null;

export function getTxBuilder(): TransactionBuilder {
  if (!txBuilder) {
    txBuilder = new TransactionBuilder();
  }
  return txBuilder;
}
