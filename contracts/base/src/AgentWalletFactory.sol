// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentWallet} from "./AgentWallet.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title AgentWalletFactory
 * @notice Deploys minimal proxy (EIP-1167) AgentWallets.
 *
 * Uses CREATE2 for deterministic addresses — you can predict a wallet's
 * address before deployment using getAddress().
 *
 * Flow:
 * 1. Agent generates keypair locally (private key never leaves agent)
 * 2. Agent or human calls createWallet(owner, agentPubkey)
 * 3. Wallet is deployed with sensible default policies
 * 4. Agent starts transacting immediately
 */
contract AgentWalletFactory {
    using Clones for address;

    address public immutable implementation;
    address public admin;

    // Gas seeding config
    uint256 public gasSeedAmount = 0.001 ether;  // ~$2.50, covers ~2000 txs on Base
    uint256 public maxGasPerWallet = 0.004 ether; // lifetime cap per wallet (~$10)
    mapping(address => uint256) public gasSponsored; // total gas sent per wallet

    // wallet count per owner for salt uniqueness
    mapping(address => uint256) public walletCount;

    // track all deployed wallets
    mapping(address => bool) public isWallet;
    address[] public allWallets;

    event WalletCreated(
        address indexed wallet,
        address indexed owner,
        address indexed agent,
        uint256 index
    );
    event GasSeeded(address indexed wallet, uint256 amount);
    event GasToppedUp(address indexed wallet, uint256 amount);
    event GasConfigUpdated(uint256 seedAmount, uint256 maxPerWallet);

    modifier onlyAdmin() {
        require(msg.sender == admin, "AWF: not admin");
        _;
    }

    constructor() {
        implementation = address(new AgentWallet());
        admin = msg.sender;
    }

    /**
     * @notice Deploy a new AgentWallet with gas seeding.
     * @param owner_ The human owner address
     * @param agent_ The agent's public key (session key)
     * @return wallet The deployed wallet address
     */
    function createWallet(
        address owner_,
        address agent_
    ) external returns (address wallet) {
        uint256 idx = walletCount[owner_]++;
        bytes32 salt = keccak256(abi.encodePacked(owner_, agent_, idx));

        wallet = implementation.cloneDeterministic(salt);
        AgentWallet(payable(wallet)).initialize(owner_, agent_);

        isWallet[wallet] = true;
        allWallets.push(wallet);

        // Seed gas if factory has balance
        if (address(this).balance >= gasSeedAmount && gasSeedAmount > 0) {
            gasSponsored[wallet] += gasSeedAmount;
            (bool ok, ) = wallet.call{value: gasSeedAmount}("");
            if (ok) emit GasSeeded(wallet, gasSeedAmount);
        }

        emit WalletCreated(wallet, owner_, agent_, idx);
    }

    /**
     * @notice Top up gas for a wallet that's running low.
     * @dev Only admin. Respects lifetime cap per wallet.
     */
    function topUpGas(address wallet) external onlyAdmin {
        require(isWallet[wallet], "AWF: not a wallet");
        require(gasSponsored[wallet] + gasSeedAmount <= maxGasPerWallet, "AWF: gas cap reached");
        require(address(this).balance >= gasSeedAmount, "AWF: insufficient balance");

        gasSponsored[wallet] += gasSeedAmount;
        (bool ok, ) = wallet.call{value: gasSeedAmount}("");
        require(ok, "AWF: transfer failed");
        emit GasToppedUp(wallet, gasSeedAmount);
    }

    /**
     * @notice Batch top-up for multiple wallets running low.
     */
    function batchTopUpGas(address[] calldata wallets) external onlyAdmin {
        for (uint256 i = 0; i < wallets.length; i++) {
            address w = wallets[i];
            if (!isWallet[w]) continue;
            if (gasSponsored[w] + gasSeedAmount > maxGasPerWallet) continue;
            if (address(this).balance < gasSeedAmount) break;

            gasSponsored[w] += gasSeedAmount;
            (bool ok, ) = w.call{value: gasSeedAmount}("");
            if (ok) emit GasToppedUp(w, gasSeedAmount);
        }
    }

    /**
     * @notice Update gas seeding config. Only admin.
     */
    function setGasConfig(uint256 seedAmount, uint256 maxPerWallet) external onlyAdmin {
        gasSeedAmount = seedAmount;
        maxGasPerWallet = maxPerWallet;
        emit GasConfigUpdated(seedAmount, maxPerWallet);
    }

    /**
     * @notice Transfer admin role.
     */
    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "AWF: zero admin");
        admin = newAdmin;
    }

    /**
     * @notice Withdraw excess ETH from the factory. Only admin.
     */
    function withdrawGas(uint256 amount) external onlyAdmin {
        (bool ok, ) = admin.call{value: amount}("");
        require(ok, "AWF: withdraw failed");
    }

    /**
     * @notice Predict wallet address before deployment.
     * @dev Uses the same salt formula as createWallet.
     */
    function getAddress(
        address owner_,
        address agent_,
        uint256 index
    ) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(owner_, agent_, index));
        return implementation.predictDeterministicAddress(salt);
    }

    /**
     * @notice Get total wallets deployed.
     */
    function totalWallets() external view returns (uint256) {
        return allWallets.length;
    }

    /**
     * @notice Get all wallets for pagination.
     */
    function getWallets(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 end = offset + limit;
        if (end > allWallets.length) end = allWallets.length;
        if (offset >= end) return new address[](0);

        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allWallets[i];
        }
        return result;
    }

    /**
     * @notice Fund the factory's gas treasury.
     */
    receive() external payable {}
}
