// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentWallet} from "./IAgentWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PasskeyVerifier} from "./PasskeyVerifier.sol";

/**
 * @title AgentWallet
 * @notice Non-custodial smart wallet for AI agents.
 *
 * Two owner modes:
 * 1. Passkey (managed) — human controls via FaceID/YubiKey/Ledger, P-256 on-chain verification
 * 2. EOA (self-custody) — human controls via Ethereum wallet (legacy mode)
 *
 * Agent operates within hard limits. All txs execute instantly or revert.
 * No approval queues. Passkey signatures verified on-chain via RIP-7212.
 */
contract AgentWallet is IAgentWallet, ReentrancyGuard {

    uint256 private constant DEFAULT_DAILY_LIMIT = 50e6;
    uint256 private constant DEFAULT_PER_TX_LIMIT = 25e6;
    uint256 private constant DAY = 86400;

    // ─── State ───
    address public override owner;        // EOA owner (address(0) if passkey mode)
    address public override agentKey;

    // Passkey owner (P-256 public key)
    bytes32 public passkeyX;
    bytes32 public passkeyY;
    bool public isPasskeyOwner;

    // Nonce for passkey replay protection
    uint256 public passkeyNonce;

    Policy private _policy;
    bool public initialized;

    uint256 private _dayStart;
    uint256 private _spentToday;

    mapping(address => bool) public blacklisted;

    // ─── Modifiers ───
    modifier onlyOwner() {
        require(msg.sender == owner && owner != address(0), "AW: not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agentKey, "AW: not agent");
        _;
    }

    modifier whenNotPaused() {
        require(!_policy.paused, "AW: paused");
        _;
    }

    // ─── Initialization ───

    /**
     * @notice Initialize with EOA owner (legacy mode).
     */
    function initialize(address _owner, address _agent) external {
        require(!initialized, "AW: already initialized");
        require(_owner != address(0), "AW: zero owner");
        require(_agent != address(0), "AW: zero agent");

        initialized = true;
        owner = _owner;
        agentKey = _agent;
        isPasskeyOwner = false;

        _policy = Policy({
            dailyLimit: DEFAULT_DAILY_LIMIT,
            perTxLimit: DEFAULT_PER_TX_LIMIT,
            paused: false
        });
        _dayStart = block.timestamp;
    }

    /**
     * @notice Initialize with passkey owner (managed mode).
     * @dev Called when human registers their passkey via the setup page.
     */
    function initializeWithPasskey(
        bytes32 _passkeyX,
        bytes32 _passkeyY,
        address _agent
    ) external {
        require(!initialized, "AW: already initialized");
        require(_passkeyX != bytes32(0) && _passkeyY != bytes32(0), "AW: zero passkey");
        require(_agent != address(0), "AW: zero agent");

        initialized = true;
        passkeyX = _passkeyX;
        passkeyY = _passkeyY;
        agentKey = _agent;
        isPasskeyOwner = true;
        owner = address(0); // no EOA owner

        _policy = Policy({
            dailyLimit: DEFAULT_DAILY_LIMIT,
            perTxLimit: DEFAULT_PER_TX_LIMIT,
            paused: false
        });
        _dayStart = block.timestamp;
    }

    /**
     * @notice Register passkey after wallet creation (for setup-link flow).
     * @dev Only callable once, only if passkey not yet set, by the factory/admin.
     */
    function registerPasskey(
        bytes32 _passkeyX,
        bytes32 _passkeyY
    ) external {
        require(initialized, "AW: not initialized");
        require(!isPasskeyOwner, "AW: passkey already set");
        require(owner == msg.sender || owner == address(0), "AW: unauthorized");
        require(_passkeyX != bytes32(0) && _passkeyY != bytes32(0), "AW: zero passkey");

        passkeyX = _passkeyX;
        passkeyY = _passkeyY;
        isPasskeyOwner = true;
        owner = address(0); // transfer ownership to passkey

        emit PasskeyRegistered(_passkeyX, _passkeyY);
    }

    // ─── Passkey-Authenticated Owner Actions ───

    /**
     * @notice Update policy via passkey signature.
     * @param dailyLimit New daily limit (0 = keep current)
     * @param perTxLimit New per-tx limit (0 = keep current)
     * @param authenticatorData WebAuthn authenticator data
     * @param clientDataJSON WebAuthn client data JSON (contains challenge)
     * @param r Signature r
     * @param s Signature s
     */
    function setPolicyWithPasskey(
        uint256 dailyLimit,
        uint256 perTxLimit,
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        if (dailyLimit > 0) _policy.dailyLimit = dailyLimit;
        if (perTxLimit > 0) _policy.perTxLimit = perTxLimit;
        emit PolicyUpdated(_policy.dailyLimit, _policy.perTxLimit);
    }

    function pauseWithPasskey(
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        _policy.paused = true;
        emit Paused(address(this));
    }

    function unpauseWithPasskey(
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        _policy.paused = false;
        emit Unpaused(address(this));
    }

    function setBlacklistWithPasskey(
        address addr,
        bool blocked,
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        blacklisted[addr] = blocked;
        emit BlacklistUpdated(addr, blocked);
    }

    function setAgentKeyWithPasskey(
        address newAgent,
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        require(newAgent != address(0), "AW: zero agent");
        emit AgentKeySet(agentKey, newAgent);
        agentKey = newAgent;
    }

    function emergencyWithdrawWithPasskey(
        address token,
        uint256 amount,
        address recipient,
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        require(recipient != address(0), "AW: zero recipient");
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "AW: eth transfer failed");
        } else {
            require(IERC20(token).transfer(recipient, amount), "AW: transfer failed");
        }
    }

    // ─── EOA Owner Actions (legacy mode) ───

    function setPolicy(uint256 dailyLimit, uint256 perTxLimit) external onlyOwner {
        if (dailyLimit > 0) _policy.dailyLimit = dailyLimit;
        if (perTxLimit > 0) _policy.perTxLimit = perTxLimit;
        emit PolicyUpdated(_policy.dailyLimit, _policy.perTxLimit);
    }

    function setAgentKey(address newAgent) external onlyOwner {
        require(newAgent != address(0), "AW: zero agent");
        emit AgentKeySet(agentKey, newAgent);
        agentKey = newAgent;
    }

    function revokeAgentKey() external onlyOwner {
        emit AgentKeyRevoked(agentKey);
        agentKey = address(0);
    }

    function pause() external onlyOwner {
        _policy.paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        _policy.paused = false;
        emit Unpaused(msg.sender);
    }

    function setBlacklist(address addr, bool blocked) external onlyOwner {
        blacklisted[addr] = blocked;
        emit BlacklistUpdated(addr, blocked);
    }

    function setBlacklistBatch(address[] calldata addrs, bool blocked) external onlyOwner {
        for (uint256 i = 0; i < addrs.length; i++) {
            blacklisted[addrs[i]] = blocked;
            emit BlacklistUpdated(addrs[i], blocked);
        }
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) {
            (bool ok, ) = owner.call{value: amount}("");
            require(ok, "AW: eth transfer failed");
        } else {
            require(IERC20(token).transfer(owner, amount), "AW: transfer failed");
        }
    }

    // ─── Agent Functions ───

    function execute(
        address to,
        uint256 amount,
        bytes calldata data
    ) external onlyAgent whenNotPaused nonReentrant {
        require(to != address(0), "AW: zero address");
        require(!blacklisted[to], "AW: blacklisted");
        require(amount <= _policy.perTxLimit, "AW: exceeds per-tx limit");

        if (block.timestamp >= _dayStart + DAY) {
            _dayStart = block.timestamp;
            _spentToday = 0;
        }

        require(_spentToday + amount <= _policy.dailyLimit, "AW: exceeds daily limit");
        _spentToday += amount;

        if (data.length == 0) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "AW: transfer failed");
        } else {
            (bool ok, ) = to.call{value: amount}(data);
            require(ok, "AW: call failed");
        }

        emit TransactionExecuted(to, amount, block.timestamp);
    }

    function executeERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyAgent whenNotPaused nonReentrant {
        require(to != address(0), "AW: zero address");
        require(!blacklisted[to], "AW: blacklisted");
        require(amount <= _policy.perTxLimit, "AW: exceeds per-tx limit");

        if (block.timestamp >= _dayStart + DAY) {
            _dayStart = block.timestamp;
            _spentToday = 0;
        }

        require(_spentToday + amount <= _policy.dailyLimit, "AW: exceeds daily limit");
        _spentToday += amount;

        require(IERC20(token).transfer(to, amount), "AW: transfer failed");
        emit TransactionExecuted(to, amount, block.timestamp);
    }

    // ─── View Functions ───

    function getPolicy() external view override returns (Policy memory) {
        return _policy;
    }

    function getSpentToday() external view override returns (uint256) {
        if (block.timestamp >= _dayStart + DAY) return 0;
        return _spentToday;
    }

    function getRemainingDaily() external view override returns (uint256) {
        uint256 spent = block.timestamp >= _dayStart + DAY ? 0 : _spentToday;
        if (spent >= _policy.dailyLimit) return 0;
        return _policy.dailyLimit - spent;
    }

    function getPasskey() external view returns (bytes32 x, bytes32 y) {
        return (passkeyX, passkeyY);
    }

    // ─── Internal ───

    function _verifyPasskey(
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s
    ) internal {
        require(isPasskeyOwner, "AW: not passkey mode");
        require(
            PasskeyVerifier.verifyWebAuthn(
                authenticatorData,
                clientDataJSON,
                r, s,
                passkeyX,
                passkeyY
            ),
            "AW: invalid passkey signature"
        );
        passkeyNonce++;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
