// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentWallet} from "./IAgentWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PasskeyVerifier} from "./PasskeyVerifier.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

/**
 * @title AgentWallet
 * @notice Non-custodial smart wallet for AI agents.
 *
 * Limit tracking:
 * - Native ETH: converted to USD via Chainlink oracle, tracked against USD daily/per-tx limits
 * - USDC: tracked directly against USD limits (1:1)
 * - ETH + USDC share the SAME aggregated USD daily limit
 * - Other ERC-20s: unlimited by default, owner can set per-token limits
 *
 * Two owner modes:
 * 1. Passkey (managed) — human controls via FaceID/YubiKey/Ledger
 * 2. EOA (self-custody) — human controls via Ethereum wallet
 */
contract AgentWallet is IAgentWallet, ReentrancyGuard {

    uint256 private constant DEFAULT_DAILY_LIMIT = 50e6;   // $50 USD (6 decimals)
    uint256 private constant DEFAULT_PER_TX_LIMIT = 25e6;  // $25 USD (6 decimals)
    uint256 private constant DAY = 86400;
    uint256 private constant ORACLE_STALENESS = 3600;      // 1 hour max staleness

    // ─── State ───
    address public override owner;
    address public override agentKey;

    // Passkey owner (P-256 public key)
    bytes32 public passkeyX;
    bytes32 public passkeyY;
    bool public isPasskeyOwner;
    uint256 public passkeyNonce;

    Policy private _policy;
    bool public initialized;

    // USD daily tracking (ETH + USDC aggregated)
    uint256 private _dayStart;
    uint256 private _spentTodayUSD;  // USD with 6 decimals

    // Per-token daily tracking
    mapping(address => TokenLimit) public tokenLimits;
    mapping(address => uint256) private _tokenDayStart;
    mapping(address => uint256) private _tokenSpentToday;

    mapping(address => bool) public blacklisted;

    // Oracle + USDC addresses (set during init)
    address public ethUsdOracle;
    address public usdcAddress;

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

    function initializeWithPasskey(
        bytes32 _passkeyX, bytes32 _passkeyY, address _agent
    ) external {
        require(!initialized, "AW: already initialized");
        require(_passkeyX != bytes32(0) && _passkeyY != bytes32(0), "AW: zero passkey");
        require(_agent != address(0), "AW: zero agent");

        initialized = true;
        passkeyX = _passkeyX;
        passkeyY = _passkeyY;
        agentKey = _agent;
        isPasskeyOwner = true;
        owner = address(0);

        _policy = Policy({
            dailyLimit: DEFAULT_DAILY_LIMIT,
            perTxLimit: DEFAULT_PER_TX_LIMIT,
            paused: false
        });
        _dayStart = block.timestamp;
    }

    /**
     * @notice Set oracle + USDC addresses. Only callable once by owner/admin.
     * @dev Must be called after initialize. Separated to keep initialize() simple.
     */
    function setOracle(address _ethUsdOracle, address _usdcAddress) external {
        require(initialized, "AW: not initialized");
        require(ethUsdOracle == address(0), "AW: oracle already set");
        require(msg.sender == owner || owner == address(0), "AW: unauthorized");
        ethUsdOracle = _ethUsdOracle;
        usdcAddress = _usdcAddress;
    }

    function registerPasskey(bytes32 _passkeyX, bytes32 _passkeyY) external {
        require(initialized, "AW: not initialized");
        require(!isPasskeyOwner, "AW: passkey already set");
        require(owner == msg.sender || owner == address(0), "AW: unauthorized");
        require(_passkeyX != bytes32(0) && _passkeyY != bytes32(0), "AW: zero passkey");

        passkeyX = _passkeyX;
        passkeyY = _passkeyY;
        isPasskeyOwner = true;
        owner = address(0);

        emit PasskeyRegistered(_passkeyX, _passkeyY);
    }

    // ─── Passkey-Authenticated Owner Actions ───

    function setPolicyWithPasskey(
        uint256 dailyLimit, uint256 perTxLimit,
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        if (dailyLimit > 0) _policy.dailyLimit = dailyLimit;
        if (perTxLimit > 0) _policy.perTxLimit = perTxLimit;
        emit PolicyUpdated(_policy.dailyLimit, _policy.perTxLimit);
    }

    function setTokenLimitWithPasskey(
        address token, uint256 dailyLimit, uint256 perTxLimit,
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        _setTokenLimit(token, dailyLimit, perTxLimit);
    }

    function removeTokenLimitWithPasskey(
        address token,
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        _removeTokenLimit(token);
    }

    function pauseWithPasskey(
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        _policy.paused = true;
        emit Paused(address(this));
    }

    function unpauseWithPasskey(
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        _policy.paused = false;
        emit Unpaused(address(this));
    }

    function setBlacklistWithPasskey(
        address addr, bool blocked,
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        blacklisted[addr] = blocked;
        emit BlacklistUpdated(addr, blocked);
    }

    function setAgentKeyWithPasskey(
        address newAgent,
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) external {
        _verifyPasskey(authenticatorData, clientDataJSON, r, s);
        require(newAgent != address(0), "AW: zero agent");
        emit AgentKeySet(agentKey, newAgent);
        agentKey = newAgent;
    }

    function emergencyWithdrawWithPasskey(
        address token, uint256 amount, address recipient,
        bytes calldata authenticatorData, string calldata clientDataJSON,
        bytes32 r, bytes32 s
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

    // ─── EOA Owner Actions ───

    function setPolicy(uint256 dailyLimit, uint256 perTxLimit) external onlyOwner {
        if (dailyLimit > 0) _policy.dailyLimit = dailyLimit;
        if (perTxLimit > 0) _policy.perTxLimit = perTxLimit;
        emit PolicyUpdated(_policy.dailyLimit, _policy.perTxLimit);
    }

    function setTokenLimit(address token, uint256 dailyLimit, uint256 perTxLimit) external onlyOwner {
        _setTokenLimit(token, dailyLimit, perTxLimit);
    }

    function removeTokenLimit(address token) external onlyOwner {
        _removeTokenLimit(token);
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

    /**
     * @notice Execute a native ETH transfer or arbitrary call.
     * @dev ETH value is converted to USD via Chainlink and tracked against USD limits.
     *      If no oracle is set, `value` is tracked raw (legacy behavior).
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyAgent whenNotPaused nonReentrant {
        require(to != address(0), "AW: zero address");
        require(!blacklisted[to], "AW: blacklisted");

        // Convert ETH to USD if oracle is set, otherwise raw value
        uint256 usdAmount;
        if (value > 0 && ethUsdOracle != address(0)) {
            usdAmount = _ethToUsd(value);
        } else {
            usdAmount = value;
        }

        // Check USD limits (shared between ETH + USDC)
        require(usdAmount <= _policy.perTxLimit, "AW: exceeds per-tx limit");
        _trackUsdSpend(usdAmount);

        if (data.length == 0) {
            (bool ok, ) = to.call{value: value}("");
            require(ok, "AW: transfer failed");
        } else {
            (bool ok, ) = to.call{value: value}(data);
            require(ok, "AW: call failed");
        }

        emit TransactionExecuted(to, value, block.timestamp);
    }

    /**
     * @notice Execute an ERC-20 transfer.
     * @dev USDC transfers are tracked against the shared USD daily limit.
     *      Other tokens: checked against per-token limits if set, otherwise unlimited.
     */
    function executeERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyAgent whenNotPaused nonReentrant {
        require(to != address(0), "AW: zero address");
        require(!blacklisted[to], "AW: blacklisted");

        if (token == usdcAddress && usdcAddress != address(0)) {
            // USDC → tracked against shared USD limits (1:1)
            require(amount <= _policy.perTxLimit, "AW: exceeds per-tx limit");
            _trackUsdSpend(amount);
        } else {
            // Other ERC-20: check per-token limits if they exist
            TokenLimit storage tl = tokenLimits[token];
            if (tl.active) {
                require(amount <= tl.perTxLimit, "AW: exceeds token per-tx limit");
                _trackTokenSpend(token, amount);
            }
            // If no limit set → unlimited, no tracking
        }

        require(IERC20(token).transfer(to, amount), "AW: transfer failed");
        emit TransactionExecuted(to, amount, block.timestamp);
    }

    // ─── View Functions ───

    function getPolicy() external view override returns (Policy memory) {
        return _policy;
    }

    function getSpentToday() external view override returns (uint256) {
        if (block.timestamp >= _dayStart + DAY) return 0;
        return _spentTodayUSD;
    }

    function getRemainingDaily() external view override returns (uint256) {
        uint256 spent = block.timestamp >= _dayStart + DAY ? 0 : _spentTodayUSD;
        if (spent >= _policy.dailyLimit) return 0;
        return _policy.dailyLimit - spent;
    }

    function getTokenLimit(address token) external view returns (TokenLimit memory) {
        return tokenLimits[token];
    }

    function getTokenSpentToday(address token) external view returns (uint256) {
        if (block.timestamp >= _tokenDayStart[token] + DAY) return 0;
        return _tokenSpentToday[token];
    }

    function getPasskey() external view returns (bytes32 x, bytes32 y) {
        return (passkeyX, passkeyY);
    }

    /**
     * @notice Get current ETH price in USD (6 decimals). Returns 0 if no oracle.
     */
    function getEthPrice() external view returns (uint256) {
        if (ethUsdOracle == address(0)) return 0;
        return _getEthPriceUsd();
    }

    // ─── Internal ───

    function _ethToUsd(uint256 weiAmount) internal view returns (uint256) {
        uint256 ethPriceUsd = _getEthPriceUsd(); // USD with 6 decimals per 1 ETH
        // weiAmount is in wei (18 decimals), ethPriceUsd is USD*1e6 per 1e18 wei
        return (weiAmount * ethPriceUsd) / 1e18;
    }

    function _getEthPriceUsd() internal view returns (uint256) {
        AggregatorV3Interface oracle = AggregatorV3Interface(ethUsdOracle);
        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        require(answer > 0, "AW: invalid oracle price");
        require(block.timestamp - updatedAt <= ORACLE_STALENESS, "AW: stale oracle");

        uint8 oracleDecimals = oracle.decimals();
        // Normalize to 6 decimals (our USD denomination)
        if (oracleDecimals > 6) {
            return uint256(answer) / (10 ** (oracleDecimals - 6));
        } else {
            return uint256(answer) * (10 ** (6 - oracleDecimals));
        }
    }

    function _trackUsdSpend(uint256 usdAmount) internal {
        if (block.timestamp >= _dayStart + DAY) {
            _dayStart = block.timestamp;
            _spentTodayUSD = 0;
        }
        require(_spentTodayUSD + usdAmount <= _policy.dailyLimit, "AW: exceeds daily limit");
        _spentTodayUSD += usdAmount;
    }

    function _trackTokenSpend(address token, uint256 amount) internal {
        if (block.timestamp >= _tokenDayStart[token] + DAY) {
            _tokenDayStart[token] = block.timestamp;
            _tokenSpentToday[token] = 0;
        }
        require(
            _tokenSpentToday[token] + amount <= tokenLimits[token].dailyLimit,
            "AW: exceeds token daily limit"
        );
        _tokenSpentToday[token] += amount;
    }

    function _setTokenLimit(address token, uint256 dailyLimit, uint256 perTxLimit) internal {
        require(token != address(0), "AW: zero token");
        require(dailyLimit > 0 && perTxLimit > 0, "AW: zero limit");
        tokenLimits[token] = TokenLimit({
            dailyLimit: dailyLimit,
            perTxLimit: perTxLimit,
            active: true
        });
        emit TokenLimitSet(token, dailyLimit, perTxLimit);
    }

    function _removeTokenLimit(address token) internal {
        require(token != address(0), "AW: zero token");
        delete tokenLimits[token];
        delete _tokenDayStart[token];
        delete _tokenSpentToday[token];
        emit TokenLimitRemoved(token);
    }

    function _verifyPasskey(
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r, bytes32 s
    ) internal {
        require(isPasskeyOwner, "AW: not passkey mode");
        require(
            PasskeyVerifier.verifyWebAuthn(
                authenticatorData, clientDataJSON,
                r, s, passkeyX, passkeyY
            ),
            "AW: invalid passkey signature"
        );
        passkeyNonce++;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
