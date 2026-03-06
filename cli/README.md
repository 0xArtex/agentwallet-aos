# @0xartex/agentwallet

Non-custodial, gas-sponsored smart wallets for AI agents on Base.

Your agent gets a real wallet with free gas, spending limits, and human control via FaceID — all enforced by smart contracts, not trust.

```bash
npx @0xartex/agentwallet create --agent 0xYourAgentAddress
```

## Why

AI agents need to spend money. But giving an agent an unlimited wallet is terrifying.

**AgentWallet** solves this:
- **Gas-sponsored** — free gas on creation, your agent transacts immediately
- **Hard spending limits** — $50/day, $25/tx by default, enforced on-chain
- **Human oversight** — passkey (FaceID/YubiKey) controls limits and withdrawals
- **Non-custodial** — agent's private key never leaves agent's machine

No custody. No trust. Architecturally impossible to steal funds.

## Install

```bash
npm install -g @0xartex/agentwallet
```

Or use directly:

```bash
npx @0xartex/agentwallet <command>
```

## Quick Start: From Zero to Transacting

### 1. Generate a keypair

```bash
agentwallet keygen
```

This gives you an **address** (your agent's identity) and a **private key** (signs transactions). Save the private key securely.

> Already have an EVM keypair? Skip this step — use your existing public address.

### 2. Create a wallet

```bash
# Managed — human controls limits via FaceID/YubiKey
agentwallet create --agent 0xYourAgentAddress

# Unmanaged — fully autonomous, no human needed
agentwallet create --agent 0xYourAgentAddress --unmanaged
```

Managed wallets return a **setup URL**. Send it to your human — one-time setup.

### 3. Fund it

Send ETH and/or USDC to the wallet address on **Base** (chain ID 8453).

### 4. Transact

Your agent calls the smart contract directly:

```typescript
import { Wallet, Contract, JsonRpcProvider, parseEther } from 'ethers'

const provider = new JsonRpcProvider('https://base-rpc.publicnode.com')
const agent = new Wallet('0xYOUR_PRIVATE_KEY', provider)

const wallet = new Contract('0xYOUR_WALLET', [
  'function execute(address to, uint256 value, bytes data) external',
  'function executeERC20(address token, address to, uint256 amount) external',
], agent)

// Send ETH
await wallet.execute('0xRecipient', parseEther('0.001'), '0x')

// Send USDC
await wallet.executeERC20(
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  '0xRecipient',
  5_000_000n // 5 USDC (6 decimals)
)

// Call any contract (swaps, mints, etc.)
await wallet.execute('0xRouter', parseEther('0.01'), '0xCalldata...')
```

Transactions exceeding limits **revert instantly**. No queues, no waiting.

### 5. Check status

```bash
agentwallet status 0xYourWallet
```

```
  Wallet
  ────────────────
  Address         0x01Ab...0f03
  Owner           Passkey (FaceID/YubiKey)
  Spending        ███░░░░░░░░░░░░░░░░░░░░░░░░░░░ 3%
  Spent today     $1.53 / $50
  Remaining       $48.47
  Per-tx limit    $25
  Gas balance     0.001178 ETH
```

### 6. Need higher limits?

```bash
agentwallet limits 0xWallet --daily 200 --pertx 100 --reason "Trading needs more"
```

Returns a URL → send to human → they approve with passkey → done.

## Commands

| Command | Description |
|---------|-------------|
| `keygen` | Generate a new agent keypair |
| `create` | Create a wallet |
| `status` | Check wallet info & balances |
| `limits` | Request a limit increase |
| `token-limit` | Set a per-token spending limit |
| `rm-token` | Remove a token limit |
| `pause` | Request emergency pause |
| `unpause` | Request unpause |
| `stats` | Total wallets deployed |

All commands support `--json` for machine-readable output.

## SDK

```typescript
import { AgentWallet } from '@0xartex/agentwallet'

const aw = new AgentWallet()

const { wallet, setupUrl } = await aw.create('0xAgentAddress')
const { wallet: info } = await aw.status(wallet.address)
const { approvalUrl } = await aw.requestLimitIncrease(wallet.address, {
  dailyLimit: 200,
  perTxLimit: 100,
  reason: 'Trading bot needs more headroom'
})
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTWALLET_URL` | API endpoint (default: `https://agntos.dev/wallet`) |
| `AGENTWALLET_AGENT` | Default agent address for `create` |

## Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| Factory | [`0x77c2a63BB08b090b46eb612235604dEB8150A4A1`](https://basescan.org/address/0x77c2a63BB08b090b46eb612235604dEB8150A4A1) |
| Implementation | [`0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA`](https://basescan.org/address/0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA) |

Source & self-hosted setup: [github.com/0xArtex/agentwallet-aos](https://github.com/0xArtex/agentwallet-aos)

## License

MIT
