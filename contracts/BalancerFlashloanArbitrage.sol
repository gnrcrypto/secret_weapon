// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// Aave V3 Interface
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

// Balancer Interface
interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

// DEX Router Interface
interface IDEXRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}

/**
 * @title PolygonArbitrageBot
 * @notice Production-ready arbitrage contract for Polygon with multiple strategies
 * @dev Supports Aave, Balancer flash loans and multiple arbitrage types
 */
contract PolygonArbitrageBot is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    
    // Roles
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // Protocol addresses on Polygon
    address public constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    
    // DEX Routers on Polygon
    address public constant QUICKSWAP_ROUTER = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;
    address public constant SUSHISWAP_ROUTER = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address public constant UNISWAPV3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    
    // State variables
    uint256 public totalProfit;
    uint256 public totalTrades;
    mapping(address => uint256) public tokenProfits;
    mapping(address => bool) public whitelistedTokens;
    
    // Configuration
    uint256 public minProfitBasisPoints = 10; // 0.1% minimum profit
    uint256 public maxSlippageBasisPoints = 50; // 0.5% max slippage
    
    // Arbitrage parameters struct
    struct ArbitrageParams {
        uint8 arbType;           // 0: triangular, 1: cross-dex, 2: multi-hop
        address[] tokens;        // Token addresses in path
        address[] routers;       // DEX routers to use
        uint256[] minAmountsOut; // Minimum amounts for slippage
        bytes extraData;         // Additional parameters
    }
    
    // Events
    event ArbitrageExecuted(
        address indexed executor,
        uint8 arbType,
        address indexed baseToken,
        uint256 amountIn,
        uint256 profit,
        uint256 gasUsed
    );
    
    event FlashLoanExecuted(
        string provider,
        address indexed token,
        uint256 amount,
        uint256 fee
    );
    
    event ConfigUpdated(
        uint256 minProfit,
        uint256 maxSlippage
    );
    
    modifier onlyExecutor() {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "Not executor");
        _;
    }
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
        
        // Whitelist major tokens
        whitelistedTokens[0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270] = true; // WMATIC
        whitelistedTokens[0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174] = true; // USDC
        whitelistedTokens[0xc2132D05D31c914a87C6611C10748AEb04B58e8F] = true; // USDT
        whitelistedTokens[0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063] = true; // DAI
    }
    
    /**
     * @notice Execute arbitrage with Aave flash loan
     */
    function executeAaveFlashLoan(
        address asset,
        uint256 amount,
        ArbitrageParams calldata params
    ) external onlyExecutor whenNotPaused nonReentrant {
        require(whitelistedTokens[asset], "Token not whitelisted");
        
        bytes memory data = abi.encode(params);
        IPool(AAVE_POOL).flashLoanSimple(
            address(this),
            asset,
            amount,
            data,
            0
        );
    }
    
    /**
     * @notice Execute arbitrage with Balancer flash loan (no fees!)
     */
    function executeBalancerFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        ArbitrageParams calldata params
    ) external onlyExecutor whenNotPaused nonReentrant {
        require(tokens.length == amounts.length, "Length mismatch");
        
        for (uint i = 0; i < tokens.length; i++) {
            require(whitelistedTokens[tokens[i]], "Token not whitelisted");
        }
        
        bytes memory data = abi.encode(params);
        IBalancerVault(BALANCER_VAULT).flashLoan(
            address(this),
            tokens,
            amounts,
            data
        );
    }
    
    /**
     * @notice Aave flash loan callback
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == AAVE_POOL, "Not Aave");
        require(initiator == address(this), "Invalid initiator");
        
        uint256 gasBefore = gasleft();
        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));
        
        // Execute arbitrage based on type
        uint256 finalAmount = _executeArbitrage(arbParams, amount);
        
        // Check profitability
        uint256 amountOwed = amount + premium;
        require(finalAmount >= amountOwed, "Not profitable");
        
        uint256 profit = finalAmount - amountOwed;
        require(profit * 10000 / amount >= minProfitBasisPoints, "Below min profit");
        
        // Repay flash loan
        IERC20(asset).safeApprove(AAVE_POOL, amountOwed);
        
        // Update metrics
        _updateMetrics(asset, profit, gasBefore - gasleft());
        
        // Transfer profit to treasury
        if (profit > 0) {
            IERC20(asset).safeTransfer(getRoleMember(ADMIN_ROLE, 0), profit);
        }
        
        emit FlashLoanExecuted("Aave", asset, amount, premium);
        
        return true;
    }
    
    /**
     * @notice Balancer flash loan callback
     */
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == BALANCER_VAULT, "Not Balancer");
        
        uint256 gasBefore = gasleft();
        ArbitrageParams memory params = abi.decode(userData, (ArbitrageParams));
        
        // Execute arbitrage
        uint256 finalAmount = _executeArbitrage(params, amounts[0]);
        
        // Balancer has no fees!
        require(finalAmount >= amounts[0], "Not profitable");
        
        uint256 profit = finalAmount - amounts[0];
        require(profit * 10000 / amounts[0] >= minProfitBasisPoints, "Below min profit");
        
        // Repay flash loan
        for (uint i = 0; i < tokens.length; i++) {
            tokens[i].safeTransfer(BALANCER_VAULT, amounts[i]);
        }
        
        // Update metrics and transfer profit
        _updateMetrics(address(tokens[0]), profit, gasBefore - gasleft());
        
        if (profit > 0) {
            tokens[0].safeTransfer(getRoleMember(ADMIN_ROLE, 0), profit);
        }
        
        emit FlashLoanExecuted("Balancer", address(tokens[0]), amounts[0], 0);
    }
    
    /**
     * @notice Execute arbitrage strategy
     */
    function _executeArbitrage(
        ArbitrageParams memory params,
        uint256 startAmount
    ) private returns (uint256) {
        if (params.arbType == 0) {
            // Triangular arbitrage
            return _executeTriangularArbitrage(params, startAmount);
        } else if (params.arbType == 1) {
            // Cross-DEX arbitrage
            return _executeCrossDexArbitrage(params, startAmount);
        } else if (params.arbType == 2) {
            // Multi-hop arbitrage
            return _executeMultiHopArbitrage(params, startAmount);
        } else {
            revert("Invalid arbitrage type");
        }
    }
    
    /**
     * @notice Execute triangular arbitrage (A -> B -> C -> A)
     */
    function _executeTriangularArbitrage(
        ArbitrageParams memory params,
        uint256 startAmount
    ) private returns (uint256) {
        require(params.tokens.length >= 3, "Need at least 3 tokens");
        
        uint256 currentAmount = startAmount;
        
        for (uint i = 0; i < params.tokens.length; i++) {
            address tokenIn = params.tokens[i];
            address tokenOut = params.tokens[(i + 1) % params.tokens.length];
            address router = params.routers[i];
            
            // Build path
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            // Approve and swap
            IERC20(tokenIn).safeApprove(router, currentAmount);
            
            uint256[] memory amounts = IDEXRouter(router).swapExactTokensForTokens(
                currentAmount,
                params.minAmountsOut[i],
                path,
                address(this),
                block.timestamp + 300
            );
            
            currentAmount = amounts[1];
        }
        
        return currentAmount;
    }
    
    /**
     * @notice Execute cross-DEX arbitrage (buy on DEX1, sell on DEX2)
     */
    function _executeCrossDexArbitrage(
        ArbitrageParams memory params,
        uint256 startAmount
    ) private returns (uint256) {
        require(params.tokens.length == 2, "Need exactly 2 tokens");
        require(params.routers.length == 2, "Need exactly 2 routers");
        
        address tokenA = params.tokens[0];
        address tokenB = params.tokens[1];
        
        // Buy on first DEX
        address[] memory buyPath = new address[](2);
        buyPath[0] = tokenA;
        buyPath[1] = tokenB;
        
        IERC20(tokenA).safeApprove(params.routers[0], startAmount);
        uint256[] memory buyAmounts = IDEXRouter(params.routers[0]).swapExactTokensForTokens(
            startAmount,
            params.minAmountsOut[0],
            buyPath,
            address(this),
            block.timestamp + 300
        );
        
        // Sell on second DEX
        address[] memory sellPath = new address[](2);
        sellPath[0] = tokenB;
        sellPath[1] = tokenA;
        
        IERC20(tokenB).safeApprove(params.routers[1], buyAmounts[1]);
        uint256[] memory sellAmounts = IDEXRouter(params.routers[1]).swapExactTokensForTokens(
            buyAmounts[1],
            params.minAmountsOut[1],
            sellPath,
            address(this),
            block.timestamp + 300
        );
        
        return sellAmounts[1];
    }
    
    /**
     * @notice Execute multi-hop arbitrage
     */
    function _executeMultiHopArbitrage(
        ArbitrageParams memory params,
        uint256 startAmount
    ) private returns (uint256) {
        uint256 currentAmount = startAmount;
        
        for (uint i = 0; i < params.routers.length; i++) {
            address tokenIn = params.tokens[i];
            address tokenOut = params.tokens[i + 1];
            
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            IERC20(tokenIn).safeApprove(params.routers[i], currentAmount);
            
            uint256[] memory amounts = IDEXRouter(params.routers[i]).swapExactTokensForTokens(
                currentAmount,
                params.minAmountsOut[i],
                path,
                address(this),
                block.timestamp + 300
            );
            
            currentAmount = amounts[1];
        }
        
        return currentAmount;
    }
    
    /**
     * @notice Update metrics after successful arbitrage
     */
    function _updateMetrics(
        address token,
        uint256 profit,
        uint256 gasUsed
    ) private {
        totalProfit += profit;
        totalTrades++;
        tokenProfits[token] += profit;
        
        emit ArbitrageExecuted(
            msg.sender,
            0, // arbType would be passed in
            token,
            0, // amount would be passed in
            profit,
            gasUsed
        );
    }
    
    /**
     * @notice Simulate arbitrage profitability
     */
    function simulateArbitrage(
        ArbitrageParams calldata params,
        uint256 startAmount
    ) external view returns (uint256 expectedProfit, bool isProfitable) {
        uint256 currentAmount = startAmount;
        
        // Simulate based on arbitrage type
        if (params.arbType == 0 || params.arbType == 2) {
            // Triangular or multi-hop
            for (uint i = 0; i < params.routers.length; i++) {
                address tokenIn = params.tokens[i];
                address tokenOut = params.tokens[(i + 1) % params.tokens.length];
                
                address[] memory path = new address[](2);
                path[0] = tokenIn;
                path[1] = tokenOut;
                
                uint256[] memory amounts = IDEXRouter(params.routers[i]).getAmountsOut(
                    currentAmount,
                    path
                );
                
                currentAmount = amounts[1];
            }
        }
        
        if (currentAmount > startAmount) {
            expectedProfit = currentAmount - startAmount;
            isProfitable = true;
        }
    }
    
    /**
     * @notice Update configuration
     */
    function updateConfig(
        uint256 _minProfitBps,
        uint256 _maxSlippageBps
    ) external onlyRole(ADMIN_ROLE) {
        minProfitBasisPoints = _minProfitBps;
        maxSlippageBasisPoints = _maxSlippageBps;
        emit ConfigUpdated(_minProfitBps, _maxSlippageBps);
    }
    
    /**
     * @notice Add/remove whitelisted tokens
     */
    function updateTokenWhitelist(
        address token,
        bool whitelisted
    ) external onlyRole(ADMIN_ROLE) {
        whitelistedTokens[token] = whitelisted;
    }
    
    /**
     * @notice Emergency pause
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @notice Emergency withdraw
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) {
            payable(msg.sender).transfer(amount);
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
    }
    
    receive() external payable {}
}
