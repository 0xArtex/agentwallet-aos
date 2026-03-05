# AgentWallet

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

## How It Works

![Architecture](docs/architecture.png)

```
Agent creates wallet → Human registers passkey → Agent transacts within limits
                              ↓
                     Human can: raise/lower limits,
                     pause, set token limits,
                     blacklist addresses, withdraw
```

### Limit tracking

| Asset | Tracking | Limits |
|-------|----------|--------|
| **ETH** | Converted to USD via Chainlink oracle | Shared USD daily/per-tx limit |
| **USDC** | Tracked at face value (1:1) | Same shared USD limit as ETH |
| **Other ERC-20s** | Unlimited by default | Owner can set per-token limits |

ETH and USDC spending is **aggregated** — if the daily limit is $50, spending $30 in ETH leaves $20 for USDC (and vice versa).

### Wallet modes

| Mode | Owner | Use case |
|------|-------|----------|
| **Managed** | Human (via passkey) | Production agents with human oversight |
| **Unmanaged** | Agent itself | Autonomous agents, no human in the loop |

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
aw.create(agent)                         // managed wallet
aw.createUnmanaged(agent)                // autonomous wallet
aw.status(wallet)                        // wallet info
aw.stats()                               // total wallets
aw.requestLimitIncrease(wallet, opts)    // ask human for higher limits
aw.requestTokenLimit(wallet, opts)       // set per-token limit
aw.requestRemoveTokenLimit(wallet, opts) // remove token limit
aw.requestPause(wallet, reason?)         // emergency pause
aw.requestUnpause(wallet, reason?)       // resume operations
```

## REST API

The CLI and SDK talk to a hosted API. You can also call it directly:

### Create a wallet

```bash
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xAgentPublicKey"}'
```

### Get wallet info

```bash
curl https://agntos.dev/wallet/wallet/0xWalletAddress
```

### Request limit change

```bash
curl -X POST https://agntos.dev/wallet/approve/request \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0xWalletAddress",
    "action": "limits",
    "dailyLimit": "200",
    "perTxLimit": "100",
    "reason": "Need higher limits for trading"
  }'
```

## Contracts

### Architecture

- **AgentWallet** — minimal proxy (EIP-1167) smart wallet with dual-mode ownership (EOA or passkey)
- **AgentWalletFactory** — deploys wallets via CREATE2 (deterministic addresses), seeds gas
- **PasskeyVerifier** — on-chain P-256 signature verification via RIP-7212 precompile

### Key features

- **Instant execution** — all transactions execute or revert, no approval queues
- **Hard limits** — daily + per-tx caps enforced at the contract level
- **Address blacklist** — owner can block specific addresses
- **Emergency pause** — one call freezes all agent activity
- **Emergency withdraw** — owner can pull all funds instantly
- **Chainlink oracle** — ETH/USD conversion with 1-hour staleness check
- **Nonce-based replay protection** — passkey signatures can't be replayed

### Deployments

**Base Mainnet**
| Contract | Address |
|----------|---------|
| Factory | [`0x77c2a63BB08b090b46eb612235604dEB8150A4A1`](https://basescan.org/address/0x77c2a63BB08b090b46eb612235604dEB8150A4A1) |
| Implementation | [`0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA`](https://basescan.org/address/0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA) |
| Chainlink ETH/USD | [`0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`](https://basescan.org/address/0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70) |
| USDC | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |

**Base Sepolia (testnet)**
| Contract | Address |
|----------|---------|
| Factory | `0x8eD17B67B8C1A24020236987BeD28F9609e93B06` |
| Implementation | `0xFB93e5245303827426Fb1A40D9168Cb738de1F2f` |
| Mock Oracle | `0x65E246C24118CF6439152d725Ad0072ce469805c` |

## Security Model

1. **Agent key** — can execute transactions within policy limits only
2. **Owner (passkey)** — can change limits, pause, blacklist, withdraw. Private key lives in device secure enclave (never exported)
3. **Backend** — relays passkey-signed transactions to chain. Cannot forge signatures. If compromised, on-chain limits still hold.
4. **Oracle** — Chainlink ETH/USD feed (8 decimals, aggregated from multiple sources). 1-hour staleness check prevents stale price exploitation.

The backend is a **convenience layer** — all security-critical logic is on-chain. An agent can interact with the contracts directly, bypassing the API entirely.

## Project Structure

```
cli/                          ← npm package (@0xartex/agentwallet)
  cli.ts                      — CLI with colored output
  sdk.ts                      — TypeScript SDK
contracts/
  base/
    src/
      AgentWallet.sol         — Smart wallet with policy enforcement
      AgentWalletFactory.sol  — Factory with gas seeding
      IAgentWallet.sol        — Interface and events
      PasskeyVerifier.sol     — WebAuthn P-256 on-chain verification
    test/
      AgentWallet.t.sol       — 45 Forge tests
  solana/                     — Solana program (coming soon)
src/
  api/
    server.ts                 — REST API (Express)
  base/
    client.ts                 — Base wallet client
    abi/                      — Contract ABIs
  web/
    setup.html                — Passkey registration page
    approve.html              — Human approval page
docs/
  architecture.png            — Architecture diagram
```

## Self-Hosted

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

### Environment variables

| Variable | Description |
|----------|-------------|
| `BASE_RPC` | Base RPC URL |
| `ADMIN_PRIVATE_KEY` | Deployer/admin private key |
| `FACTORY_ADDRESS` | Deployed factory address |
| `ETH_USD_ORACLE` | Chainlink ETH/USD feed address |
| `USDC_ADDRESS` | USDC token address |
| `PORT` | API server port (default: 3002) |

## License

MIT
