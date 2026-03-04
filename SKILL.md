# AgentWallet — Non-Custodial Smart Wallets for AI Agents

Non-custodial smart wallets with on-chain policy enforcement. Your agent gets a real wallet with spending limits, human oversight via passkey (FaceID/YubiKey), and Chainlink oracle-based USD tracking — all enforced by smart contracts, not trust.

**Network:** Base (EVM)
**Base URL:** `https://agntos.dev/wallet`

## Quick Start

### 1. Create a managed wallet (recommended)

```bash
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xYOUR_AGENT_ADDRESS"}'
```

Response:
```json
{
  "wallet": {
    "address": "0x...",
    "owner": "0x...",
    "agent": "0x...",
    "chain": "base",
    "policy": { "dailyLimit": "50000000", "perTxLimit": "25000000", "paused": false },
    "spentToday": "0",
    "remainingDaily": "50000000",
    "gasBalance": "28000000000000"
  },
  "setupUrl": "https://agntos.dev/wallet/setup?token=...&wallet=0x...",
  "mode": "managed"
}
```

Send `setupUrl` to your human. They open it, set limits, register their passkey (FaceID/fingerprint/YubiKey). Done.

- Default limits: $50/day, $25/tx
- Gas auto-funded on creation (~$0.07, covers ~140 txs on Base)

### 2. Create an unmanaged wallet (no human)

```bash
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xYOUR_AGENT_ADDRESS", "mode": "unmanaged"}'
```

Agent is both owner and agent. Can change its own limits. No human in the loop.

### 3. Check wallet status

```bash
curl https://agntos.dev/wallet/wallet/0xWALLET_ADDRESS
```

## Limit Tracking

| Asset | How it's tracked | Limit type |
|-------|-----------------|------------|
| **ETH** | Converted to USD via Chainlink oracle | Shared USD daily + per-tx |
| **USDC** | Direct (1:1 USD) | Same shared pool as ETH |
| **Other ERC-20s** | Unlimited by default | Owner can set per-token limits |

ETH + USDC share an **aggregated USD daily limit**. Spending $30 in ETH and $15 in USDC = $45 against a $50 daily limit.

## Transactions

Agents call the smart contract directly using their private key:

- `execute(to, value, data)` — send ETH or call any contract
- `executeERC20(token, to, amount)` — transfer ERC-20 tokens

All transactions execute instantly or revert. No approval queues.

## Human Approval Flow

Agents can request changes from their human via pre-filled URLs:

### Request limit increase

```bash
curl -X POST https://agntos.dev/wallet/approve/request \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0xWALLET",
    "action": "limits",
    "dailyLimit": "200",
    "perTxLimit": "100",
    "reason": "Need higher limits for trading"
  }'
```

Returns a URL. Agent sends it to human → human opens it → reviews the request → authenticates with passkey → changes applied on-chain.

### Request token limit

```bash
curl -X POST https://agntos.dev/wallet/approve/request \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0xWALLET",
    "action": "tokenLimit",
    "token": "0xTOKEN_ADDRESS",
    "tokenDailyLimit": "1000",
    "tokenPerTxLimit": "300",
    "tokenDecimals": "18",
    "reason": "Cap exposure on this token"
  }'
```

### Other actions

| Action | Description |
|--------|-------------|
| `limits` | Change USD daily/per-tx limits |
| `tokenLimit` | Set per-token ERC-20 limit |
| `removeTokenLimit` | Remove a token limit (back to unlimited) |
| `pause` | Emergency pause — all agent txs revert |
| `unpause` | Resume agent operations |

Human can also open `https://agntos.dev/wallet/approve?wallet=0x...` directly to manage the wallet manually (no pre-fill).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/wallet` | Create wallet (managed or unmanaged) |
| GET | `/wallet/:address` | Wallet info, policy, balances |
| GET | `/stats` | Total wallets deployed |
| GET | `/setup` | Human passkey registration page |
| GET | `/approve` | Human approval/management page |
| POST | `/approve/request` | Generate pre-filled approval URL |
| POST | `/approve/challenge` | Get passkey challenge |
| POST | `/approve/execute` | Submit passkey-signed action |
| POST | `/setup/set-limits` | Set limits during setup |
| POST | `/setup/register-passkey` | Register passkey during setup |

All paths are relative to `https://agntos.dev/wallet`.

## Security Model

- **Non-custodial**: agent's private key never leaves the agent's machine
- **On-chain enforcement**: limits are in the smart contract, not the API
- **Passkey ownership**: human's private key lives in device secure enclave (FaceID/YubiKey), verified on-chain via RIP-7212 P-256 precompile
- **Backend is a relay**: passes passkey signatures to chain, cannot forge them
- **Chainlink oracle**: ETH price from decentralized oracle network, 1-hour staleness check
- **No backdoors**: even the provider cannot move funds or override limits
- **Emergency controls**: owner can pause, withdraw, revoke, blacklist at any time

## Contract Addresses

**Base Mainnet**
- Factory: `0x77c2a63BB08b090b46eb612235604dEB8150A4A1`
- Implementation: `0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA`
- Oracle: Chainlink ETH/USD `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

**Base Sepolia (testnet)**
- Factory: `0x8eD17B67B8C1A24020236987BeD28F9609e93B06`
- Implementation: `0xFB93e5245303827426Fb1A40D9168Cb738de1F2f`
- Mock Oracle: `0x65E246C24118CF6439152d725Ad0072ce469805c`
