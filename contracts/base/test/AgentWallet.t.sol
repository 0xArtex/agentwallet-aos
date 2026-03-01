// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AgentWallet} from "../src/AgentWallet.sol";
import {AgentWalletFactory} from "../src/AgentWalletFactory.sol";
import {IAgentWallet} from "../src/IAgentWallet.sol";
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
        usdc = new ERC20Mock("USDC", "USDC", 6);

        // Fund factory for gas seeding
        vm.deal(address(factory), 1 ether);

        // Deploy wallet (auto-seeded with gas)
        address w = factory.createWallet(human, agent);
        wallet = AgentWallet(payable(w));

        // Fund wallet with extra ETH and USDC
        vm.deal(address(wallet), 10 ether);
        usdc.mint(address(wallet), 1000e6); // 1000 USDC
    }

    // ─── Initialization ───

    function test_initialization() public view {
        assertEq(wallet.owner(), human);
        assertEq(wallet.agentKey(), agent);
        assertTrue(wallet.initialized());
    }

    function test_defaultPolicy() public view {
        IAgentWallet.Policy memory p = wallet.getPolicy();
        assertEq(p.dailyLimit, 50e6);      // 50 USDC
        assertEq(p.perTxLimit, 25e6);       // 25 USDC
        assertEq(p.approvalThreshold, 25e6); // 25 USDC
        assertFalse(p.paused);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert("AW: already initialized");
        wallet.initialize(human, agent);
    }

    // ─── Agent Transactions (within limits) ───

    function test_agentCanSendETH() public {
        uint256 before_ = recipient.balance;
        vm.prank(agent);
        uint256 txId = wallet.execute(recipient, 1e6, ""); // 1 USDC worth
        assertEq(txId, type(uint256).max); // executed immediately
        assertEq(recipient.balance, before_ + 1e6);
    }

    function test_agentCanSendERC20() public {
        vm.prank(agent);
        wallet.executeERC20(address(usdc), recipient, 10e6); // 10 USDC
        assertEq(usdc.balanceOf(recipient), 10e6);
    }

    function test_dailySpendTracking() public {
        vm.prank(agent);
        wallet.execute(recipient, 20e6, ""); // 20 USDC

        assertEq(wallet.getSpentToday(), 20e6);
        assertEq(wallet.getRemainingDaily(), 30e6); // 50 - 20
    }

    function test_dailyLimitResets() public {
        vm.prank(agent);
        wallet.execute(recipient, 20e6, "");

        // Warp forward 1 day
        vm.warp(block.timestamp + 86401);

        assertEq(wallet.getSpentToday(), 0);
        assertEq(wallet.getRemainingDaily(), 50e6);

        // Can spend again
        vm.prank(agent);
        wallet.execute(recipient, 20e6, "");
        assertEq(wallet.getSpentToday(), 20e6);
    }

    // ─── Policy Enforcement ───

    function test_rejectsOverPerTxLimit() public {
        vm.prank(agent);
        vm.expectRevert("AW: exceeds per-tx limit");
        wallet.execute(recipient, 30e6, ""); // 30 > 25 per-tx limit
    }

    function test_rejectsOverDailyLimit() public {
        // Spend 25 twice = 50 (at limit)
        vm.prank(agent);
        wallet.execute(recipient, 24e6, "");
        vm.prank(agent);
        wallet.execute(recipient, 24e6, "");

        // This should fail — 48 + 24 = 72 > 50
        vm.prank(agent);
        vm.expectRevert("AW: exceeds daily limit");
        wallet.execute(recipient, 24e6, "");
    }

    function test_queuesAboveApprovalThreshold() public {
        // Set approval threshold to 10 USDC, keep per-tx at 25
        vm.prank(human);
        wallet.setPolicy(0, 0, 10e6);

        // 15 USDC > 10 threshold → should queue
        vm.prank(agent);
        uint256 txId = wallet.execute{gas: 500000}(recipient, 15e6, "");
        assertEq(txId, 0); // first pending tx

        // Funds not sent yet
        assertEq(recipient.balance, 0);

        // Human approves
        vm.prank(human);
        wallet.approveTx(0);

        // Now funds sent
        assertEq(recipient.balance, 15e6);
    }

    // ─── Owner Controls ───

    function test_ownerCanUpdatePolicy() public {
        vm.prank(human);
        wallet.setPolicy(100e6, 50e6, 40e6);

        IAgentWallet.Policy memory p = wallet.getPolicy();
        assertEq(p.dailyLimit, 100e6);
        assertEq(p.perTxLimit, 50e6);
        assertEq(p.approvalThreshold, 40e6);
    }

    function test_ownerCanPause() public {
        vm.prank(human);
        wallet.pause();

        vm.prank(agent);
        vm.expectRevert("AW: paused");
        wallet.execute(recipient, 1e6, "");

        vm.prank(human);
        wallet.unpause();

        vm.prank(agent);
        wallet.execute(recipient, 1e6, "");
    }

    function test_ownerCanRevokeAgent() public {
        vm.prank(human);
        wallet.revokeAgentKey();

        assertEq(wallet.agentKey(), address(0));

        vm.prank(agent);
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 1e6, "");
    }

    function test_ownerCanReplaceAgent() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(human);
        wallet.setAgentKey(newAgent);

        assertEq(wallet.agentKey(), newAgent);

        // Old agent can't transact
        vm.prank(agent);
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 1e6, "");

        // New agent can
        vm.prank(newAgent);
        wallet.execute(recipient, 1e6, "");
    }

    function test_ownerCanCancelPendingTx() public {
        vm.prank(human);
        wallet.setPolicy(0, 0, 10e6);

        vm.prank(agent);
        wallet.execute{gas: 500000}(recipient, 15e6, "");

        vm.prank(human);
        wallet.cancelTx(0);

        IAgentWallet.PendingTx memory ptx = wallet.getPendingTx(0);
        assertTrue(ptx.cancelled);
    }

    function test_emergencyWithdrawETH() public {
        uint256 before_ = human.balance;
        vm.prank(human);
        wallet.emergencyWithdraw(address(0), 5 ether);
        assertEq(human.balance, before_ + 5 ether);
    }

    function test_emergencyWithdrawERC20() public {
        vm.prank(human);
        wallet.emergencyWithdraw(address(usdc), 500e6);
        assertEq(usdc.balanceOf(human), 500e6);
    }

    // ─── Access Control ───

    function test_onlyOwnerCanSetPolicy() public {
        vm.prank(agent);
        vm.expectRevert("AW: not owner");
        wallet.setPolicy(100e6, 50e6, 40e6);
    }

    function test_onlyAgentCanExecute() public {
        vm.prank(human);
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 1e6, "");
    }

    function test_randomCannotExecute() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 1e6, "");
    }

    // ─── Factory ───

    function test_factoryDeterministicAddress() public view {
        address predicted = factory.getAddress(human, agent, 0);
        assertEq(predicted, address(wallet));
    }

    function test_factoryTracksWallets() public view {
        assertEq(factory.totalWallets(), 1);
        assertTrue(factory.isWallet(address(wallet)));
    }

    function test_factoryMultipleWallets() public {
        address agent2 = makeAddr("agent2");
        factory.createWallet(human, agent2);
        assertEq(factory.totalWallets(), 2);
        assertEq(factory.walletCount(human), 2);
    }

    // ─── Gas Seeding ───

    function test_walletSeededOnCreate() public {
        vm.deal(address(factory), 1 ether);
        address w2 = factory.createWallet(human, makeAddr("agent2"));
        assertEq(factory.gasSponsored(w2), 0.000028 ether);
        assertGe(w2.balance, 0.000028 ether);
    }

    function test_topUpGas() public {
        // Create without factory balance (no auto-seed)
        vm.deal(address(factory), 0);
        address w2 = factory.createWallet(human, makeAddr("agent3"));
        assertEq(factory.gasSponsored(w2), 0);
        // Now fund and top up
        vm.deal(address(factory), 1 ether);
        factory.topUpGas(w2);
        assertEq(factory.gasSponsored(w2), 0.000028 ether);
    }

    function test_gasCapEnforced() public {
        address w2 = factory.createWallet(human, makeAddr("agent4"));
        vm.deal(address(factory), 1 ether);
        // Already seeded on creation — second topup should fail
        vm.expectRevert("AWF: already seeded");
        factory.topUpGas(w2);
    }

    function test_batchTopUp() public {
        // Create wallets without factory balance (no auto-seed)
        vm.deal(address(factory), 0);
        address w2 = factory.createWallet(human, makeAddr("agent5"));
        address w3 = factory.createWallet(human, makeAddr("agent6"));
        assertEq(factory.gasSponsored(w2), 0);
        assertEq(factory.gasSponsored(w3), 0);

        // Now fund factory and batch seed
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

    // ─── Pending Tx Expiry ───

    function test_pendingTxExpires() public {
        vm.prank(human);
        wallet.setPolicy(0, 0, 10e6);

        vm.prank(agent);
        wallet.execute{gas: 500000}(recipient, 15e6, "");

        // Warp past expiry (7 days)
        vm.warp(block.timestamp + 8 days);

        vm.prank(human);
        vm.expectRevert("AW: tx expired");
        wallet.approveTx(0);
    }
}
