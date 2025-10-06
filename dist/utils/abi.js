"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLYGON_ADDRESSES = exports.interfaces = exports.CHAINLINK_ORACLE_ABI = exports.WMATIC_ABI = exports.MULTICALL_ABI = exports.BALANCER_VAULT_ABI = exports.AAVE_LENDING_POOL_ABI = exports.UNISWAP_V3_ROUTER_ABI = exports.UNISWAP_V2_FACTORY_ABI = exports.UNISWAP_V2_PAIR_ABI = exports.UNISWAP_V2_ROUTER_ABI = exports.ERC20_ABI = void 0;
exports.loadAbiFromFile = loadAbiFromFile;
exports.getInterface = getInterface;
exports.encodeFunctionCall = encodeFunctionCall;
exports.decodeFunctionResult = decodeFunctionResult;
exports.getRouterInterface = getRouterInterface;
exports.getFactoryInterface = getFactoryInterface;
exports.hasFunction = hasFunction;
exports.getEventSignature = getEventSignature;
exports.parseLog = parseLog;
const ethers_1 = require("ethers");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// ABI cache to avoid repeated parsing
const abiCache = new Map();
/**
 * Common ABIs as constants for quick access
 */
exports.ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
];
exports.UNISWAP_V2_ROUTER_ABI = [
    'function factory() view returns (address)',
    'function WETH() view returns (address)',
    'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
    'function getAmountsIn(uint amountOut, address[] path) view returns (uint[] amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
    'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] path, address to, uint deadline) returns (uint[] amounts)',
    'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
    'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] path, address to, uint deadline) returns (uint[] amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
    'function swapETHForExactTokens(uint amountOut, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
    'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)',
    'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB)',
];
exports.UNISWAP_V2_PAIR_ABI = [
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function price0CumulativeLast() view returns (uint)',
    'function price1CumulativeLast() view returns (uint)',
    'function kLast() view returns (uint)',
    'function mint(address to) returns (uint liquidity)',
    'function burn(address to) returns (uint amount0, uint amount1)',
    'function swap(uint amount0Out, uint amount1Out, address to, bytes data)',
    'function skim(address to)',
    'function sync()',
    'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
    'event Sync(uint112 reserve0, uint112 reserve1)',
];
exports.UNISWAP_V2_FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) view returns (address pair)',
    'function allPairs(uint) view returns (address pair)',
    'function allPairsLength() view returns (uint)',
    'function createPair(address tokenA, address tokenB) returns (address pair)',
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
];
exports.UNISWAP_V3_ROUTER_ABI = [
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)',
    'function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)',
    'function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)',
];
exports.AAVE_LENDING_POOL_ABI = [
    'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes params, uint16 referralCode)',
    'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
    'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
    'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
    'function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)',
    'function getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];
exports.BALANCER_VAULT_ABI = [
    'function flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes userData)',
    'function swap(tuple(bytes32 poolId, uint256 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) payable returns (uint256)',
    'function batchSwap(uint256 kind, tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 deadline) payable returns (int256[] assetDeltas)',
    'function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)',
];
exports.MULTICALL_ABI = [
    'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)',
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
    'function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
];
exports.WMATIC_ABI = [
    ...exports.ERC20_ABI,
    'function deposit() payable',
    'function withdraw(uint256 amount)',
    'event Deposit(address indexed dst, uint wad)',
    'event Withdrawal(address indexed src, uint wad)',
];
exports.CHAINLINK_ORACLE_ABI = [
    'function decimals() view returns (uint8)',
    'function description() view returns (string)',
    'function latestRoundData() view returns (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];
/**
 * Interface instances for common contracts
 */
exports.interfaces = {
    ERC20: new ethers_1.Interface(exports.ERC20_ABI),
    UniswapV2Router: new ethers_1.Interface(exports.UNISWAP_V2_ROUTER_ABI),
    UniswapV2Pair: new ethers_1.Interface(exports.UNISWAP_V2_PAIR_ABI),
    UniswapV2Factory: new ethers_1.Interface(exports.UNISWAP_V2_FACTORY_ABI),
    UniswapV3Router: new ethers_1.Interface(exports.UNISWAP_V3_ROUTER_ABI),
    AaveLendingPool: new ethers_1.Interface(exports.AAVE_LENDING_POOL_ABI),
    BalancerVault: new ethers_1.Interface(exports.BALANCER_VAULT_ABI),
    Multicall: new ethers_1.Interface(exports.MULTICALL_ABI),
    WMATIC: new ethers_1.Interface(exports.WMATIC_ABI),
    ChainlinkOracle: new ethers_1.Interface(exports.CHAINLINK_ORACLE_ABI),
};
/**
 * Load ABI from JSON file
 */
function loadAbiFromFile(filePath) {
    // Check cache first
    if (abiCache.has(filePath)) {
        return abiCache.get(filePath);
    }
    try {
        const absolutePath = path_1.default.resolve(filePath);
        const abiJson = fs_1.default.readFileSync(absolutePath, 'utf-8');
        const abi = JSON.parse(abiJson);
        // Handle different ABI formats
        let abiArray = abi;
        if (abi.abi) {
            // Truffle/Hardhat artifact format
            abiArray = abi.abi;
        }
        const iface = new ethers_1.Interface(abiArray);
        abiCache.set(filePath, iface);
        return iface;
    }
    catch (error) {
        throw new Error(`Failed to load ABI from ${filePath}: ${error}`);
    }
}
/**
 * Get cached interface or create new one
 */
function getInterface(abiOrPath) {
    if (typeof abiOrPath === 'string') {
        // It's a file path
        if (abiOrPath.endsWith('.json')) {
            return loadAbiFromFile(abiOrPath);
        }
        // It's a cache key
        if (abiCache.has(abiOrPath)) {
            return abiCache.get(abiOrPath);
        }
    }
    // It's an ABI array
    const iface = new ethers_1.Interface(abiOrPath);
    return iface;
}
/**
 * Encode function call
 */
function encodeFunctionCall(iface, functionName, params) {
    return iface.encodeFunctionData(functionName, params);
}
/**
 * Decode function result
 */
function decodeFunctionResult(iface, functionName, data) {
    return iface.decodeFunctionResult(functionName, data);
}
/**
 * Common contract addresses on Polygon
 */
exports.POLYGON_ADDRESSES = {
    // Tokens
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    WBTC: '0x1bFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
    // DEX Routers
    QUICKSWAP_ROUTER: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    SUSHISWAP_ROUTER: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    UNISWAPV3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    // DEX Factories
    QUICKSWAP_FACTORY: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    SUSHISWAP_FACTORY: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    // Lending
    AAVE_LENDING_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    AAVE_POOL_DATA_PROVIDER: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
    // Balancer
    BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    // Utilities
    MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    // Chainlink Oracles (USD pairs)
    CHAINLINK_MATIC_USD: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
    CHAINLINK_ETH_USD: '0xF9680D99D6C9589e2a93a78A04A279e509205945',
    CHAINLINK_BTC_USD: '0xc907E116054Ad103354f2D350FD2514433D57F6f',
    CHAINLINK_USDC_USD: '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7',
};
/**
 * Helper to get router interface by DEX name
 */
function getRouterInterface(dexName) {
    const normalizedName = dexName.toLowerCase();
    if (normalizedName.includes('v3')) {
        return exports.interfaces.UniswapV3Router;
    }
    // Most DEXs use UniswapV2 compatible routers
    return exports.interfaces.UniswapV2Router;
}
/**
 * Helper to get factory interface by DEX name
 */
function getFactoryInterface(_dexName) {
    // Most DEXs use UniswapV2 compatible factories
    return exports.interfaces.UniswapV2Factory;
}
/**
 * Validate if an address has a specific function
 */
function hasFunction(iface, functionName) {
    try {
        iface.getFunction(functionName);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get event signature
 */
function getEventSignature(iface, eventName) {
    const event = iface.getEvent(eventName);
    if (!event) {
        throw new Error(`Event ${eventName} not found in interface`);
    }
    return event.topicHash;
}
/**
 * Parse transaction logs
 */
function parseLog(iface, log) {
    try {
        return iface.parseLog(log);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=abi.js.map