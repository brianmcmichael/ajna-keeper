// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// AUDIT FIX: Import OpenZeppelin utilities for security
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import { IERC20Pool, PoolDeployer } from "../AjnaInterfaces.sol";
import { IERC20 } from "../OneInchInterfaces.sol";
import { IAjnaKeeperTaker } from "../interfaces/IAjnaKeeperTaker.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Aerodrome Finance implementation for Ajna keeper takes
/// @dev Aerodrome is a V2-style DEX (fork of Velodrome) on Base with stable and volatile pools
/// @dev Follows the same pattern as SushiSwapKeeperTaker for decimal handling
contract AerodromeKeeperTaker is IAjnaKeeperTaker, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @notice Configuration for Aerodrome swaps with pre-calculated minimum
    struct AerodromeDetails {
        address factory;            // Aerodrome factory contract address
        bool stable;                // Pool type: true = stable pool, false = volatile pool
        uint256 amountOutMinimum;   // Pre-calculated minimum output
        uint256 deadline;           // Swap deadline timestamp
    }

    /// @notice Route structure for Aerodrome V2-style swaps
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    /// @dev Hash used for all ERC20 pools, used for pool validation
    bytes32 public constant ERC20_NON_SUBSET_HASH = keccak256("ERC20_NON_SUBSET_HASH");
    /// @dev Actor allowed to take auctions using this contract
    address public immutable owner;
    /// @dev Identifies the Ajna deployment, used to validate pools
    PoolDeployer public immutable poolFactory;
    /// @dev Factory contract that is also authorized to call functions
    address public immutable authorizedFactory;

    // Events for monitoring
    event TakeExecuted(
        address indexed pool,
        address indexed borrower,
        uint256 collateralAmount,
        uint256 quoteAmount,
        LiquiditySource source,
        address indexed caller
    );
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bool stable
    );

    // Errors
    error Unauthorized();           // sig: 0x82b42900
    error InvalidPool();            // sig: 0x2083cd40
    error UnsupportedSource();      // sig: 0xf54a7ed9
    error SwapFailed();             // sig: 0xf2fde38b
    error InvalidSwapDetails();     // sig: 0x13d0c2b4

    /// @param ajnaErc20PoolFactory Ajna ERC20 pool factory for the deployment
    /// @param _authorizedFactory Factory contract address that can also call functions
    constructor(PoolDeployer ajnaErc20PoolFactory, address _authorizedFactory) {
        owner = msg.sender;
        poolFactory = ajnaErc20PoolFactory;
        authorizedFactory = _authorizedFactory;
    }

    /// @inheritdoc IAjnaKeeperTaker
    function takeWithAtomicSwap(
        IERC20Pool pool,
        address borrowerAddress,
        uint256 auctionPrice,
        uint256 maxAmount,
        LiquiditySource source,
        address swapRouter,
        bytes calldata swapDetails
    ) external onlyOwnerOrFactory {
        // Validate inputs
        if (source != LiquiditySource.Aerodrome) revert UnsupportedSource();
        if (!_validatePool(pool)) revert InvalidPool();

        // Decode swap details: (address factory, bool stable, uint256 amountOutMinimum, uint256 deadline)
        if (swapDetails.length < 128) revert InvalidSwapDetails(); // Basic length check
        (address aerodromeFactory, bool stable, uint256 amountOutMinimum, uint256 deadline) =
            abi.decode(swapDetails, (address, bool, uint256, uint256));

        // Validate parameters
        require(swapRouter != address(0), "Invalid router");
        require(aerodromeFactory != address(0), "Invalid factory");
        require(deadline > block.timestamp, "Expired deadline");
        require(amountOutMinimum > 0, "Invalid minimum amount");

        // Configuration for Aerodrome swap
        bytes memory data = abi.encode(AerodromeDetails({
            factory: aerodromeFactory,
            stable: stable,
            amountOutMinimum: amountOutMinimum,
            deadline: deadline
        }), swapRouter); // Include router address in data

        // Safe approval using Ajna's scaling (same as SushiSwap pattern)
        uint256 approvalAmount = Math.ceilDiv(_ceilWmul(maxAmount, auctionPrice), pool.quoteTokenScale());
        _safeApproveWithReset(IERC20(pool.quoteTokenAddress()), address(pool), approvalAmount);

        // Invoke the take
        pool.take(borrowerAddress, maxAmount, address(this), data);

        // SECURITY FIX: Reset allowance to prevent future misuse
        _safeApproveWithReset(IERC20(pool.quoteTokenAddress()), address(pool), 0);

        // Send excess quote token (profit) to owner
        _recoverToken(IERC20(pool.quoteTokenAddress()));
    }

    /// @notice Called by Pool to swap collateral for quote tokens during liquidation
    function atomicSwapCallback(uint256 collateral, uint256, bytes calldata data) external override nonReentrant {
        // Ensure msg.sender is a valid Ajna pool
        IERC20Pool pool = IERC20Pool(msg.sender);
        if (!_validatePool(pool)) revert InvalidPool();

        // Decode swap configuration and router address
        (AerodromeDetails memory details, address swapRouter) = abi.decode(data, (AerodromeDetails, address));

        // Execute Aerodrome swap
        _swapWithAerodrome(
            pool.collateralAddress(),
            pool.quoteTokenAddress(),
            collateral, // Already in native token amount that Ajna Core knows
            swapRouter,
            details
        );
    }

    /// @inheritdoc IAjnaKeeperTaker
    function recover(IERC20 token) external onlyOwnerOrFactory {
        _recoverToken(token);
    }

    /// @inheritdoc IAjnaKeeperTaker
    function getSupportedSources() external pure returns (LiquiditySource[] memory sources) {
        sources = new LiquiditySource[](1);
        sources[0] = LiquiditySource.Aerodrome;
    }

    /// @inheritdoc IAjnaKeeperTaker
    function isSourceSupported(LiquiditySource source) external pure returns (bool supported) {
        return source == LiquiditySource.Aerodrome;
    }

    /// @dev Executes swap using Aerodrome Router with pre-calculated minimum
    /// @dev Aerodrome uses V2-style swapExactTokensForTokens with route structs
    function _swapWithAerodrome(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address router,
        AerodromeDetails memory details
    ) private {
        if (amountIn == 0) revert SwapFailed();
        if (block.timestamp > details.deadline) revert SwapFailed();

        IERC20 tokenInContract = IERC20(tokenIn);

        // Safe approval for Aerodrome router
        _safeApproveWithReset(tokenInContract, router, amountIn);

        // Use pre-calculated minimum directly (mirrors SushiSwap success pattern)
        uint256 amountOutMin = details.amountOutMinimum;

        // Create route struct for Aerodrome V2-style swap
        Route[] memory routes = new Route[](1);
        routes[0] = Route({
            from: tokenIn,
            to: tokenOut,
            stable: details.stable,
            factory: details.factory
        });

        // Prepare Aerodrome swapExactTokensForTokens parameters
        // Function signature: swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline)
        bytes memory swapCalldata = abi.encodeWithSignature(
            "swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)",
            amountIn,             // amountIn
            amountOutMin,         // amountOutMin (pre-calculated)
            routes,               // routes array
            address(this),        // recipient
            details.deadline      // deadline
        );

        // Execute the swap
        bytes memory result = Address.functionCall(
            router,
            swapCalldata,
            "Aerodrome swap failed"
        );

        // Decode and validate output amount
        // Aerodrome returns uint256[] memory amounts
        uint256[] memory amounts = abi.decode(result, (uint256[]));
        require(amounts.length >= 2, "Invalid swap result");
        uint256 amountOut = amounts[amounts.length - 1]; // Last element is final output
        require(amountOut >= amountOutMin, "Insufficient output amount");

        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut, details.stable);
    }

    /// @dev Recovers token balance to owner
    function _recoverToken(IERC20 token) private {
        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(owner, balance);
        }
    }

    /// @dev Validates that the pool is from our Ajna deployment
    function _validatePool(IERC20Pool pool) private view returns(bool) {
        return poolFactory.deployedPools(ERC20_NON_SUBSET_HASH, pool.collateralAddress(), pool.quoteTokenAddress()) == address(pool);
    }

    /// @dev Multiplies two WADs and rounds up (same as SushiSwap pattern)
    function _ceilWmul(uint256 x, uint256 y) internal pure returns (uint256) {
        return (x * y + 1e18 - 1) / 1e18;
    }

    /// @dev Safe approval that handles non-zero to non-zero allowance issue
    /// @param token The ERC20 token to approve
    /// @param spender The address to approve
    /// @param amount The amount to approve
    function _safeApproveWithReset(IERC20 token, address spender, uint256 amount) private {
        uint256 currentAllowance = token.allowance(address(this), spender);

        if (currentAllowance != 0) {
            // Reset to zero first if there's existing allowance
            token.safeApprove(spender, 0);
        }

        // Now approve the new amount
        if (amount != 0) {
            token.safeApprove(spender, amount);
        }
    }

    // Modifier that allows both owner and authorized factory
    modifier onlyOwnerOrFactory() {
        if (msg.sender != owner && msg.sender != authorizedFactory) revert Unauthorized();
        _;
    }
}
