# agentwallet

Non-custodial smart wallets for AI agents on Base.

Your agent gets a real wallet with spending limits, and your human controls it with FaceID — all enforced by smart contracts, not trust.

```bash
npx @0xartex/agentwallet create --agent 0xYourAgentKey
```

## Why

AI agents need to spend money. But giving an agent an unlimited wallet is terrifying.

**AgentWallet** solves this:
- Agent has a wallet with hard spending limits ($50/day, $25/tx by default)
- Human registers a passkey (FaceID/YubiKey) as the owner
- Limits are enforced **on-chain** — the API literally cannot override them
- Agent's private key never leaves the agent's machine

No custody. No trust. No "we promise we won't steal your funds." Architecturally impossible.

## Install

```bash
npm install -g @0xartex/agentwallet
```

Or use directly:

```bash
npx @0xartex/agentwallet <command>
```

## Quick Start

### 1. Create a wallet

```bash
# Managed (human sets up passkey)
agentwallet create --agent 0xYourAgentPublicKey

# Autonomous (no human in the loop)
agentwallet create --agent 0xYourAgentPublicKey --unmanaged
```

A managed wallet returns a **setup URL**. Send it to your human — they open it, set limits, register their passkey. Done.

### 2. Check your wallet

```bash
agentwallet status 0xYourWallet
```

```
  Wallet
  ────────────────
  Address         0x01Ab...0f03
  Owner           Passkey (FaceID/YubiKey)
  Agent           0x826f...14eF
  Chain           base
  Paused          No

  Spending        ███░░░░░░░░░░░░░░░░░░░░░░░░░░░ 3%
  Spent today     $1.53 / $50
  Remaining       $48.47
  Per-tx limit    $25
  Gas balance     0.001178 ETH
```

### 3. Need higher limits?

```bash
agentwallet limits 0xWallet --daily 200 --pertx 100 --reason "Trading requires higher limits"
```

Returns a URL. Send it to your human → they review → authenticate with passkey → limits updated on-chain.

### 4. Cap exposure on a token

```bash
agentwallet token-limit 0xWallet --token 0xToken --token-daily 1000 --token-pertx 300
```

### 5. Emergency pause

```bash
agentwallet pause 0xWallet
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `create` | `new` | Create a wallet |
| `status` | `info`, `get` | Check wallet info & balances |
| `limits` | `limit` | Request a limit increase |
| `token-limit` | | Set a per-token spending limit |
| `rm-token` | | Remove a token limit |
| `pause` | | Request emergency pause |
| `unpause` | `resume` | Request unpause |
| `stats` | | Total wallets deployed |

## SDK

Use it programmatically in your agent:

```typescript
import { AgentWallet } from '@0xartex/agentwallet'

const aw = new AgentWallet()

// Create a wallet
const { wallet, setupUrl } = await aw.create('0xYourAgentKey')
console.log(wallet.address)
console.log(setupUrl) // send to human

// Check status
const { wallet: info } = await aw.status(wallet.address)
console.log(`Remaining: $${Number(info.remainingDaily) / 1e6}`)

// Need higher limits?
const { approvalUrl } = await aw.requestLimitIncrease(wallet.address, {
  dailyLimit: 200,
  perTxLimit: 100,
  reason: 'Trading bot needs more headroom'
})
// Send approvalUrl to your human
```

### Available methods

```typescript
aw.create(agent)                      // managed wallet
aw.createUnmanaged(agent)             // autonomous wallet
aw.status(wallet)                     // wallet info
aw.stats()                            // total wallets
aw.requestLimitIncrease(wallet, opts) // ask human for higher limits
aw.requestTokenLimit(wallet, opts)    // set per-token limit
aw.requestRemoveTokenLimit(wallet, opts) // remove token limit
aw.requestPause(wallet, reason?)      // emergency pause
aw.requestUnpause(wallet, reason?)    // resume operations
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTWALLET_URL` | API endpoint (default: `https://agntos.dev/wallet`) |
| `AGENTWALLET_AGENT` | Default agent address for `create` |

## How It Works

```
Agent creates wallet → Human registers passkey → Agent transacts within limits
                              ↓
                     Human can: raise/lower limits,
                     pause, set token limits,
                     blacklist addresses, withdraw
```

**On-chain enforcement:**
- Smart contract checks every transaction against daily + per-tx limits
- ETH and USDC share an aggregated USD limit (via Chainlink oracle)
- ERC-20 tokens can have independent per-token limits
- All transactions execute instantly or revert — no approval queues

**Security model:**
- Agent key → can only spend within limits
- Passkey (FaceID/YubiKey) → controls limits, pause, withdraw
- API server → convenience relay only, cannot forge signatures
- If the API goes down, agent can interact with contracts directly

## Contracts

Deployed on **Base** (Ethereum L2):

| Contract | Address |
|----------|---------|
| Factory | [`0x77c2a63BB08b090b46eb612235604dEB8150A4A1`](https://basescan.org/address/0x77c2a63BB08b090b46eb612235604dEB8150A4A1) |
| Implementation | [`0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA`](https://basescan.org/address/0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA) |

Source: [github.com/0xArtex/agentwallet-aos](https://github.com/0xArtex/agentwallet-aos)

## Self-hosted

Don't want to use our hosted API? Run your own:

```bash
git clone https://github.com/0xArtex/agentwallet-aos
cd agentwallet-aos/src
npm install && npm run build

ADMIN_PRIVATE_KEY=0x... \
FACTORY_ADDRESS=0x77c2a63BB08b090b46eb612235604dEB8150A4A1 \
BASE_RPC=https://base-rpc.publicnode.com \
ETH_USD_ORACLE=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70 \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
node dist/api/server.js
```

Then point the CLI at it:

```bash
agentwallet create --agent 0x... --url http://localhost:3002
```

## License

MIT
