// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentWallet {
    struct Policy {
        uint256 dailyLimit;   // USD with 6 decimals (e.g. 50e6 = $50)
        uint256 perTxLimit;   // USD with 6 decimals
        bool paused;
    }

    struct TokenLimit {
        uint256 dailyLimit;   // in token's native decimals
        uint256 perTxLimit;   // in token's native decimals
        bool active;
    }

    event AgentKeySet(address indexed oldKey, address indexed newKey);
    event AgentKeyRevoked(address indexed key);
    event PolicyUpdated(uint256 dailyLimit, uint256 perTxLimit);
    event TransactionExecuted(address indexed to, uint256 amount, uint256 timestamp);
    event BlacklistUpdated(address indexed addr, bool blocked);
    event PasskeyRegistered(bytes32 pubKeyX, bytes32 pubKeyY);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event Deposited(address indexed from, uint256 amount);
    event TokenLimitSet(address indexed token, uint256 dailyLimit, uint256 perTxLimit);
    event TokenLimitRemoved(address indexed token);

    function getPolicy() external view returns (Policy memory);
    function getSpentToday() external view returns (uint256);
    function getRemainingDaily() external view returns (uint256);
    function owner() external view returns (address);
    function agentKey() external view returns (address);
}
