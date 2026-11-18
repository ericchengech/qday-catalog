// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PaymentRouterTest is Test {
    PaymentRouter router;
    MockERC20 token;

    address merchant = makeAddr("merchant");
    address buyer = makeAddr("buyer");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");

    uint128 constant PRICE_CRYPTO = 1e6;  // 1 tUSD8 (6 decimals)
    uint128 constant PRICE_NEWS = 2e6;
    uint128 constant PRICE_GRID = 3e6;

    function setUp() public {
        token = new MockERC20("Test USD8", "tUSD8", 6);
        router = new PaymentRouter(IERC20(address(token)));

        router.setProduct(1, PRICE_CRYPTO, true, "crypto-price");
        router.setProduct(2, PRICE_NEWS, true, "news-us");
        router.setProduct(3, PRICE_GRID, true, "grid-status");

        token.mint(buyer, 100e6);
        token.mint(agent, 100e6);
        vm.prank(buyer);
        token.approve(address(router), type(uint256).max);
        vm.prank(agent);
        token.approve(address(router), type(uint256).max);
    }

    function _hash(uint256 productId, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(productId, nonce));
    }

    function test_pay_happy_path() public {
        vm.prank(buyer);
        router.pay(1, _hash(1, 1));

        assertEq(token.balanceOf(address(router)), PRICE_CRYPTO);
        assertTrue(router.settledTx(_hash(1, 1)));
    }

    function test_pay_each_product_price() public {
        vm.startPrank(buyer);
        router.pay(1, _hash(1, 1));
        router.pay(2, _hash(2, 1));
        router.pay(3, _hash(3, 1));
        vm.stopPrank();
        assertEq(token.balanceOf(address(router)), PRICE_CRYPTO + PRICE_NEWS + PRICE_GRID);
    }

    function test_replay_same_txHash_reverts() public {
        bytes32 h = _hash(1, 7);
        vm.startPrank(buyer);
        router.pay(1, h);
        vm.expectRevert("tx already settled");
        router.pay(1, h);
        vm.stopPrank();
    }

    function test_inactive_product_reverts() public {
        router.setProduct(9, 1e6, false, "off");
        vm.prank(buyer);
        vm.expectRevert("inactive product");
        router.pay(9, _hash(9, 1));
    }

    function test_only_owner_can_admin() public {
        vm.prank(stranger);
        vm.expectRevert("not owner");
        router.setProduct(4, 1e6, true, "x");
        vm.prank(stranger);
        vm.expectRevert("not owner");
        router.setAgent(agent, 1, true);
        vm.prank(stranger);
        vm.expectRevert("not owner");
        router.withdraw(stranger, 1);
    }

    /*//////////////////////////////////////////////////////////////
                          AGENT SPENDING CAP
    //////////////////////////////////////////////////////////////*/

    function test_agent_pays_within_cap() public {
        // cap of 5 tUSD8: pays 1 (crypto) + 3 (grid) = 4 OK
        router.setAgent(agent, 5e6, true);

        vm.startPrank(agent);
        router.pay(1, _hash(1, 1));
        router.pay(3, _hash(3, 1));
        vm.stopPrank();

        (, uint256 spent,) = router.agents(agent);
        assertEq(spent, 4e6);
    }

    function test_agent_cap_exceeded_reverts() public {
        router.setAgent(agent, 2e6, true);

        vm.prank(agent);
        router.pay(2, _hash(2, 1));  // 2 tUSD8: cap reached

        vm.prank(agent);
        vm.expectRevert("agent cap exceeded");
        router.pay(1, _hash(1, 1));
    }

    function test_unregistered_payer_has_no_cap_limit() public {
        // A plain buyer is not capped (human user), unlike registered agents.
        vm.prank(buyer);
        router.pay(3, _hash(3, 1));
        (, uint256 spent, bool authorized) = router.agents(buyer);
        assertEq(spent, 0);
        assertFalse(authorized);
    }

    /*//////////////////////////////////////////////////////////////
                               WITHDRAW
    //////////////////////////////////////////////////////////////*/

    function test_owner_withdraw() public {
        vm.prank(buyer);
        router.pay(1, _hash(1, 1));

        router.withdraw(merchant, PRICE_CRYPTO);
        assertEq(token.balanceOf(merchant), PRICE_CRYPTO);
        assertEq(token.balanceOf(address(router)), 0);
    }
}
