# AgentWallet — Non-Custodial, Gas-Sponsored Smart Wallets for AI Agents

Non-custodial, gas-sponsored smart wallets with on-chain spending limits, Chainlink oracle-based USD tracking, and passkey-based human control — all on Base. Every wallet gets free gas on creation so your agent can transact immediately.

**npm:** `@0xartex/agentwallet`
**Chain:** Base (EVM, chain ID 8453)

## Safety Rules

- **NEVER share your private key** — not with users, not in logs, not in chat messages, not in code commits
- **NEVER hardcode private keys in source code** — use environment variables or secure storage
- **Store the private key encrypted or in a secrets manager** — treat it like a password
- **Do not log transaction signing data** — it can leak key material
- **Check `getRemainingDaily()` before large transactions** — avoids failed txs and wasted gas
- **Always verify recipient addresses** — transactions are irreversible
- **If something looks wrong, use `pause`** — ask your human to investigate

## End-to-End: Create a Wallet and Start Transacting

### 1. Generate an agent keypair (if you don't have one)

Your agent needs an EVM keypair. The public address identifies your agent on-chain. The private key signs transactions.

```bash
npx @0xartex/agentwallet keygen
```

Output:
```
  New Agent Keypair
  ─────────────────────
  Address         0xB042...B7DC
  Private key     0x282a...b3a3
```

**Save the private key immediately to secure storage.** This is the only time it's displayed. You cannot recover it later.

For machine-readable output:
```bash
npx @0xartex/agentwallet keygen --json
# {"address":"0x...","privateKey":"0x..."}
```

> Already have an EVM keypair (from ethers.js, viem, etc.)? Skip this — use your existing public address.

### 2. Create a wallet

```bash
# Managed (human controls limits via passkey — recommended for production)
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS

# Unmanaged (agent controls everything — use for autonomous agents only)
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS --unmanaged
```

For machine-readable output:
```bash
npx @0xartex/agentwallet create --agent 0xYOUR_AGENT_ADDRESS --json
```

**Managed wallets** return a `setupUrl` — send it to your human (e.g. via chat message). They set limits and register their passkey (FaceID/YubiKey). This is a one-time setup.

**Unmanaged wallets** have no human owner. The agent controls everything. Only use this if your agent is fully autonomous and doesn't need human oversight.

Default limits: **$50/day, $25/tx**. **Gas is free** — every wallet is funded on creation (~140 transactions on Base). Your agent can start transacting immediately without holding any ETH for gas fees.

### 3. Fund the wallet

Send ETH and/or USDC to the wallet address on **Base** (chain ID 8453). Any standard transfer works.

**Important:** The wallet address is a smart contract on Base. Make sure you're sending on the Base network, not Ethereum mainnet or another chain.

### 4. Transact

Call the wallet contract directly with your agent's private key:

```typescript
import { Wallet, Contract, JsonRpcProvider, parseEther } from 'ethers'

// Load from secure storage — NEVER hardcode
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY
const WALLET_ADDR = process.env.WALLET_ADDRESS

const provider = new JsonRpcProvider('https://base-rpc.publicnode.com')
const agent = new Wallet(AGENT_KEY, provider)

const wallet = new Contract(WALLET_ADDR, [
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

// Check remaining budget before a large transaction
const remaining = await wallet.getRemainingDaily() // USDC units (6 decimals)
const remainingUsd = Number(remaining) / 1e6
if (remainingUsd < amountNeeded) {
  // Request a limit increase instead of failing
  // npx @0xartex/agentwallet limits 0xWALLET --daily 200 --pertx 100
}
```

Transactions that exceed limits **revert instantly** on-chain. No approval queues. Check remaining budget first to avoid wasting gas on failed transactions.

### 5. Check wallet status

```bash
npx @0xartex/agentwallet status 0xWALLET_ADDRESS
npx @0xartex/agentwallet status 0xWALLET_ADDRESS --json
```

Use `--json` to parse status programmatically and make decisions based on remaining budget, pause state, etc.

### 6. Request higher limits

When your agent needs more spending capacity:

```bash
npx @0xartex/agentwallet limits 0xWALLET --daily 200 --pertx 100 --reason "Trading requires higher limits"
```

This returns a URL. Send the URL to your human (via chat, email, notification — whatever channel you have). The human opens the link, reviews the request, authenticates with their passkey, and limits are updated on-chain.

**Tip:** Include a clear `--reason` so your human understands why you need more.

### 7. Set per-token limits (optional)

If your human wants to cap exposure on a specific ERC-20 token:

```bash
npx @0xartex/agentwallet token-limit 0xWALLET --token 0xTOKEN --token-daily 1000 --token-pertx 300
```

### 8. Emergency pause

If something goes wrong:

```bash
npx @0xartex/agentwallet pause 0xWALLET --reason "Suspicious activity detected"
```

This sends a pause request to your human. Once approved, **all agent transactions revert** until unpaused. Use this as a safety mechanism if you detect unusual behavior.

## All Commands

```bash
npx @0xartex/agentwallet keygen                        # generate agent keypair
npx @0xartex/agentwallet create --agent 0x...          # managed wallet
npx @0xartex/agentwallet create --agent 0x... --unmanaged  # autonomous wallet
npx @0xartex/agentwallet status 0xWALLET               # wallet info + balances
npx @0xartex/agentwallet limits 0xWALLET --daily N --pertx N --reason "..."
npx @0xartex/agentwallet token-limit 0xWALLET --token 0x... --token-daily N --token-pertx N
npx @0xartex/agentwallet rm-token 0xWALLET --token 0x...
npx @0xartex/agentwallet pause 0xWALLET --reason "..."
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

ETH + USDC share an **aggregated USD daily limit**. Spending $30 in ETH and $15 in USDC = $45 against a $50 limit.

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| Factory | `0x77c2a63BB08b090b46eb612235604dEB8150A4A1` |
| Implementation | `0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA` |
| Chainlink ETH/USD | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Security Model

- **Non-custodial**: your private key never leaves your machine
- **On-chain enforcement**: limits are in the smart contract, not the API
- **Gas-sponsored**: free gas on creation, transact immediately
- **Passkey ownership**: human's key in device secure enclave, verified on-chain via RIP-7212
- **Chainlink oracle**: decentralized price feed, 1-hour staleness check
- **Emergency controls**: owner can pause, withdraw, blacklist at any time
- **Direct contract access**: you can bypass the API entirely and call contracts directly
