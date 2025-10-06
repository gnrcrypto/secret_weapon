import { ethers, Wallet, JsonRpcProvider, WebSocketProvider, FallbackProvider } from 'ethers';
export declare const initializeProviders: () => void;
export declare const getProvider: () => JsonRpcProvider | WebSocketProvider | FallbackProvider;
export declare const getWebSocketProvider: () => WebSocketProvider | null;
export declare const initializeSigner: () => Wallet;
export declare const getSigner: () => Wallet;
export declare const getWalletAddress: () => string;
export declare const getWalletBalance: () => Promise<bigint>;
declare class NonceManager {
    private baseNonce;
    private nonceOffset;
    private lastReset;
    private resetInterval;
    private pendingNonces;
    getNonce(): Promise<number>;
    resetNonce(): Promise<void>;
    releaseNonce(nonce: number): void;
    confirmNonce(nonce: number): Promise<void>;
    releaseAllNonces(): void;
}
export declare const nonceManager: NonceManager;
export declare const startProviderMonitoring: () => void;
export declare const waitForTransaction: (txHash: string, confirmations?: number, timeoutMs?: number) => Promise<ethers.TransactionReceipt | null>;
export declare const provider: {
    get: () => JsonRpcProvider | WebSocketProvider | FallbackProvider;
    getWebSocket: () => WebSocketProvider | null;
    initialize: () => void;
    startMonitoring: () => void;
    stopMonitoring: () => void;
    switchProvider: () => Promise<boolean>;
};
export declare const wallet: {
    getSigner: () => Wallet;
    getAddress: () => string;
    getBalance: () => Promise<bigint>;
    initialize: () => Wallet;
    readonly address: string;
};
export {};
//# sourceMappingURL=polygonProvider.d.ts.map