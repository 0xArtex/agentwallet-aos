// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AgentWallet} from "../src/AgentWallet.sol";
import {AgentWalletFactory} from "../src/AgentWalletFactory.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";

contract AgentWalletTest is Test {
    AgentWalletFactory factory;
    AgentWallet wallet;
    ERC20Mock usdc;

    address human = makeAddr("human");
    address agent = makeAddr("agent");
    address recipient = makeAddr("recipient");

    function setUp() public {
        factory = new AgentWalletFactory();
        vm.deal(address(factory), 1 ether);

        address w = factory.createWallet(human, agent);
        wallet = AgentWallet(payable(w));

        usdc = new ERC20Mock("USDC", "USDC", 6);
        usdc.mint(address(wallet), 1000e6);
        vm.deal(address(wallet), 1 ether);
    }

    // ─── Basic ───

    function test_initialized() public view {
        assertEq(wallet.owner(), human);
        assertEq(wallet.agentKey(), agent);
        assertTrue(wallet.initialized());
    }

    function test_defaultPolicy() public view {
        (uint256 daily, uint256 perTx, bool paused) = (
            wallet.getPolicy().dailyLimit,
            wallet.getPolicy().perTxLimit,
            wallet.getPolicy().paused
        );
        assertEq(daily, 50e6);
        assertEq(perTx, 25e6);
        assertFalse(paused);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert("AW: already initialized");
        wallet.initialize(human, agent);
    }

    // ─── Agent Execution ───

    function test_agentExecutesETH() public {
        uint256 before_ = recipient.balance;
        vm.prank(agent);
        wallet.execute(recipient, 10e6, "");
        assertEq(recipient.balance, before_ + 10e6);
    }

    function test_agentExecutesERC20() public {
        vm.prank(agent);
        wallet.executeERC20(address(usdc), recipient, 20e6);
        assertEq(usdc.balanceOf(recipient), 20e6);
    }

    function test_randomCannotExecute() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 1e6, "");
    }

    // ─── Limits ───

    function test_rejectsOverPerTxLimit() public {
        vm.prank(agent);
        vm.expectRevert("AW: exceeds per-tx limit");
        wallet.execute(recipient, 26e6, "");
    }

    function test_rejectsOverDailyLimit() public {
        // 25 + 25 = 50 OK, next should fail
        vm.prank(agent);
        wallet.execute(recipient, 25e6, "");
        vm.prank(agent);
        wallet.execute(recipient, 25e6, "");

        vm.prank(agent);
        vm.expectRevert("AW: exceeds daily limit");
        wallet.execute(recipient, 1e6, "");
    }

    function test_dailyLimitResetsAfter24h() public {
        vm.prank(agent);
        wallet.execute(recipient, 25e6, "");
        vm.prank(agent);
        wallet.execute(recipient, 25e6, "");

        // Advance 24h
        vm.warp(block.timestamp + 86401);

        vm.prank(agent);
        wallet.execute(recipient, 25e6, ""); // should work
    }

    function test_spentTodayTracking() public {
        assertEq(wallet.getSpentToday(), 0);
        assertEq(wallet.getRemainingDaily(), 50e6);

        vm.prank(agent);
        wallet.execute(recipient, 10e6, "");

        assertEq(wallet.getSpentToday(), 10e6);
        assertEq(wallet.getRemainingDaily(), 40e6);
    }

    // ─── Owner Policy Changes ───

    function test_ownerRaisesLimits() public {
        vm.prank(human);
        wallet.setPolicy(500e6, 200e6);

        assertEq(wallet.getPolicy().dailyLimit, 500e6);
        assertEq(wallet.getPolicy().perTxLimit, 200e6);

        // Agent can now send 200 USDC in one tx
        vm.prank(agent);
        wallet.execute(recipient, 200e6, "");
    }

    function test_ownerLowersLimits() public {
        vm.prank(human);
        wallet.setPolicy(10e6, 5e6);

        vm.prank(agent);
        vm.expectRevert("AW: exceeds per-tx limit");
        wallet.execute(recipient, 6e6, "");
    }

    function test_zeroKeepsCurrent() public {
        vm.prank(human);
        wallet.setPolicy(0, 100e6); // only change perTx
        assertEq(wallet.getPolicy().dailyLimit, 50e6); // unchanged
        assertEq(wallet.getPolicy().perTxLimit, 100e6);
    }

    function test_nonOwnerCannotSetPolicy() public {
        vm.prank(agent);
        vm.expectRevert("AW: not owner");
        wallet.setPolicy(1000e6, 500e6);
    }

    // ─── Blacklist ───

    function test_blacklistBlocks() public {
        vm.prank(human);
        wallet.setBlacklist(recipient, true);

        vm.prank(agent);
        vm.expectRevert("AW: blacklisted");
        wallet.execute(recipient, 1e6, "");
    }

    function test_blacklistRemove() public {
        vm.prank(human);
        wallet.setBlacklist(recipient, true);

        vm.prank(human);
        wallet.setBlacklist(recipient, false);

        vm.prank(agent);
        wallet.execute(recipient, 1e6, ""); // works again
    }

    function test_blacklistBatch() public {
        address a = makeAddr("scam1");
        address b = makeAddr("scam2");
        address[] memory addrs = new address[](2);
        addrs[0] = a;
        addrs[1] = b;

        vm.prank(human);
        wallet.setBlacklistBatch(addrs, true);

        assertTrue(wallet.blacklisted(a));
        assertTrue(wallet.blacklisted(b));
    }

    function test_blacklistERC20() public {
        vm.prank(human);
        wallet.setBlacklist(recipient, true);

        vm.prank(agent);
        vm.expectRevert("AW: blacklisted");
        wallet.executeERC20(address(usdc), recipient, 1e6);
    }

    // ─── Pause ───

    function test_pauseBlocks() public {
        vm.prank(human);
        wallet.pause();

        vm.prank(agent);
        vm.expectRevert("AW: paused");
        wallet.execute(recipient, 1e6, "");
    }

    function test_unpauseResumes() public {
        vm.prank(human);
        wallet.pause();
        vm.prank(human);
        wallet.unpause();

        vm.prank(agent);
        wallet.execute(recipient, 1e6, "");
    }

    // ─── Agent Key Management ───

    function test_replaceAgent() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(human);
        wallet.setAgentKey(newAgent);

        assertEq(wallet.agentKey(), newAgent);

        // Old agent locked out
        vm.prank(agent);
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 1e6, "");

        // New agent works
        vm.prank(newAgent);
        wallet.execute(recipient, 1e6, "");
    }

    function test_revokeAgent() public {
        vm.prank(human);
        wallet.revokeAgentKey();
        assertEq(wallet.agentKey(), address(0));
    }

    // ─── Emergency Withdraw ───

    function test_emergencyWithdrawETH() public {
        uint256 before_ = human.balance;
        vm.prank(human);
        wallet.emergencyWithdraw(address(0), 0.5 ether);
        assertEq(human.balance, before_ + 0.5 ether);
    }

    function test_emergencyWithdrawERC20() public {
        vm.prank(human);
        wallet.emergencyWithdraw(address(usdc), 500e6);
        assertEq(usdc.balanceOf(human), 500e6);
    }

    // ─── Factory ───

    function test_walletSeededOnCreate() public {
        vm.deal(address(factory), 1 ether);
        address w2 = factory.createWallet(human, makeAddr("agent2"));
        assertEq(factory.gasSponsored(w2), 0.000028 ether);
        assertGe(w2.balance, 0.000028 ether);
    }

    function test_topUpGas() public {
        vm.deal(address(factory), 0);
        address w2 = factory.createWallet(human, makeAddr("agent3"));
        assertEq(factory.gasSponsored(w2), 0);

        vm.deal(address(factory), 1 ether);
        factory.topUpGas(w2);
        assertEq(factory.gasSponsored(w2), 0.000028 ether);
    }

    function test_gasCapEnforced() public {
        address w2 = factory.createWallet(human, makeAddr("agent4"));
        vm.deal(address(factory), 1 ether);
        vm.expectRevert("AWF: already seeded");
        factory.topUpGas(w2);
    }

    function test_batchTopUp() public {
        vm.deal(address(factory), 0);
        address w2 = factory.createWallet(human, makeAddr("agent5"));
        address w3 = factory.createWallet(human, makeAddr("agent6"));

        vm.deal(address(factory), 1 ether);
        address[] memory wallets_ = new address[](2);
        wallets_[0] = w2;
        wallets_[1] = w3;
        factory.batchTopUpGas(wallets_);

        assertEq(factory.gasSponsored(w2), 0.000028 ether);
        assertEq(factory.gasSponsored(w3), 0.000028 ether);
    }

    function test_setGasConfig() public {
        factory.setGasConfig(0.0001 ether);
        assertEq(factory.gasSeedAmount(), 0.0001 ether);
    }

    function test_factoryStats() public {
        assertEq(factory.totalWallets(), 1); // from setUp
        factory.createWallet(human, makeAddr("a2"));
        assertEq(factory.totalWallets(), 2);
    }

    // ─── Receive ETH ───

    function test_receiveETH() public {
        vm.deal(makeAddr("funder"), 1 ether);
        vm.prank(makeAddr("funder"));
        (bool ok, ) = address(wallet).call{value: 0.1 ether}("");
        assertTrue(ok);
    }
}
