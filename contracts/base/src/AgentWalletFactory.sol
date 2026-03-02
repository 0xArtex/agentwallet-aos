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
    uint256 public gasSeedAmount = 0.000028 ether;  // ~$0.07 total per wallet
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
     * @notice Deploy a managed wallet (passkey owner, set up later via link).
     * @dev Initializes with admin as temporary owner. Human registers passkey via setup page.
     * @param agent_ The agent's public key
     * @return wallet The deployed wallet address
     */
    function createManagedWallet(
        address agent_
    ) external returns (address wallet) {
        uint256 idx = walletCount[admin]++;
        bytes32 salt = keccak256(abi.encodePacked(admin, agent_, idx));

        wallet = implementation.cloneDeterministic(salt);
        // Initialize with admin as temp owner — passkey registered later via setup link
        AgentWallet(payable(wallet)).initialize(admin, agent_);

        isWallet[wallet] = true;
        allWallets.push(wallet);

        _seedGas(wallet);
        emit WalletCreated(wallet, admin, agent_, idx);
    }

    /**
     * @notice Deploy a wallet with EOA owner (self-custody mode).
     * @param owner_ The human owner address
     * @param agent_ The agent's public key
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

        _seedGas(wallet);
        emit WalletCreated(wallet, owner_, agent_, idx);
    }

    /**
     * @notice Deploy an unmanaged wallet (no owner, no limits, agent has full control).
     * @param agent_ The agent's address (becomes both owner and agent)
     * @return wallet The deployed wallet address
     */
    function createUnmanagedWallet(
        address agent_
    ) external returns (address wallet) {
        uint256 idx = walletCount[agent_]++;
        bytes32 salt = keccak256(abi.encodePacked(agent_, agent_, idx));

        wallet = implementation.cloneDeterministic(salt);
        // Agent is its own owner — can change any policy itself
        AgentWallet(payable(wallet)).initialize(agent_, agent_);

        isWallet[wallet] = true;
        allWallets.push(wallet);

        _seedGas(wallet);
        emit WalletCreated(wallet, agent_, agent_, idx);
    }

    function _seedGas(address wallet) internal {
        if (address(this).balance >= gasSeedAmount && gasSeedAmount > 0) {
            gasSponsored[wallet] += gasSeedAmount;
            (bool ok, ) = wallet.call{value: gasSeedAmount}("");
            if (ok) emit GasSeeded(wallet, gasSeedAmount);
        }
    }

    /**
     * @notice Top up gas for a wallet that's running low.
     * @dev Only admin. One-time seed only (no repeated top-ups).
     */
    function topUpGas(address wallet) external onlyAdmin {
        require(isWallet[wallet], "AWF: not a wallet");
        require(gasSponsored[wallet] == 0, "AWF: already seeded");
        require(address(this).balance >= gasSeedAmount, "AWF: insufficient balance");

        gasSponsored[wallet] += gasSeedAmount;
        (bool ok, ) = wallet.call{value: gasSeedAmount}("");
        require(ok, "AWF: transfer failed");
        emit GasToppedUp(wallet, gasSeedAmount);
    }

    /**
     * @notice Batch seed gas for wallets that haven't been seeded yet.
     */
    function batchTopUpGas(address[] calldata wallets) external onlyAdmin {
        for (uint256 i = 0; i < wallets.length; i++) {
            address w = wallets[i];
            if (!isWallet[w]) continue;
            if (gasSponsored[w] > 0) continue;
            if (address(this).balance < gasSeedAmount) break;

            gasSponsored[w] += gasSeedAmount;
            (bool ok, ) = w.call{value: gasSeedAmount}("");
            if (ok) emit GasToppedUp(w, gasSeedAmount);
        }
    }

    /**
     * @notice Update gas seed amount. Only admin.
     */
    function setGasConfig(uint256 seedAmount) external onlyAdmin {
        gasSeedAmount = seedAmount;
        emit GasConfigUpdated(seedAmount, 0);
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
