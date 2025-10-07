"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Executor = void 0;
exports.getExecutor = getExecutor;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const polygonProvider_1 = require("../providers/polygonProvider");
const txBuilder_1 = require("./txBuilder");
const gasManager_1 = require("./gasManager");
const math_1 = require("../utils/math");
const winston_1 = __importDefault(require("winston"));
const uuid_1 = require("uuid");
// Logger setup
const logger = winston_1.default.createLogger({
    level: config_1.Config.monitoring.logLevel,
    format: winston_1.default.format.json(),
    defaultMeta: { service: 'executor' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.simple(),
        }),
    ],
});
/**
 * Transaction Executor
 */
class Executor {
    wallet;
    pendingTransactions = new Map();
    executionStatus;
    maxRetries = 3;
    retryDelay = 5000; // 5 seconds
    constructor() {
        const privateKey = config_1.Config.wallet.privateKey;
        const currentProvider = polygonProvider_1.provider.get();
        this.wallet = new ethers_1.ethers.Wallet(privateKey, currentProvider);
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
    async executeAtomicSwap(opportunity, dryRun = (0, config_1.isSimulationMode)()) {
        const executionId = (0, uuid_1.v4)();
        const simulation = opportunity.simulation;
        logger.info(`Executing atomic swap ${executionId} (dry run: ${dryRun})`);
        try {
            // Build transaction
            const txBuilder = (0, txBuilder_1.getTxBuilder)();
            const urgency = opportunity.executionPriority === 'high' ? 'high' :
                opportunity.executionPriority === 'medium' ? 'standard' : 'low';
            const swapTx = await txBuilder.buildAtomicSwapTx(simulation.path, simulation.inputAmount, simulation.outputAmount, undefined, urgency);
            // Validate before execution
            if (!txBuilder.validateTransaction(swapTx.request)) {
                throw new Error('Transaction validation failed');
            }
            // Check gas price acceptability
            const gasManager = (0, gasManager_1.getGasManager)();
            const isGasAcceptable = gasManager.isGasPriceAcceptable(simulation.netProfit, swapTx.request.gasLimit);
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
        }
        catch (error) {
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
    async executeTransaction(executionId, swapTx, retryCount = 0) {
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
            const receipt = await this.waitForConfirmation(txResponse.hash, config_1.Config.execution.mode === 'live' ? 2 : 1);
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
            polygonProvider_1.nonceManager.confirmNonce(swapTx.request.nonce);
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
        }
        catch (error) {
            logger.error(`Transaction ${executionId} failed:`, error);
            // Handle specific errors
            if (this.shouldRetry(error) && retryCount < this.maxRetries) {
                logger.info(`Retrying transaction ${executionId} (attempt ${retryCount + 1}/${this.maxRetries})`);
                // Release the failed nonce
                if (swapTx.request.nonce !== undefined) {
                    polygonProvider_1.nonceManager.releaseNonce(swapTx.request.nonce);
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                // Rebuild transaction with new nonce
                swapTx.request.nonce = await polygonProvider_1.nonceManager.getNonce();
                return this.executeTransaction(executionId, swapTx, retryCount + 1);
            }
            // Update status for failure
            this.pendingTransactions.delete(executionId);
            this.executionStatus.pending--;
            this.executionStatus.failed++;
            this.updateSuccessRate();
            // Release nonce on final failure
            if (swapTx.request.nonce !== undefined) {
                polygonProvider_1.nonceManager.releaseNonce(swapTx.request.nonce);
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
    async simulateExecution(executionId, swapTx) {
        logger.info(`SIMULATION: Would execute transaction ${executionId}`);
        logger.debug('SIMULATION: Transaction details:', {
            type: swapTx.type,
            path: swapTx.path.id,
            expectedOutput: (0, math_1.fromWei)(swapTx.expectedOutput),
            estimatedProfit: (0, math_1.fromWei)(swapTx.metadata.estimatedProfitWei),
            urgency: swapTx.metadata.urgency,
        });
        // Simulate gas usage
        const gasUsed = swapTx.request.gasLimit || BigInt(200000);
        const gasPrice = swapTx.request.gasPrice || (0, math_2.toWei)(config_1.Config.gas.maxGasGwei, 9);
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
    async waitForConfirmation(txHash, confirmations = 1, timeoutMs = 60000) {
        logger.debug(`Waiting for ${confirmations} confirmations for ${txHash}`);
        const receipt = await (0, polygonProvider_1.waitForTransaction)(txHash, confirmations, timeoutMs);
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
    shouldRetry(error) {
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
    async cancelTransaction(executionId) {
        const pendingTx = this.pendingTransactions.get(executionId);
        if (!pendingTx) {
            logger.warn(`No pending transaction found: ${executionId}`);
            return false;
        }
        try {
            logger.info(`Attempting to cancel transaction ${executionId}`);
            // Send replacement transaction with same nonce but higher gas
            const cancelTx = {
                to: this.wallet.address, // Send to self
                data: '0x',
                value: BigInt(0),
                nonce: pendingTx.request.nonce,
                gasLimit: BigInt(21000),
                chainId: config_1.Config.network.chainId,
            };
            // Set higher gas price for replacement
            const gasManager = (0, gasManager_1.getGasManager)();
            gasManager.setGasPriceForTx(cancelTx, 'high');
            const txResponse = await this.wallet.sendTransaction(cancelTx);
            const receipt = await txResponse.wait();
            if (receipt && receipt.status === 1) {
                logger.info(`Transaction ${executionId} cancelled successfully`);
                this.pendingTransactions.delete(executionId);
                return true;
            }
            return false;
        }
        catch (error) {
            logger.error(`Failed to cancel transaction ${executionId}:`, error);
            return false;
        }
    }
    /**
     * Execute with flashloan
     */
    async executeWithFlashLoan(opportunity, flashLoanAmount, provider = 'aave') {
        const executionId = (0, uuid_1.v4)();
        logger.info(`Executing flash loan arbitrage ${executionId} via ${provider}`);
        try {
            const txBuilder = (0, txBuilder_1.getTxBuilder)();
            const flashLoanTx = await txBuilder.buildFlashLoanTx(opportunity.simulation.path, flashLoanAmount, opportunity.simulation, provider);
            if ((0, config_1.isSimulationMode)()) {
                return this.simulateExecution(executionId, flashLoanTx);
            }
            return await this.executeTransaction(executionId, flashLoanTx);
        }
        catch (error) {
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
    getStatus() {
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
    getPendingTransactions() {
        return Array.from(this.pendingTransactions.values());
    }
    /**
     * Update success rate
     */
    updateSuccessRate() {
        const total = this.executionStatus.completed + this.executionStatus.failed;
        if (total > 0) {
            this.executionStatus.successRate =
                (this.executionStatus.completed / total) * 100;
        }
    }
    /**
     * Reset execution status
     */
    resetStatus() {
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
exports.Executor = Executor;
// Import for toWei
const math_2 = require("../utils/math");
// Export singleton instance
let executor = null;
function getExecutor() {
    if (!executor) {
        executor = new Executor();
    }
    return executor;
}
//# sourceMappingURL=executor.js.map