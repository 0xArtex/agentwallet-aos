// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentWallet} from "./IAgentWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentWallet
 * @notice Non-custodial smart wallet for AI agents with on-chain policy enforcement.
 *
 * - Owner (human) sets limits and can pause/revoke instantly
 * - Agent operates freely within limits — all txs execute immediately
 * - No approval queues, no waiting — just hard caps that revert
 * - Optional address blacklist managed by owner
 *
 * Default policy:
 * - Daily limit:   50 USDC (50e6)
 * - Per-tx limit:  25 USDC (25e6)
 */
contract AgentWallet is IAgentWallet, ReentrancyGuard {

    uint256 private constant DEFAULT_DAILY_LIMIT = 50e6;
    uint256 private constant DEFAULT_PER_TX_LIMIT = 25e6;
    uint256 private constant DAY = 86400;

    // ─── State ───
    address public override owner;
    address public override agentKey;

    Policy private _policy;
    bool public initialized;

    // Daily spend tracking
    uint256 private _dayStart;
    uint256 private _spentToday;

    // Address blacklist
    mapping(address => bool) public blacklisted;

    // ─── Modifiers ───
    modifier onlyOwner() {
        require(msg.sender == owner, "AW: not owner");
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

    function initialize(address _owner, address _agent) external {
        require(!initialized, "AW: already initialized");
        require(_owner != address(0), "AW: zero owner");
        require(_agent != address(0), "AW: zero agent");

        initialized = true;
        owner = _owner;
        agentKey = _agent;

        _policy = Policy({
            dailyLimit: DEFAULT_DAILY_LIMIT,
            perTxLimit: DEFAULT_PER_TX_LIMIT,
            paused: false
        });

        _dayStart = block.timestamp;
    }

    // ─── Owner Functions ───

    /**
     * @notice Update spending limits. Takes effect immediately.
     * @dev Pass 0 to keep current value.
     */
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

    /**
     * @notice Add/remove addresses from blacklist.
     */
    function setBlacklist(address addr, bool blocked) external onlyOwner {
        blacklisted[addr] = blocked;
        emit BlacklistUpdated(addr, blocked);
    }

    /**
     * @notice Batch blacklist update.
     */
    function setBlacklistBatch(address[] calldata addrs, bool blocked) external onlyOwner {
        for (uint256 i = 0; i < addrs.length; i++) {
            blacklisted[addrs[i]] = blocked;
            emit BlacklistUpdated(addrs[i], blocked);
        }
    }

    /**
     * @notice Emergency withdraw. Only owner.
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
     * @notice Execute a transaction. Reverts if limits exceeded.
     * @dev All txs execute immediately — no queuing.
     */
    function execute(
        address to,
        uint256 amount,
        bytes calldata data
    ) external onlyAgent whenNotPaused nonReentrant {
        require(to != address(0), "AW: zero address");
        require(!blacklisted[to], "AW: blacklisted");
        require(amount <= _policy.perTxLimit, "AW: exceeds per-tx limit");

        // Reset daily counter if new day
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

    /**
     * @notice Transfer ERC20 tokens. Agent only.
     */
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

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
