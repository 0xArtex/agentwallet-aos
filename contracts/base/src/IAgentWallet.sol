// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentWallet {
    struct Policy {
        uint256 dailyLimit;
        uint256 perTxLimit;
        bool paused;
    }

    event AgentKeySet(address indexed oldKey, address indexed newKey);
    event AgentKeyRevoked(address indexed key);
    event PolicyUpdated(uint256 dailyLimit, uint256 perTxLimit);
    event TransactionExecuted(address indexed to, uint256 amount, uint256 timestamp);
    event BlacklistUpdated(address indexed addr, bool blocked);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event Deposited(address indexed from, uint256 amount);

    function setPolicy(uint256 dailyLimit, uint256 perTxLimit) external;
    function setAgentKey(address newAgent) external;
    function revokeAgentKey() external;
    function pause() external;
    function unpause() external;
    function setBlacklist(address addr, bool blocked) external;
    function emergencyWithdraw(address token, uint256 amount) external;

    function execute(address to, uint256 amount, bytes calldata data) external;
    function executeERC20(address token, address to, uint256 amount) external;

    function getPolicy() external view returns (Policy memory);
    function getSpentToday() external view returns (uint256);
    function getRemainingDaily() external view returns (uint256);
    function owner() external view returns (address);
    function agentKey() external view returns (address);
}
