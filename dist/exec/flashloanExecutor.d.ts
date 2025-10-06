import { ArbitragePath } from '../arb/pathfinder';
export declare class FlashloanExecutor {
    private contract;
    private wallet;
    constructor();
    /**
     * Execute flashloan arbitrage
     */
    executeArbitrage(path: ArbitragePath, amountIn: bigint, minAmountsOut: bigint[], deadline: number): Promise<{
        success: boolean;
        transactionHash?: string;
        error?: string;
    }>;
    /**
     * Simulate arbitrage before executing
     */
    simulateArbitrage(path: ArbitragePath, amountIn: bigint, minAmountsOut: bigint[], deadline: number): Promise<bigint>;
    /**
     * Get router address for a DEX
     */
    private getRouterAddress;
    /**
     * Check if contract is properly configured
     */
    verifySetup(): Promise<boolean>;
    /**
     * Emergency withdraw tokens from contract
     */
    emergencyWithdraw(tokenAddress: string, amount: bigint): Promise<void>;
}
export declare const flashloanExecutor: FlashloanExecutor;
//# sourceMappingURL=flashloanExecutor.d.ts.map