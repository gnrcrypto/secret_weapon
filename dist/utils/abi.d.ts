import { Interface } from 'ethers';
/**
 * Common ABIs as constants for quick access
 */
export declare const ERC20_ABI: string[];
export declare const UNISWAP_V2_ROUTER_ABI: string[];
export declare const UNISWAP_V2_PAIR_ABI: string[];
export declare const UNISWAP_V2_FACTORY_ABI: string[];
export declare const UNISWAP_V3_ROUTER_ABI: string[];
export declare const CURVE_ROUTER_ABI: string[];
export declare const CURVE_POOL_ABI: string[];
export declare const AAVE_LENDING_POOL_ABI: string[];
export declare const BALANCER_VAULT_ABI: string[];
export declare const MULTICALL_ABI: string[];
export declare const WMATIC_ABI: string[];
export declare const CHAINLINK_ORACLE_ABI: string[];
/**
 * Interface instances for common contracts
 */
export declare const interfaces: {
    ERC20: Interface;
    UniswapV2Router: Interface;
    UniswapV2Pair: Interface;
    UniswapV2Factory: Interface;
    UniswapV3Router: Interface;
    CurveRouter: Interface;
    CurvePool: Interface;
    AaveLendingPool: Interface;
    BalancerVault: Interface;
    Multicall: Interface;
    WMATIC: Interface;
    ChainlinkOracle: Interface;
};
/**
 * Load ABI from JSON file
 */
export declare function loadAbiFromFile(filePath: string): Interface;
/**
 * Get cached interface or create new one
 */
export declare function getInterface(abiOrPath: string[] | string): Interface;
/**
 * Encode function call
 */
export declare function encodeFunctionCall(iface: Interface, functionName: string, params: any[]): string;
/**
 * Decode function result
 */
export declare function decodeFunctionResult(iface: Interface, functionName: string, data: string): any;
/**
 * Common contract addresses on Polygon
 */
export declare const POLYGON_ADDRESSES: {
    readonly WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
    readonly USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    readonly USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
    readonly DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
    readonly WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
    readonly WBTC: "0x1bFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
    readonly LINK: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39";
    readonly AAVE: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B";
    readonly UNI: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f";
    readonly QUICKSWAP_ROUTER: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
    readonly SUSHISWAP_ROUTER: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
    readonly UNISWAPV3_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    readonly CURVESWAP_ROUTER: "0x0DCDED3545D565bA3B19E683431381007245d983";
    readonly QUICKSWAP_FACTORY: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32";
    readonly SUSHISWAP_FACTORY: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
    readonly CURVE_USDC_USDT_POOL: "0x3A6f6B3a8E6c2527Bf6cE9316c17b9BEA7E73B4a";
    readonly CURVE_DAI_USDC_POOL: "0x3A6f6B3a8E6c2527Bf6cE9316c17b9BEA7E73B4a";
    readonly AAVE_LENDING_POOL: "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
    readonly AAVE_POOL_DATA_PROVIDER: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654";
    readonly BALANCER_VAULT: "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
    readonly MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11";
    readonly CHAINLINK_MATIC_USD: "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0";
    readonly CHAINLINK_ETH_USD: "0xF9680D99D6C9589e2a93a78A04A279e509205945";
    readonly CHAINLINK_BTC_USD: "0xc907E116054Ad103354f2D350FD2514433D57F6f";
    readonly CHAINLINK_USDC_USD: "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7";
    readonly CHAINLINK_AAVE_USD: "0x72484B12719E23115761D5DA1646945632979bB6";
    readonly CHAINLINK_ADA_USD: "0x882554df528115a743c4537828DA8D5B58e52544";
    readonly CHAINLINK_ALGO_USD: "0x03Bc6D9EFed65708D35fDaEfb25E87631a0a3437";
    readonly CHAINLINK_APE_USD: "0x2Ac3F3Bfac8fC9094BC3f0F9041a51375235B992";
    readonly CHAINLINK_AVAX_USD: "0xe01eA2fbd8D76ee323FbEd03eB9a8625EC981A10";
    readonly CHAINLINK_BNB_USD: "0x82a6c4AF830caa6c97bb504425f6A66165C2c26e";
};
/**
 * Helper to get router interface by DEX name
 */
export declare function getRouterInterface(dexName: string): Interface;
/**
 * Helper to get factory interface by DEX name
 */
export declare function getFactoryInterface(_dexName: string): Interface;
/**
 * Validate if an address has a specific function
 */
export declare function hasFunction(iface: Interface, functionName: string): boolean;
/**
 * Get event signature
 */
export declare function getEventSignature(iface: Interface, eventName: string): string;
/**
 * Parse transaction logs
 */
export declare function parseLog(iface: Interface, log: any): any;
export type RouterInterface = typeof interfaces.UniswapV2Router;
export type PairInterface = typeof interfaces.UniswapV2Pair;
export type FactoryInterface = typeof interfaces.UniswapV2Factory;
export type ERC20Interface = typeof interfaces.ERC20;
export type CurveRouterInterface = typeof interfaces.CurveRouter;
export type CurvePoolInterface = typeof interfaces.CurvePool;
//# sourceMappingURL=abi.d.ts.map