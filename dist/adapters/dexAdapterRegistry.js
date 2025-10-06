"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDexAdapterRegistry = exports.DexAdapterRegistry = void 0;
const config_1 = require("../config");
const ethers_1 = require("ethers");
class DexAdapterRegistry {
    adapters = new Map();
    provider;
    constructor(provider) {
        this.provider = provider;
        this.initializeAdapters();
    }
    initializeAdapters() {
        const routerAddresses = config_1.ADDRESSES.ROUTERS;
        Object.entries(routerAddresses).forEach(([name, address]) => {
            this.adapters.set(name.toLowerCase(), {
                name,
                protocol: this.determineProtocol(name),
                routerAddress: address,
                getAmountsOut: async (path, amount) => {
                    const routerContract = new ethers_1.Contract(address, ['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'], this.provider);
                    try {
                        const amounts = await routerContract.getAmountsOut(amount, path);
                        return amounts.map((a) => BigInt(a.toString()));
                    }
                    catch (error) {
                        console.error(`Failed to get amounts for ${name}:`, error);
                        throw error;
                    }
                }
            });
        });
    }
    determineProtocol(name) {
        const protocolMap = {
            'QUICKSWAP': 'uniswap-v2',
            'UNISWAP': 'uniswap-v2',
            'UNISWAPV3': 'uniswap-v3',
            'SUSHISWAP': 'uniswap-v2',
        };
        return protocolMap[name] || 'unknown';
    }
    getAdapter(dexName) {
        const adapter = this.adapters.get(dexName.toLowerCase());
        if (!adapter) {
            throw new Error(`No adapter found for DEX: ${dexName}`);
        }
        return adapter;
    }
    getAllAdapters() {
        return Array.from(this.adapters.values());
    }
}
exports.DexAdapterRegistry = DexAdapterRegistry;
const createDexAdapterRegistry = (provider) => new DexAdapterRegistry(provider);
exports.createDexAdapterRegistry = createDexAdapterRegistry;
//# sourceMappingURL=dexAdapterRegistry.js.map