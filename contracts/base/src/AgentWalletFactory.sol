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

    constructor() {
        implementation = address(new AgentWallet());
    }

    /**
     * @notice Deploy a new AgentWallet.
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

        emit WalletCreated(wallet, owner_, agent_, idx);
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
}
