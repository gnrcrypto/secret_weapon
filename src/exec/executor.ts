import { ethers, TransactionReceipt } from 'ethers';
import { Config, isSimulationMode } from '../config';
import { provider, nonceManager, waitForTransaction } from '../providers/polygonProvider';
import { getTxBuilder, SwapTransaction, TransactionRequest } from './txBuilder';
import { getGasManager } from './gasManager';
import { RankedOpportunity } from '../arb/strategy';
import { fromWei } from '../utils/math';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

// Logger setup
const logger = winston.createLogger({
  level: Config.monitoring.logLevel,
  format: winston.format.json(),
  defaultMeta: { service: 'executor' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Execution result
export interface ExecutionResult {
  id: string;
  success: boolean;
  transactionHash?: string;
  receipt?: TransactionReceipt;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  actualProfit?: bigint;
  error?: string;
  timestamp: number;
  retryCount: number;
}

// Execution status
export interface ExecutionStatus {
  pending: number;
  completed: number;
  failed: number;
  totalProfitWei: string; // Changed from bigint to string for JSON serialization
  totalGasUsedWei: string; // Changed from bigint to string for JSON serialization
  successRate: number;
}

/**
 * Transaction Executor
 */
export class Executor {
  private wallet: ethers.Wallet;
  private pendingTransactions: Map<string, SwapTransaction> = new Map();
  private executionStatus: ExecutionStatus;
  private maxRetries = 3;
  private retryDelay = 5000; // 5 seconds
  
  constructor() {
    const privateKey = Config.wallet.privateKey!;
    const currentProvider = provider.get();
    this.wallet = new ethers.Wallet(privateKey, currentProvider);
    
    this.executionStatus = {
      pending: 0,
      completed: 0,
      failed: 0,
      totalProfitWei: '0', // Initialize as string
      totalGasUsedWei: '0', // Initialize as string
      successRate: 0,
    };
  }
  
  /**
   * Execute atomic swap
   */
  async executeAtomicSwap(
    opportunity: RankedOpportunity,
    dryRun: boolean = isSimulationMode()
  ): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const simulation = opportunity.simulation;
    
    logger.info(`Executing atomic swap ${executionId} (dry run: ${dryRun})`);
    
    try {
      // Build transaction
      const txBuilder = getTxBuilder();
      const urgency = opportunity.executionPriority === 'high' ? 'high' : 
                      opportunity.executionPriority === 'medium' ? 'standard' : 'low';
      
      const swapTx = await txBuilder.buildAtomicSwapTx(
        simulation.path,
        simulation.inputAmount,
        simulation.outputAmount,
        undefined,
        urgency
      );
      
      // Validate before execution
      if (!txBuilder.validateTransaction(swapTx.request)) {
        throw new Error('Transaction validation failed');
      }
      
      // Check gas price acceptability
      const gasManager = getGasManager();
      const isGasAcceptable = gasManager.isGasPriceAcceptable(
        simulation.netProfit,
        swapTx.request.gasLimit!
      );
      
      if (!isGasAcceptable) {
        logger.warn('Gas price too high for profitable execution');
        
        // Wait for better gas prices if not urgent
        if (opportunity.executionPriority !== 'high') {
          const waited = await gasManager.waitForLowerGas(100, 30000);
          if (!waited) {
            throw new Error('Gas price remains too high');
          }
        }
      }
      
      if (dryRun) {
        return this.simulateExecution(executionId, swapTx);
      }
      
      // Execute transaction
      return await this.executeTransaction(executionId, swapTx);
      
    } catch (error) {
      logger.error(`Execution ${executionId} failed:`, error);
      
      return {
        id: executionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        retryCount: 0,
      };
    }
  }
  
  /**
   * Execute transaction on-chain
   */
  private async executeTransaction(
    executionId: string,
    swapTx: SwapTransaction,
    retryCount: number = 0
  ): Promise<ExecutionResult> {
    try {
      // Store as pending
      this.pendingTransactions.set(executionId, swapTx);
      this.executionStatus.pending++;
      
      logger.info(`Submitting transaction ${executionId}...`);
      logger.debug('Transaction details:', {
        to: swapTx.request.to,
        gasLimit: swapTx.request.gasLimit?.toString(),
        value: swapTx.request.value.toString(),
        nonce: swapTx.request.nonce,
      });
      
      // Send transaction (already signed internally)
      const txResponse = await this.wallet.sendTransaction(swapTx.request);
      
      logger.info(`Transaction ${executionId} submitted: ${txResponse.hash}`);
      
      // Wait for confirmation
      const receipt = await this.waitForConfirmation(
        txResponse.hash,
        Config.execution.mode === 'live' ? 2 : 1
      );
      
      if (!receipt || receipt.status === 0) {
        throw new Error('Transaction reverted');
      }
      
      // Calculate actual profit
      const gasUsed = receipt.gasUsed;
      const effectiveGasPrice = receipt.gasPrice || swapTx.request.gasPrice || BigInt(0);
      const gasCost = gasUsed * effectiveGasPrice;
      const actualProfit = swapTx.metadata.estimatedProfitWei - gasCost;
      
      // Update status
      this.pendingTransactions.delete(executionId);
      this.executionStatus.pending--;
      this.executionStatus.completed++;
      
      // Update profit and gas totals (convert BigInt to string for storage)
      const currentProfit = BigInt(this.executionStatus.totalProfitWei);
      const currentGas = BigInt(this.executionStatus.totalGasUsedWei);
      this.executionStatus.totalProfitWei = (currentProfit + actualProfit).toString();
      this.executionStatus.totalGasUsedWei = (currentGas + gasCost).toString();
      
      this.updateSuccessRate();
      
      logger.info(`Transaction ${executionId} confirmed!`, {
        hash: receipt.hash,
        gasUsed: gasUsed.toString(),
        actualProfitWei: actualProfit.toString(),
        blockNumber: receipt.blockNumber,
      });
      
      // Release nonce
      nonceManager.confirmNonce(swapTx.request.nonce!);
      
      return {
        id: executionId,
        success: true,
        transactionHash: receipt.hash,
        receipt,
        gasUsed,
        effectiveGasPrice,
        actualProfit,
        timestamp: Date.now(),
        retryCount,
      };
      
    } catch (error) {
      logger.error(`Transaction ${executionId} failed:`, error);
      
      // Handle specific errors
      if (this.shouldRetry(error) && retryCount < this.maxRetries) {
        logger.info(`Retrying transaction ${executionId} (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        // Release the failed nonce
        if (swapTx.request.nonce !== undefined) {
          nonceManager.releaseNonce(swapTx.request.nonce);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        
        // Rebuild transaction with new nonce
        swapTx.request.nonce = await nonceManager.getNonce();
        
        return this.executeTransaction(executionId, swapTx, retryCount + 1);
      }
      
      // Update status for failure
      this.pendingTransactions.delete(executionId);
      this.executionStatus.pending--;
      this.executionStatus.failed++;
      this.updateSuccessRate();
      
      // Release nonce on final failure
      if (swapTx.request.nonce !== undefined) {
        nonceManager.releaseNonce(swapTx.request.nonce);
      }
      
      return {
        id: executionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        retryCount,
      };
    }
  }
  
  /**
   * Simulate execution without sending transaction
   */
  private async simulateExecution(
    executionId: string,
    swapTx: SwapTransaction
  ): Promise<ExecutionResult> {
    logger.info(`SIMULATION: Would execute transaction ${executionId}`);
    logger.debug('SIMULATION: Transaction details:', {
      type: swapTx.type,
      path: swapTx.path.id,
      expectedOutput: fromWei(swapTx.expectedOutput),
      estimatedProfit: fromWei(swapTx.metadata.estimatedProfitWei),
      urgency: swapTx.metadata.urgency,
    });
    
    // Simulate gas usage
    const gasUsed = swapTx.request.gasLimit || BigInt(200000);
    const gasPrice = swapTx.request.gasPrice || toWei(Config.gas.maxGasGwei, 9);
    const gasCost = gasUsed * gasPrice;
    const actualProfit = swapTx.metadata.estimatedProfitWei - gasCost;
    
    // Update simulated status
    this.executionStatus.completed++;
    
    // Update profit and gas totals (convert BigInt to string for storage)
    const currentProfit = BigInt(this.executionStatus.totalProfitWei);
    const currentGas = BigInt(this.executionStatus.totalGasUsedWei);
    this.executionStatus.totalProfitWei = (currentProfit + actualProfit).toString();
    this.executionStatus.totalGasUsedWei = (currentGas + gasCost).toString();
    
    this.updateSuccessRate();
    
    return {
      id: executionId,
      success: true,
      transactionHash: `0xsimulated_${executionId}`,
      gasUsed,
      effectiveGasPrice: gasPrice,
      actualProfit,
      timestamp: Date.now(),
      retryCount: 0,
    };
  }
  
  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    txHash: string,
    confirmations: number = 1,
    timeoutMs: number = 60000
  ): Promise<TransactionReceipt | null> {
    logger.debug(`Waiting for ${confirmations} confirmations for ${txHash}`);
    
    const receipt = await waitForTransaction(txHash, confirmations, timeoutMs);
    
    if (!receipt) {
      logger.error(`Transaction ${txHash} timed out`);
      return null;
    }
    
    if (receipt.status === 0) {
      logger.error(`Transaction ${txHash} reverted`);
    }
    
    return receipt;
  }
  
  /**
   * Check if should retry transaction
   */
  private shouldRetry(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    
    // Retry on these errors
    const retryableErrors = [
      'nonce too low',
      'replacement transaction underpriced',
      'transaction underpriced',
      'timeout',
      'network error',
    ];
    
    return retryableErrors.some(msg => errorMessage.includes(msg));
  }
  
  /**
   * Cancel pending transaction
   */
  async cancelTransaction(
    executionId: string
  ): Promise<boolean> {
    const pendingTx = this.pendingTransactions.get(executionId);
    
    if (!pendingTx) {
      logger.warn(`No pending transaction found: ${executionId}`);
      return false;
    }
    
    try {
      logger.info(`Attempting to cancel transaction ${executionId}`);
      
      // Send replacement transaction with same nonce but higher gas
      const cancelTx: TransactionRequest = {
        to: this.wallet.address, // Send to self
        data: '0x',
        value: BigInt(0),
        nonce: pendingTx.request.nonce,
        gasLimit: BigInt(21000),
        chainId: Config.network.chainId,
      };
      
      // Set higher gas price for replacement
      const gasManager = getGasManager();
      gasManager.setGasPriceForTx(cancelTx, 'high');
      
      const txResponse = await this.wallet.sendTransaction(cancelTx);
      const receipt = await txResponse.wait();
      
      if (receipt && receipt.status === 1) {
        logger.info(`Transaction ${executionId} cancelled successfully`);
        this.pendingTransactions.delete(executionId);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Failed to cancel transaction ${executionId}:`, error);
      return false;
    }
  }
  
  /**
   * Execute with flashloan
   */
  async executeWithFlashLoan(
    opportunity: RankedOpportunity,
    flashLoanAmount: bigint,
    provider: 'aave' | 'balancer' = 'aave'
  ): Promise<ExecutionResult> {
    const executionId = uuidv4();
    
    logger.info(`Executing flash loan arbitrage ${executionId} via ${provider}`);
    
    try {
      const txBuilder = getTxBuilder();
      const flashLoanTx = await txBuilder.buildFlashLoanTx(
        opportunity.simulation.path,
        flashLoanAmount,
        opportunity.simulation,
        provider
      );
      
      if (isSimulationMode()) {
        return this.simulateExecution(executionId, flashLoanTx);
      }
      
      return await this.executeTransaction(executionId, flashLoanTx);
      
    } catch (error) {
      logger.error(`Flash loan execution ${executionId} failed:`, error);
      
      return {
        id: executionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        retryCount: 0,
      };
    }
  }
  
  /**
   * Get execution status
   */
  getStatus(): ExecutionStatus {
    return {
      pending: this.executionStatus.pending,
      completed: this.executionStatus.completed,
      failed: this.executionStatus.failed,
      totalProfitWei: this.executionStatus.totalProfitWei.toString(), // Convert BigInt to string
      totalGasUsedWei: this.executionStatus.totalGasUsedWei.toString(), // Convert BigInt to string
      successRate: this.executionStatus.successRate,
    };
  }
  
  /**
   * Get pending transactions
   */
  getPendingTransactions(): SwapTransaction[] {
    return Array.from(this.pendingTransactions.values());
  }
  
  /**
   * Update success rate
   */
  private updateSuccessRate(): void {
    const total = this.executionStatus.completed + this.executionStatus.failed;
    
    if (total > 0) {
      this.executionStatus.successRate = 
        (this.executionStatus.completed / total) * 100;
    }
  }
  
  /**
   * Reset execution status
   */
  resetStatus(): void {
    this.executionStatus = {
      pending: 0,
      completed: 0,
      failed: 0,
      totalProfitWei: '0', // Initialize as string
      totalGasUsedWei: '0', // Initialize as string
      successRate: 0,
    };
    
    logger.info('Execution status reset');
  }
}

// Import for toWei
import { toWei } from '../utils/math';

// Export singleton instance
let executor: Executor | null = null;

export function getExecutor(): Executor {
  if (!executor) {
    executor = new Executor();
  }
  return executor;
}
