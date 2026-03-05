# AgentWallet — Non-Custodial Smart Wallets for AI Agents

Non-custodial smart wallets with on-chain policy enforcement. Your agent gets a real wallet with spending limits, human oversight via passkey (FaceID/YubiKey), and Chainlink oracle-based USD tracking — all enforced by smart contracts, not trust.

**Network:** Base (EVM)
**npm:** `@0xartex/agentwallet`
**API:** `https://agntos.dev/wallet`

## CLI (recommended)

```bash
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS --unmanaged
npx @0xartex/agentwallet status 0xWALLET_ADDRESS
npx @0xartex/agentwallet limits 0xWALLET --daily 200 --pertx 100 --reason "Need more"
npx @0xartex/agentwallet token-limit 0xWALLET --token 0xTOKEN --token-daily 1000 --token-pertx 300
npx @0xartex/agentwallet rm-token 0xWALLET --token 0xTOKEN
npx @0xartex/agentwallet pause 0xWALLET
npx @0xartex/agentwallet unpause 0xWALLET
npx @0xartex/agentwallet stats
```

All commands support `--json` for machine-readable output.

## SDK

```typescript
import { AgentWallet } from '@0xartex/agentwallet'

const aw = new AgentWallet()

// Create a wallet (returns setup URL for human)
const { wallet, setupUrl } = await aw.create('0xAgentAddress')

// Create autonomous wallet (no human)
const { wallet: w2 } = await aw.createUnmanaged('0xAgentAddress')

// Check wallet
const { wallet: info } = await aw.status('0xWalletAddress')

// Request limit increase (returns URL for human to approve)
const { approvalUrl } = await aw.requestLimitIncrease('0xWallet', {
  dailyLimit: 200, perTxLimit: 100, reason: 'Trading'
})

// Token limit
await aw.requestTokenLimit('0xWallet', {
  token: '0xToken', dailyLimit: 1000, perTxLimit: 300
})

// Emergency
await aw.requestPause('0xWallet', 'Security concern')
await aw.requestUnpause('0xWallet')
```

## REST API

**Base URL:** `https://agntos.dev/wallet`

### Create wallet

```bash
# Managed (human registers passkey later)
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xYOUR_AGENT_ADDRESS"}'

# Unmanaged (agent is its own owner)
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xYOUR_AGENT_ADDRESS", "mode": "unmanaged"}'
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

- Default limits: $50/day, $25/tx (values in USDC units, 6 decimals)
- Gas auto-funded on creation (~$0.07, covers ~140 txs on Base)
- Send `setupUrl` to human → they set limits + register passkey (FaceID/YubiKey)

### Check wallet

```bash
curl https://agntos.dev/wallet/wallet/0xWALLET_ADDRESS
```

### Request limit change

```bash
curl -X POST https://agntos.dev/wallet/approve/request \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xWALLET","action":"limits","dailyLimit":"200","perTxLimit":"100","reason":"Need higher limits"}'
```

Returns `{ "approvalUrl": "https://..." }`. Send to human → they authenticate with passkey → limits updated on-chain.

### Available actions

| Action | Body params | Description |
|--------|-------------|-------------|
| `limits` | `dailyLimit`, `perTxLimit` | Change USD daily/per-tx limits |
| `tokenLimit` | `token`, `tokenDailyLimit`, `tokenPerTxLimit`, `tokenDecimals` | Set per-token ERC-20 limit |
| `removeTokenLimit` | `token` | Remove a token limit |
| `pause` | | Emergency pause — all agent txs revert |
| `unpause` | | Resume agent operations |

### All endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/wallet` | Create wallet |
| GET | `/wallet/:address` | Wallet info, policy, balances |
| GET | `/stats` | Total wallets deployed |
| POST | `/approve/request` | Generate approval URL for human |
| GET | `/setup` | Human passkey registration page |
| GET | `/approve` | Human wallet management page |

## Limit Tracking

| Asset | How it's tracked | Limit type |
|-------|-----------------|------------|
| **ETH** | Converted to USD via Chainlink oracle | Shared USD daily + per-tx |
| **USDC** | Direct (1:1 USD) | Same shared pool as ETH |
| **Other ERC-20s** | Unlimited by default | Owner can set per-token limits |

ETH + USDC share an **aggregated USD daily limit**. Spending $30 in ETH and $15 in USDC = $45 against a $50 daily limit.

## On-Chain Transactions

Agents call the smart contract directly using their private key:

- `execute(to, value, data)` — send ETH or call any contract
- `executeERC20(token, to, amount)` — transfer ERC-20 tokens

All transactions execute instantly or revert. No approval queues.

## Security Model

- **Non-custodial**: agent's private key never leaves the agent's machine
- **On-chain enforcement**: limits are in the smart contract, not the API
- **Passkey ownership**: human's key in device secure enclave, verified on-chain via RIP-7212
- **Backend is a relay**: cannot forge signatures or override limits
- **Chainlink oracle**: decentralized price feed, 1-hour staleness check
- **Emergency controls**: owner can pause, withdraw, blacklist at any time

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
