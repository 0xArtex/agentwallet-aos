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
        assertFalse(wallet.isPasskeyOwner());
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
        vm.warp(block.timestamp + 86401);
        vm.prank(agent);
        wallet.execute(recipient, 25e6, "");
    }

    // ─── Owner Controls ───

    function test_ownerRaisesLimits() public {
        vm.prank(human);
        wallet.setPolicy(500e6, 200e6);
        assertEq(wallet.getPolicy().dailyLimit, 500e6);
        assertEq(wallet.getPolicy().perTxLimit, 200e6);
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
        wallet.execute(recipient, 1e6, "");
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

    // ─── Agent Key ───

    function test_replaceAgent() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(human);
        wallet.setAgentKey(newAgent);
        assertEq(wallet.agentKey(), newAgent);
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

    // ─── Factory: Managed Wallet ───

    function test_createManagedWallet() public {
        address w = factory.createManagedWallet(makeAddr("agent2"));
        AgentWallet mw = AgentWallet(payable(w));
        // Admin is temp owner
        assertEq(mw.owner(), address(this));
        assertEq(mw.agentKey(), makeAddr("agent2"));
        assertFalse(mw.isPasskeyOwner());
    }

    // ─── Factory: Unmanaged Wallet ───

    function test_createUnmanagedWallet() public {
        address agentAddr = makeAddr("solo");
        address w = factory.createUnmanagedWallet(agentAddr);
        AgentWallet uw = AgentWallet(payable(w));
        // Agent is its own owner
        assertEq(uw.owner(), agentAddr);
        assertEq(uw.agentKey(), agentAddr);
        // Agent can change its own policy
        vm.prank(agentAddr);
        uw.setPolicy(type(uint256).max, type(uint256).max);
        assertEq(uw.getPolicy().dailyLimit, type(uint256).max);
    }

    // ─── Passkey Registration ───

    function test_registerPasskey() public {
        address w = factory.createManagedWallet(makeAddr("agent3"));
        AgentWallet mw = AgentWallet(payable(w));
        
        bytes32 pkX = bytes32(uint256(1234));
        bytes32 pkY = bytes32(uint256(5678));
        
        // Admin (temp owner) registers passkey
        mw.registerPasskey(pkX, pkY);
        
        assertTrue(mw.isPasskeyOwner());
        assertEq(mw.owner(), address(0)); // EOA owner cleared
        (bytes32 x, bytes32 y) = mw.getPasskey();
        assertEq(x, pkX);
        assertEq(y, pkY);
    }

    function test_cannotRegisterPasskeyTwice() public {
        address w = factory.createManagedWallet(makeAddr("agent4"));
        AgentWallet mw = AgentWallet(payable(w));
        
        mw.registerPasskey(bytes32(uint256(1)), bytes32(uint256(2)));
        
        vm.expectRevert("AW: passkey already set");
        mw.registerPasskey(bytes32(uint256(3)), bytes32(uint256(4)));
    }

    // ─── Factory Gas ───

    function test_walletSeededOnCreate() public {
        vm.deal(address(factory), 1 ether);
        address w2 = factory.createWallet(human, makeAddr("a2"));
        assertEq(factory.gasSponsored(w2), 0.000028 ether);
    }

    function test_managedWalletSeeded() public {
        vm.deal(address(factory), 1 ether);
        address w = factory.createManagedWallet(makeAddr("a3"));
        assertEq(factory.gasSponsored(w), 0.000028 ether);
    }

    function test_unmanagedWalletSeeded() public {
        vm.deal(address(factory), 1 ether);
        address w = factory.createUnmanagedWallet(makeAddr("a4"));
        assertEq(factory.gasSponsored(w), 0.000028 ether);
    }

    function test_factoryStats() public {
        assertEq(factory.totalWallets(), 1);
        factory.createWallet(human, makeAddr("a5"));
        factory.createManagedWallet(makeAddr("a6"));
        factory.createUnmanagedWallet(makeAddr("a7"));
        assertEq(factory.totalWallets(), 4);
    }

    function test_setGasConfig() public {
        factory.setGasConfig(0.0001 ether);
        assertEq(factory.gasSeedAmount(), 0.0001 ether);
    }

    function test_receiveETH() public {
        vm.deal(makeAddr("funder"), 1 ether);
        vm.prank(makeAddr("funder"));
        (bool ok, ) = address(wallet).call{value: 0.1 ether}("");
        assertTrue(ok);
    }
}
