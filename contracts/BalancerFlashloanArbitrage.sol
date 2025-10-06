// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IUniswapV2Router {
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

contract BalancerFlashloanArbitrage is Ownable, ReentrancyGuard {
    
    // Balancer Vault on Polygon
    IBalancerVault public constant BALANCER_VAULT = IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    
    // Struct to hold arbitrage parameters
    struct ArbitrageParams {
        address[] path;           // Token swap path
        address[] routers;        // DEX routers to use
        uint256[] minAmountsOut;  // Minimum amounts for slippage protection
        uint256 deadline;         // Transaction deadline
    }
    
    event ArbitrageExecuted(
        address indexed token,
        uint256 borrowed,
        uint256 profit,
        address indexed executor
    );
    
    event ArbitrageFailed(
        address indexed token,
        uint256 borrowed,
        string reason
    );
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @notice Execute flashloan arbitrage
     * @param token Token to borrow
     * @param amount Amount to borrow
     * @param params Arbitrage parameters encoded
     */
    function executeArbitrage(
        address token,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        
        // Initiate flashloan
        BALANCER_VAULT.flashLoan(
            address(this),
            tokens,
            amounts,
            params
        );
    }
    
    /**
     * @notice Balancer flashloan callback
     * @param tokens Tokens borrowed
     * @param amounts Amounts borrowed
     * @param feeAmounts Fees (always 0 for Balancer)
     * @param userData Encoded arbitrage parameters
     */
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == address(BALANCER_VAULT), "Only Balancer Vault");
        require(feeAmounts[0] == 0, "Fee should be 0");
        
        address token = tokens[0];
        uint256 borrowedAmount = amounts[0];
        
        // Decode arbitrage parameters
        ArbitrageParams memory params = abi.decode(userData, (ArbitrageParams));
        
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        
        try this.executeSwaps(params) {
            uint256 balanceAfter = IERC20(token).balanceOf(address(this));
            
            // Check if we made profit
            require(balanceAfter >= balanceBefore + borrowedAmount, "No profit");
            
            uint256 profit = balanceAfter - balanceBefore - borrowedAmount;
            
            // Repay flashloan (no fee with Balancer!)
            IERC20(token).transfer(address(BALANCER_VAULT), borrowedAmount);
            
            // Transfer profit to owner
            if (profit > 0) {
                IERC20(token).transfer(owner(), profit);
            }
            
            emit ArbitrageExecuted(token, borrowedAmount, profit, owner());
            
        } catch Error(string memory reason) {
            // Repay flashloan even on failure
            IERC20(token).transfer(address(BALANCER_VAULT), borrowedAmount);
            emit ArbitrageFailed(token, borrowedAmount, reason);
            revert(reason);
        }
    }
    
    /**
     * @notice Execute the arbitrage swaps
     * @param params Arbitrage parameters
     */
    function executeSwaps(ArbitrageParams memory params) external {
        require(msg.sender == address(this), "Internal only");
        
        // Execute swaps across different DEXes
        for (uint256 i = 0; i < params.routers.length; i++) {
            address router = params.routers[i];
            
            // Build path for this swap
            address[] memory swapPath = new address[](2);
            swapPath[0] = params.path[i];
            swapPath[1] = params.path[i + 1];
            
            uint256 amountIn = IERC20(swapPath[0]).balanceOf(address(this));
            
            // Approve router
            IERC20(swapPath[0]).approve(router, amountIn);
            
            // Execute swap
            IUniswapV2Router(router).swapExactTokensForTokens(
                amountIn,
                params.minAmountsOut[i],
                swapPath,
                address(this),
                params.deadline
            );
        }
    }
    
    /**
     * @notice Simulate arbitrage to check profitability (view function)
     * @param params Arbitrage parameters
     * @return expectedProfit Expected profit from the arbitrage
     */
    function simulateArbitrage(
        ArbitrageParams memory params,
        uint256 borrowAmount
    ) external view returns (uint256 expectedProfit) {
        uint256 currentAmount = borrowAmount;
        
        for (uint256 i = 0; i < params.routers.length; i++) {
            address router = params.routers[i];
            
            address[] memory swapPath = new address[](2);
            swapPath[0] = params.path[i];
            swapPath[1] = params.path[i + 1];
            
            uint256[] memory amountsOut = IUniswapV2Router(router).getAmountsOut(
                currentAmount,
                swapPath
            );
            
            currentAmount = amountsOut[1];
        }
        
        if (currentAmount > borrowAmount) {
            expectedProfit = currentAmount - borrowAmount;
        } else {
            expectedProfit = 0;
        }
    }
    
    /**
     * @notice Emergency withdraw tokens
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }
    
    /**
     * @notice Withdraw native tokens (MATIC)
     */
    function withdrawNative() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    receive() external payable {}
}
