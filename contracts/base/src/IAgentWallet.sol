// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAgentWallet
 * @notice Interface for AgentWallet — non-custodial smart wallets for AI agents
 */
interface IAgentWallet {
    // ─── Structs ───
    struct Policy {
        uint256 dailyLimit;         // Max USDC per 24h (6 decimals)
        uint256 perTxLimit;         // Max USDC per transaction
        uint256 approvalThreshold;  // Above this → requires human approval
        bool paused;                // Emergency pause
    }

    struct PendingTx {
        address to;
        uint256 amount;
        bytes data;
        uint256 createdAt;
        bool executed;
        bool cancelled;
    }

    // ─── Events ───
    event AgentKeySet(address indexed oldKey, address indexed newKey);
    event AgentKeyRevoked(address indexed key);
    event PolicyUpdated(uint256 dailyLimit, uint256 perTxLimit, uint256 approvalThreshold);
    event TransactionExecuted(address indexed to, uint256 amount, uint256 timestamp);
    event TransactionQueued(uint256 indexed txId, address indexed to, uint256 amount);
    event TransactionApproved(uint256 indexed txId);
    event TransactionCancelled(uint256 indexed txId);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event Deposited(address indexed from, uint256 amount);

    // ─── Owner (Human) Functions ───
    function setPolicy(uint256 dailyLimit, uint256 perTxLimit, uint256 approvalThreshold) external;
    function setAgentKey(address newAgent) external;
    function revokeAgentKey() external;
    function approveTx(uint256 txId) external;
    function cancelTx(uint256 txId) external;
    function pause() external;
    function unpause() external;
    function emergencyWithdraw(address token, uint256 amount) external;

    // ─── Agent Functions ───
    function execute(address to, uint256 amount, bytes calldata data) external returns (uint256 txId);
    function executeERC20(address token, address to, uint256 amount) external returns (uint256 txId);

    // ─── View Functions ───
    function getPolicy() external view returns (Policy memory);
    function getPendingTx(uint256 txId) external view returns (PendingTx memory);
    function getSpentToday() external view returns (uint256);
    function getRemainingDaily() external view returns (uint256);
    function owner() external view returns (address);
    function agentKey() external view returns (address);
}
