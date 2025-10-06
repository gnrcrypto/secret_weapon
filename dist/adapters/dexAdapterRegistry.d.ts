import { ethers } from 'ethers';
export interface DexAdapter {
    name: string;
    protocol: string;
    routerAddress: string;
    getAmountsOut(path: string[], amount: bigint): Promise<bigint[]>;
}
export declare class DexAdapterRegistry {
    private adapters;
    private provider;
    constructor(provider: ethers.Provider);
    private initializeAdapters;
    private determineProtocol;
    getAdapter(dexName: string): DexAdapter;
    getAllAdapters(): DexAdapter[];
}
export declare const createDexAdapterRegistry: (provider: ethers.Provider) => DexAdapterRegistry;
//# sourceMappingURL=dexAdapterRegistry.d.ts.map