# AgentWallet — Non-Custodial, Gas-Sponsored Smart Wallets for AI Agents

Non-custodial, gas-sponsored smart wallets with on-chain spending limits, Chainlink oracle-based USD tracking, and passkey-based human control — all on Base. Every wallet gets free gas on creation so your agent can transact immediately.

**npm:** `@0xartex/agentwallet`
**Chain:** Base (EVM, chain ID 8453)

## End-to-End: Create a Wallet and Start Transacting

### 1. Generate an agent keypair (if you don't have one)

Your agent needs an EVM keypair. The public address identifies your agent on-chain. The private key signs transactions.

```bash
npx @0xartex/agentwallet keygen
```

> Already have an EVM keypair (from ethers.js, viem, etc.)? Skip this — use your existing public address.

### 2. Create a wallet

```bash
# Managed (human controls limits via passkey)
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS

# Unmanaged (agent controls everything)
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS --unmanaged
```

Managed wallets return a `setupUrl` — send it to your human. They set limits and register their passkey (FaceID/YubiKey). One-time setup.

Default limits: **$50/day, $25/tx**. **Gas is free** — every wallet is funded with ~$0.07 of gas on creation (~140 transactions on Base). Your agent can start transacting immediately without holding any ETH for fees.

### 3. Fund the wallet

Send ETH and/or USDC to the wallet address on **Base** (chain ID 8453). Any standard transfer works.

### 4. Transact

Call the wallet contract directly with your agent's private key:

```typescript
import { Wallet, Contract, JsonRpcProvider, parseEther } from 'ethers'

const provider = new JsonRpcProvider('https://base-rpc.publicnode.com')
const agent = new Wallet('0xYOUR_AGENT_PRIVATE_KEY', provider)

const wallet = new Contract('0xYOUR_WALLET_ADDRESS', [
  'function execute(address to, uint256 value, bytes data) external',
  'function executeERC20(address token, address to, uint256 amount) external',
  'function getSpentToday() external view returns (uint256)',
  'function getRemainingDaily() external view returns (uint256)',
  'function getPolicy() external view returns (uint256 dailyLimit, uint256 perTxLimit, bool paused)',
], agent)

// Send ETH
await wallet.execute('0xRecipient', parseEther('0.001'), '0x')

// Send USDC (6 decimals)
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
await wallet.executeERC20(USDC, '0xRecipient', 5_000_000n) // 5 USDC

// Call any contract (swap, mint, etc.)
await wallet.execute('0xContractAddr', parseEther('0.01'), '0xEncodedCalldata')

// Check remaining budget
const remaining = await wallet.getRemainingDaily() // in USDC units (6 decimals)
console.log(`Remaining today: $${Number(remaining) / 1e6}`)
```

Transactions that exceed limits **revert instantly**. No approval queues.

### 5. Check wallet status

```bash
npx @0xartex/agentwallet status 0xWALLET_ADDRESS
npx @0xartex/agentwallet status 0xWALLET_ADDRESS --json  # machine-readable
```

### 6. Request higher limits

```bash
npx @0xartex/agentwallet limits 0xWALLET --daily 200 --pertx 100 --reason "Need more for trading"
```

Returns a URL → send to human → they authenticate with passkey → limits updated on-chain.

## All Commands

```bash
npx @0xartex/agentwallet keygen                        # generate agent keypair
npx @0xartex/agentwallet create --agent 0x...          # managed wallet
npx @0xartex/agentwallet create --agent 0x... --unmanaged  # autonomous wallet
npx @0xartex/agentwallet status 0xWALLET               # wallet info + balances
npx @0xartex/agentwallet limits 0xWALLET --daily 200 --pertx 100
npx @0xartex/agentwallet token-limit 0xWALLET --token 0xTOKEN --token-daily 1000 --token-pertx 300
npx @0xartex/agentwallet rm-token 0xWALLET --token 0xTOKEN
npx @0xartex/agentwallet pause 0xWALLET
npx @0xartex/agentwallet unpause 0xWALLET
npx @0xartex/agentwallet stats
```

All commands support `--json` for machine-readable output.

## Limit Tracking

| Asset | Tracking | Limits |
|-------|----------|--------|
| **ETH** | → USD via Chainlink oracle | Shared USD daily + per-tx |
| **USDC** | 1:1 USD | Same shared pool as ETH |
| **Other ERC-20s** | Unlimited by default | Owner can set per-token limits |

ETH + USDC share an **aggregated USD daily limit**.

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| Factory | `0x77c2a63BB08b090b46eb612235604dEB8150A4A1` |
| Implementation | `0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA` |
| Chainlink ETH/USD | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Security Model

- **Non-custodial**: agent's private key never leaves agent's machine
- **On-chain enforcement**: limits in smart contract, not the API
- **Passkey ownership**: human's key in device secure enclave, verified on-chain via RIP-7212
- **Gas-sponsored**: free gas on creation, agent transacts immediately
- **Chainlink oracle**: decentralized price feed, 1-hour staleness check
- **Emergency controls**: owner can pause, withdraw, blacklist at any time
- **Direct contract access**: agent can bypass the API entirely and call contracts directly
