// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentWallet} from "./IAgentWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentWallet
 * @notice Non-custodial smart wallet for AI agents with on-chain policy enforcement.
 *
 * Key properties:
 * - Owner (human) sets policies and can revoke agent access
 * - Agent (session key) operates within policy bounds
 * - Sensible defaults so agents work from second zero
 * - Provider NEVER has access to keys or funds
 *
 * Default policy (set at deployment):
 * - Daily limit:         50 USDC
 * - Per-tx limit:        25 USDC
 * - Approval threshold:  25 USDC (above this → queued for human)
 */
contract AgentWallet is IAgentWallet, ReentrancyGuard {

    // ─── Constants ───
    uint256 private constant DEFAULT_DAILY_LIMIT = 50e6;        // 50 USDC (6 decimals)
    uint256 private constant DEFAULT_PER_TX_LIMIT = 25e6;       // 25 USDC
    uint256 private constant DEFAULT_APPROVAL_THRESHOLD = 25e6; // 25 USDC
    uint256 private constant DAY = 86400;
    uint256 private constant PENDING_TX_EXPIRY = 7 days;

    // ─── State ───
    address public override owner;
    address public override agentKey;

    Policy private _policy;
    bool public initialized;

    // Daily spend tracking (rolling 24h window)
    uint256 private _dayStart;
    uint256 private _spentToday;

    // Pending transactions (need human approval)
    PendingTx[] private _pendingTxs;

    // ─── Modifiers ───
    modifier onlyOwner() {
        require(msg.sender == owner, "AW: not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agentKey, "AW: not agent");
        _;
    }

    modifier onlyOwnerOrAgent() {
        require(msg.sender == owner || msg.sender == agentKey, "AW: unauthorized");
        _;
    }

    modifier whenNotPaused() {
        require(!_policy.paused, "AW: paused");
        _;
    }

    // ─── Initialization ───

    /**
     * @notice Initialize the wallet. Can only be called once.
     * @param _owner The human owner address
     * @param _agent The agent's session key address
     */
    function initialize(address _owner, address _agent) external {
        require(!initialized, "AW: already initialized");
        require(_owner != address(0), "AW: zero owner");
        require(_agent != address(0), "AW: zero agent");

        initialized = true;
        owner = _owner;
        agentKey = _agent;

        // Sensible defaults — agent is functional immediately
        _policy = Policy({
            dailyLimit: DEFAULT_DAILY_LIMIT,
            perTxLimit: DEFAULT_PER_TX_LIMIT,
            approvalThreshold: DEFAULT_APPROVAL_THRESHOLD,
            paused: false
        });

        _dayStart = block.timestamp;
        _spentToday = 0;
    }

    // ─── Owner Functions ───

    /**
     * @notice Update spending policies. Only owner.
     * @dev Pass 0 for any param to keep current value.
     */
    function setPolicy(
        uint256 dailyLimit,
        uint256 perTxLimit,
        uint256 approvalThreshold
    ) external onlyOwner {
        if (dailyLimit > 0) _policy.dailyLimit = dailyLimit;
        if (perTxLimit > 0) _policy.perTxLimit = perTxLimit;
        if (approvalThreshold > 0) _policy.approvalThreshold = approvalThreshold;
        emit PolicyUpdated(_policy.dailyLimit, _policy.perTxLimit, _policy.approvalThreshold);
    }

    /**
     * @notice Replace the agent key. Only owner.
     */
    function setAgentKey(address newAgent) external onlyOwner {
        require(newAgent != address(0), "AW: zero agent");
        emit AgentKeySet(agentKey, newAgent);
        agentKey = newAgent;
    }

    /**
     * @notice Revoke agent access entirely. Only owner.
     */
    function revokeAgentKey() external onlyOwner {
        emit AgentKeyRevoked(agentKey);
        agentKey = address(0);
    }

    /**
     * @notice Approve a pending transaction. Only owner.
     */
    function approveTx(uint256 txId) external onlyOwner nonReentrant {
        require(txId < _pendingTxs.length, "AW: invalid txId");
        PendingTx storage ptx = _pendingTxs[txId];
        require(!ptx.executed && !ptx.cancelled, "AW: tx finalized");
        require(block.timestamp <= ptx.createdAt + PENDING_TX_EXPIRY, "AW: tx expired");

        ptx.executed = true;
        _doTransfer(ptx.to, ptx.amount, ptx.data);
        emit TransactionApproved(txId);
    }

    /**
     * @notice Cancel a pending transaction. Only owner.
     */
    function cancelTx(uint256 txId) external onlyOwner {
        require(txId < _pendingTxs.length, "AW: invalid txId");
        PendingTx storage ptx = _pendingTxs[txId];
        require(!ptx.executed && !ptx.cancelled, "AW: tx finalized");
        ptx.cancelled = true;
        emit TransactionCancelled(txId);
    }

    function pause() external onlyOwner {
        _policy.paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        _policy.paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Emergency withdraw any token. Only owner.
     * @param token ERC20 address, or address(0) for native ETH
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) {
            (bool ok, ) = owner.call{value: amount}("");
            require(ok, "AW: eth transfer failed");
        } else {
            require(IERC20(token).transfer(owner, amount), "AW: transfer failed");
        }
    }

    // ─── Agent Functions ───

    /**
     * @notice Execute a transaction (ETH or arbitrary call). Agent only.
     * @dev If amount > approvalThreshold, tx is queued for human approval.
     * @return txId The pending tx id (or type(uint256).max if executed immediately)
     */
    function execute(
        address to,
        uint256 amount,
        bytes calldata data
    ) external onlyAgent whenNotPaused nonReentrant returns (uint256 txId) {
        return _processTransaction(to, amount, data);
    }

    /**
     * @notice Transfer ERC20 tokens. Agent only.
     * @dev Encodes the transfer call and processes through policy engine.
     */
    function executeERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyAgent whenNotPaused nonReentrant returns (uint256 txId) {
        bytes memory data = abi.encodeCall(IERC20.transfer, (to, amount));
        return _processTransaction(token, 0, data);
    }

    // ─── View Functions ───

    function getPolicy() external view override returns (Policy memory) {
        return _policy;
    }

    function getPendingTx(uint256 txId) external view override returns (PendingTx memory) {
        require(txId < _pendingTxs.length, "AW: invalid txId");
        return _pendingTxs[txId];
    }

    function getPendingTxCount() external view returns (uint256) {
        return _pendingTxs.length;
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

    // ─── Internal ───

    function _processTransaction(
        address to,
        uint256 amount,
        bytes memory data
    ) internal returns (uint256) {
        require(to != address(0), "AW: zero address");
        require(amount <= _policy.perTxLimit, "AW: exceeds per-tx limit");

        // Reset daily counter if new day
        if (block.timestamp >= _dayStart + DAY) {
            _dayStart = block.timestamp;
            _spentToday = 0;
        }

        // Check daily limit
        require(_spentToday + amount <= _policy.dailyLimit, "AW: exceeds daily limit");

        // Above approval threshold → queue for human
        if (amount > _policy.approvalThreshold) {
            uint256 txId = _pendingTxs.length;
            _pendingTxs.push(PendingTx({
                to: to,
                amount: amount,
                data: data,
                createdAt: block.timestamp,
                executed: false,
                cancelled: false
            }));
            emit TransactionQueued(txId, to, amount);
            return txId;
        }

        // Within limits → execute immediately
        _spentToday += amount;
        _doTransfer(to, amount, data);
        return type(uint256).max; // sentinel: executed immediately
    }

    function _doTransfer(address to, uint256 amount, bytes memory data) internal {
        if (data.length == 0) {
            // Simple ETH transfer
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "AW: transfer failed");
        } else {
            // Arbitrary call (ERC20 transfer, swap, etc.)
            (bool ok, ) = to.call{value: amount}(data);
            require(ok, "AW: call failed");
        }
        emit TransactionExecuted(to, amount, block.timestamp);
    }

    // ─── Receive ETH ───
    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
