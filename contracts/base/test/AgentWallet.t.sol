// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AgentWallet} from "../src/AgentWallet.sol";
import {AgentWalletFactory} from "../src/AgentWalletFactory.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";
import {MockOracle} from "./mocks/MockOracle.sol";

contract AgentWalletTest is Test {
    AgentWalletFactory factory;
    AgentWallet wallet;
    ERC20Mock usdc;
    ERC20Mock shitcoin;
    MockOracle oracle;

    address human = makeAddr("human");
    address agent = makeAddr("agent");
    address recipient = makeAddr("recipient");

    // ETH price = $2500 (8 decimals like Chainlink)
    int256 constant ETH_PRICE = 2500e8;

    function setUp() public {
        factory = new AgentWalletFactory();
        vm.deal(address(factory), 1 ether);

        address w = factory.createWallet(human, agent);
        wallet = AgentWallet(payable(w));

        usdc = new ERC20Mock("USDC", "USDC", 6);
        shitcoin = new ERC20Mock("SHITCOIN", "SHIT", 18);
        oracle = new MockOracle(ETH_PRICE, 8);

        usdc.mint(address(wallet), 1000e6);
        shitcoin.mint(address(wallet), 1000000e18);
        vm.deal(address(wallet), 10 ether);

        // Set oracle + USDC address
        vm.prank(human);
        wallet.setOracle(address(oracle), address(usdc));
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
        assertEq(daily, 50e6);  // $50
        assertEq(perTx, 25e6);  // $25
        assertFalse(paused);
    }

    function test_oracleSet() public view {
        assertEq(wallet.ethUsdOracle(), address(oracle));
        assertEq(wallet.usdcAddress(), address(usdc));
    }

    function test_cannotSetOracleTwice() public {
        vm.prank(human);
        vm.expectRevert("AW: oracle already set");
        wallet.setOracle(address(oracle), address(usdc));
    }

    // ─── ETH with Oracle ───

    function test_ethConvertedToUsd() public view {
        // ETH price = $2500, so getEthPrice should return 2500e6
        uint256 price = wallet.getEthPrice();
        assertEq(price, 2500e6);
    }

    function test_agentSendsSmallEthOk() public {
        // $25 limit, ETH=$2500 → 0.01 ETH = $25 exactly
        uint256 before_ = recipient.balance;
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        assertEq(recipient.balance, before_ + 0.01 ether);
    }

    function test_ethExceedsPerTxLimit() public {
        // 0.011 ETH = $27.50 > $25 per-tx limit
        vm.prank(agent);
        vm.expectRevert("AW: exceeds per-tx limit");
        wallet.execute(recipient, 0.011 ether, "");
    }

    function test_ethExceedsDailyLimit() public {
        // 0.01 ETH = $25 x2 = $50 daily limit hit
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        // Third should fail
        vm.prank(agent);
        vm.expectRevert("AW: exceeds daily limit");
        wallet.execute(recipient, 0.001 ether, "");
    }

    function test_tinyEthWorks() public {
        // 0.0000001 ETH = $0.00025 → well under limits
        vm.prank(agent);
        wallet.execute(recipient, 0.0000001 ether, "");
    }

    // ─── USDC tracked against same USD limits ───

    function test_usdcTrackedAgainstUsdLimits() public {
        vm.prank(agent);
        wallet.executeERC20(address(usdc), recipient, 20e6); // $20
        assertEq(wallet.getSpentToday(), 20e6);
    }

    function test_usdcExceedsPerTxLimit() public {
        vm.prank(agent);
        vm.expectRevert("AW: exceeds per-tx limit");
        wallet.executeERC20(address(usdc), recipient, 26e6); // $26 > $25
    }

    // ─── Aggregated ETH + USDC daily limit ───

    function test_ethAndUsdcShareDailyLimit() public {
        // Spend $25 in ETH (0.01 ETH)
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        assertEq(wallet.getSpentToday(), 25e6);

        // Spend $25 in USDC
        vm.prank(agent);
        wallet.executeERC20(address(usdc), recipient, 25e6);
        assertEq(wallet.getSpentToday(), 50e6);

        // Now daily is exhausted — any ETH or USDC should fail
        vm.prank(agent);
        vm.expectRevert("AW: exceeds daily limit");
        wallet.execute(recipient, 0.001 ether, "");

        vm.prank(agent);
        vm.expectRevert("AW: exceeds daily limit");
        wallet.executeERC20(address(usdc), recipient, 1e6);
    }

    function test_dailyLimitResetsAfter24h() public {
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        // Daily exhausted — warp and refresh oracle
        vm.warp(block.timestamp + 86401);
        oracle.setPrice(ETH_PRICE); // refreshes updatedAt
        // Should work again
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
    }

    // ─── Other ERC-20s: unlimited by default ───

    function test_shitcoinUnlimitedByDefault() public {
        // No limit set → should work with any amount
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500000e18);
        assertEq(shitcoin.balanceOf(recipient), 500000e18);
    }

    function test_shitcoinDoesNotAffectUsdLimits() public {
        // Shitcoin transfer should NOT touch USD daily tracking
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 100000e18);
        assertEq(wallet.getSpentToday(), 0); // USD spend untouched
    }

    // ─── Per-token limits ───

    function test_setTokenLimit() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);

        (uint256 daily, uint256 perTx, bool active) = (
            wallet.getTokenLimit(address(shitcoin)).dailyLimit,
            wallet.getTokenLimit(address(shitcoin)).perTxLimit,
            wallet.getTokenLimit(address(shitcoin)).active
        );
        assertEq(daily, 1000e18);
        assertEq(perTx, 500e18);
        assertTrue(active);
    }

    function test_tokenLimitEnforced() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);

        // Under limit → ok
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 400e18);

        // Over per-tx → revert
        vm.prank(agent);
        vm.expectRevert("AW: exceeds token per-tx limit");
        wallet.executeERC20(address(shitcoin), recipient, 501e18);
    }

    function test_tokenDailyLimitEnforced() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);

        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500e18);
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500e18);

        // Daily exhausted
        vm.prank(agent);
        vm.expectRevert("AW: exceeds token daily limit");
        wallet.executeERC20(address(shitcoin), recipient, 1e18);
    }

    function test_tokenDailyResetsAfter24h() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);

        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500e18);
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500e18);

        vm.warp(block.timestamp + 86401);
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500e18); // works again
    }

    function test_removeTokenLimit() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 100e18, 50e18);

        // Limited
        vm.prank(agent);
        vm.expectRevert("AW: exceeds token per-tx limit");
        wallet.executeERC20(address(shitcoin), recipient, 51e18);

        // Remove limit
        vm.prank(human);
        wallet.removeTokenLimit(address(shitcoin));

        // Unlimited again
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 100000e18);
    }

    function test_tokenLimitIndependentOfUsd() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);

        // Spend max shitcoin
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 500e18);

        // USD limit still untouched
        assertEq(wallet.getSpentToday(), 0);

        // Can still spend ETH/USDC
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, "");
        assertEq(wallet.getSpentToday(), 25e6);
    }

    // ─── Oracle edge cases ───

    function test_staleOracleReverts() public {
        vm.warp(10000); // ensure timestamp > staleness threshold
        oracle.setStale(7200); // 2 hours ago
        vm.prank(agent);
        vm.expectRevert("AW: stale oracle");
        wallet.execute(recipient, 0.001 ether, "");
    }

    function test_ethPriceChangeAffectsLimits() public {
        // ETH at $5000 → 0.005 ETH = $25
        oracle.setPrice(5000e8);
        vm.prank(agent);
        wallet.execute(recipient, 0.005 ether, "");
        assertEq(wallet.getSpentToday(), 25e6);

        // 0.006 ETH at $5000 = $30 > $25 per-tx
        vm.prank(agent);
        vm.expectRevert("AW: exceeds per-tx limit");
        wallet.execute(recipient, 0.006 ether, "");
    }

    // ─── No oracle (legacy behavior) ───

    function test_noOracleFallsBackToRawValue() public {
        // Create a wallet without oracle
        address w2 = factory.createWallet(human, agent);
        AgentWallet wallet2 = AgentWallet(payable(w2));
        vm.deal(address(wallet2), 1 ether);

        // No oracle set → raw value tracked (legacy)
        vm.prank(agent);
        wallet2.execute(recipient, 25e6, ""); // raw 25e6 wei
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

    function test_nonOwnerCannotSetTokenLimit() public {
        vm.prank(agent);
        vm.expectRevert("AW: not owner");
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);
    }

    // ─── Blacklist ───

    function test_blacklistBlocks() public {
        vm.prank(human);
        wallet.setBlacklist(recipient, true);
        vm.prank(agent);
        vm.expectRevert("AW: blacklisted");
        wallet.execute(recipient, 0.001 ether, "");
    }

    function test_blacklistRemove() public {
        vm.prank(human);
        wallet.setBlacklist(recipient, true);
        vm.prank(human);
        wallet.setBlacklist(recipient, false);
        vm.prank(agent);
        wallet.execute(recipient, 0.001 ether, "");
    }

    // ─── Pause ───

    function test_pauseBlocks() public {
        vm.prank(human);
        wallet.pause();
        vm.prank(agent);
        vm.expectRevert("AW: paused");
        wallet.execute(recipient, 0.001 ether, "");
    }

    function test_unpauseResumes() public {
        vm.prank(human);
        wallet.pause();
        vm.prank(human);
        wallet.unpause();
        vm.prank(agent);
        wallet.execute(recipient, 0.001 ether, "");
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

    // ─── Factory ───

    function test_createManagedWallet() public {
        address w = factory.createManagedWallet(makeAddr("agent2"));
        AgentWallet mw = AgentWallet(payable(w));
        assertEq(mw.owner(), address(this));
        assertEq(mw.agentKey(), makeAddr("agent2"));
    }

    function test_createUnmanagedWallet() public {
        address agentAddr = makeAddr("solo");
        address w = factory.createUnmanagedWallet(agentAddr);
        AgentWallet uw = AgentWallet(payable(w));
        assertEq(uw.owner(), agentAddr);
        assertEq(uw.agentKey(), agentAddr);
        vm.prank(agentAddr);
        uw.setPolicy(type(uint256).max, type(uint256).max);
    }

    function test_registerPasskey() public {
        address w = factory.createManagedWallet(makeAddr("agent3"));
        AgentWallet mw = AgentWallet(payable(w));
        bytes32 pkX = bytes32(uint256(1234));
        bytes32 pkY = bytes32(uint256(5678));
        mw.registerPasskey(pkX, pkY);
        assertTrue(mw.isPasskeyOwner());
        assertEq(mw.owner(), address(0));
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

    function test_factoryStats() public {
        assertEq(factory.totalWallets(), 1);
        factory.createWallet(human, makeAddr("a5"));
        factory.createManagedWallet(makeAddr("a6"));
        factory.createUnmanagedWallet(makeAddr("a7"));
        assertEq(factory.totalWallets(), 4);
    }

    function test_receiveETH() public {
        vm.deal(makeAddr("funder"), 1 ether);
        vm.prank(makeAddr("funder"));
        (bool ok, ) = address(wallet).call{value: 0.1 ether}("");
        assertTrue(ok);
    }

    function test_randomCannotExecute() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert("AW: not agent");
        wallet.execute(recipient, 0.001 ether, "");
    }

    // ─── View helpers ───

    function test_getTokenSpentToday() public {
        vm.prank(human);
        wallet.setTokenLimit(address(shitcoin), 1000e18, 500e18);
        
        vm.prank(agent);
        wallet.executeERC20(address(shitcoin), recipient, 300e18);
        
        assertEq(wallet.getTokenSpentToday(address(shitcoin)), 300e18);
    }

    function test_getRemainingDaily() public {
        vm.prank(agent);
        wallet.execute(recipient, 0.01 ether, ""); // $25
        assertEq(wallet.getRemainingDaily(), 25e6);
    }
}
