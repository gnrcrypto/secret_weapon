import { ADDRESSES } from '../config';
import { ethers, Contract } from 'ethers';

export interface DexAdapter {
  name: string;
  protocol: string;
  routerAddress: string;
  getAmountsOut(path: string[], amount: bigint): Promise<bigint[]>;
}

export class DexAdapterRegistry {
  private adapters: Map<string, DexAdapter> = new Map();
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    const routerAddresses = ADDRESSES.ROUTERS;

    Object.entries(routerAddresses).forEach(([name, address]) => {
      this.adapters.set(name.toLowerCase(), {
        name,
        protocol: this.determineProtocol(name),
        routerAddress: address as string,
        getAmountsOut: async (path: string[], amount: bigint) => {
          const routerContract = new Contract(
            address as string,
            ['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'],
            this.provider
          );

          try {
            const amounts = await routerContract.getAmountsOut(amount, path);
            return amounts.map((a: any) => BigInt(a.toString()));
          } catch (error) {
            console.error(`Failed to get amounts for ${name}:`, error);
            throw error;
          }
        }
      });
    });
  }

  private determineProtocol(name: string): string {
    const protocolMap: { [key: string]: string } = {
      'QUICKSWAP': 'uniswap-v2',
      'UNISWAP': 'uniswap-v2',
      'UNISWAPV3': 'uniswap-v3',
      'SUSHISWAP': 'uniswap-v2',
    };
    return protocolMap[name] || 'unknown';
  }

  getAdapter(dexName: string): DexAdapter {
    const adapter = this.adapters.get(dexName.toLowerCase());
    if (!adapter) {
      throw new Error(`No adapter found for DEX: ${dexName}`);
    }
    return adapter;
  }

  getAllAdapters(): DexAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const createDexAdapterRegistry = (provider: ethers.Provider) =>
  new DexAdapterRegistry(provider);
