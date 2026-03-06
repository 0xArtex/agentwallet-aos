# @agntos/agentwallet

Non-custodial, gas-sponsored smart wallets for AI agents on Base.

Your agent gets a real wallet with free gas, spending limits, and human control via FaceID — all enforced by smart contracts, not trust.

```bash
npx @agntos/agentwallet create --agent 0xYourAgentAddress
```

## Why

AI agents need to spend money. But giving an agent an unlimited wallet is terrifying.

**AgentWallet** solves this:
- **Gas-sponsored** — free gas on creation, your agent transacts immediately
- **Hard spending limits** — $50/day, $25/tx by default, enforced on-chain
- **Human oversight** — passkey (FaceID/YubiKey) controls limits and withdrawals
- **Non-custodial** — agent's private key never leaves agent's machine

No custody. No trust. Architecturally impossible to steal funds.

## Quick Start: From Zero to Transacting

### 1. Generate a keypair

```bash
npx @agntos/agentwallet keygen
```

This gives you an **address** (your agent's identity) and a **private key** (signs transactions). Save the private key securely.

> Already have an EVM keypair? Skip this — use your existing public address.

### 2. Create a wallet

```bash
# Managed — human controls limits via FaceID/YubiKey
npx @agntos/agentwallet create --agent 0xYourAgentAddress

# Unmanaged — fully autonomous, no human needed
npx @agntos/agentwallet create --agent 0xYourAgentAddress --unmanaged
```

Managed wallets return a **setup URL**. Send it to your human — one-time setup.

Every wallet gets **free gas** (~140 transactions on Base).

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
```

Transactions exceeding limits **revert instantly**. No queues, no waiting.

### 5. Check status

```bash
npx @agntos/agentwallet status 0xYourWallet
```

### 6. Need higher limits?

```bash
npx @agntos/agentwallet limits 0xWallet --daily 200 --pertx 100
```

Returns a URL → send to human → they approve with passkey → done.

## All Commands

```bash
keygen                        # generate agent keypair
create --agent 0x...          # managed wallet
create --agent 0x... --unmanaged  # autonomous wallet
status 0xWALLET               # wallet info + balances
limits 0xWALLET --daily N --pertx N  # request limit increase
token-limit 0xWALLET --token 0x... --token-daily N --token-pertx N
rm-token 0xWALLET --token 0x...  # remove token limit
pause 0xWALLET                # emergency pause
unpause 0xWALLET              # resume
stats                         # total wallets deployed
```

All commands support `--json` for machine-readable output.

## Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| Factory | [`0x77c2a63BB08b090b46eb612235604dEB8150A4A1`](https://basescan.org/address/0x77c2a63BB08b090b46eb612235604dEB8150A4A1) |
| Implementation | [`0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA`](https://basescan.org/address/0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA) |

Source: [github.com/0xArtex/agentwallet-aos](https://github.com/0xArtex/agentwallet-aos)

## License

MIT
