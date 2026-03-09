# AgentWallet

Non-custodial smart wallets for AI agents on **Base** and **Solana**.

Your agent gets a real wallet with free gas, spending limits, and human control via FaceID — all enforced by smart contracts, not trust.

```bash
# Base
npx @agntos/agentwallet create --agent 0xYourAgentAddress

# Solana
npx @agntos/agentwallet create --chain solana --agent YourSolanaPubkey
```

## Why

AI agents need to spend money. But giving an agent an unlimited wallet is terrifying.

**AgentWallet** solves this:
- **Multi-chain** — Base (EVM) and Solana, same security model on both
- **Gas-sponsored** — every wallet gets free gas on creation. Transact immediately, no ETH/SOL needed for fees
- **Hard spending limits** — $50/day, $25/tx by default, enforced onchain
- **Human oversight** — passkey (FaceID/YubiKey) controls limits, pause, and withdrawals
- **Non-custodial** — agent's private key never leaves the agent's machine. We literally cannot touch your funds.

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

#### Base

| Asset | Tracking | Limits |
|-------|----------|--------|
| **ETH** | Converted to USD via Chainlink oracle | Shared USD daily/per-tx limit |
| **USDC** | Tracked at face value (1:1) | Same shared USD limit as ETH |
| **Other ERC-20s** | Unlimited by default | Owner can set per-token limits |

ETH and USDC spending is **aggregated** — if the daily limit is $50, spending $30 in ETH leaves $20 for USDC (and vice versa).

#### Solana

| Asset | Tracking | Limits |
|-------|----------|--------|
| **SOL** | USD amount passed by agent | Shared USD daily/per-tx limit |
| **SPL tokens** | Per-token tracking | Up to 16 tokens with individual limits |

Limits are USD-denominated (6 decimals). Daily spending resets based on `unix_timestamp / 86400`.

### Wallet modes

| Mode | Owner | Use case |
|------|-------|----------|
| **Managed** | Human (via passkey) | Production agents with human oversight |
| **Unmanaged** | Agent itself | Autonomous agents, no human in the loop |

## Complete Guide: From Zero to Transacting

### Step 1: Generate an agent keypair

#### Base (EVM)

```bash
npx @agntos/agentwallet keygen
```

```
  New Agent Keypair
  ─────────────────────
  Address         0xB042...B7DC
  Private key     0x282a...b3a3
```

#### Solana

```bash
npx @agntos/agentwallet keygen --chain solana
```

```
  New Agent Keypair (Solana)
  ─────────────────────────
  Address         7Kp9...xR4v
  Private key     4vJ2...9mNq
```

> **Already have a keypair?** Use your existing public address — works with ethers.js, viem, @solana/web3.js, or any wallet library.

### Step 2: Create a wallet

```bash
# Base — managed
npx @agntos/agentwallet create --agent 0xYourAgentAddress

# Solana — managed
npx @agntos/agentwallet create --chain solana --agent YourSolanaPubkey

# Either chain — unmanaged (fully autonomous)
npx @agntos/agentwallet create --agent 0x... --unmanaged
npx @agntos/agentwallet create --chain solana --agent PUBKEY --unmanaged
```

For managed wallets, you'll get a **setup URL**. Send it to your human. They open it, set spending limits, and register their passkey (FaceID/fingerprint/YubiKey). That's the one-time setup.

Every wallet gets **free gas** on creation.

### Step 3: Fund the wallet

- **Base:** Send ETH and/or USDC to the wallet address on Base (chain ID 8453)
- **Solana:** Send SOL and/or SPL tokens to the wallet PDA on Solana

### Step 4: Transact

#### Base

```typescript
import { Wallet, Contract, JsonRpcProvider, parseEther } from 'ethers'

const AGENT_KEY = '0x282a...'
const WALLET = '0x...'

const provider = new JsonRpcProvider('https://base-rpc.publicnode.com')
const agent = new Wallet(AGENT_KEY, provider)

const wallet = new Contract(WALLET, [
  'function execute(address to, uint256 value, bytes data) external',
  'function executeERC20(address token, address to, uint256 amount) external',
  'function getSpentToday() external view returns (uint256)',
  'function getRemainingDaily() external view returns (uint256)',
], agent)

// Send ETH
await wallet.execute('0xRecipient', parseEther('0.001'), '0x')

// Send USDC (6 decimals)
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
await wallet.executeERC20(USDC, '0xRecipient', 5_000_000n) // 5 USDC

// Check remaining budget
const remaining = await wallet.getRemainingDaily()
console.log(`Remaining today: $${Number(remaining) / 1e6}`)
```

#### Solana

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

const connection = new Connection('https://api.devnet.solana.com')
const agentKeypair = Keypair.fromSecretKey(bs58.decode(AGENT_PRIVATE_KEY))

// Transfer SOL
await program.methods
  .transferSol(new BN(amountUsdc), new BN(amountLamports))
  .accounts({
    wallet: walletPda,
    agent: agentKeypair.publicKey,
    recipient: recipientPubkey
  })
  .signers([agentKeypair])
  .rpc()

// Transfer SPL token
await program.methods
  .transferToken(new BN(tokenAmount), new BN(amountUsdc))
  .accounts({
    wallet: walletPda,
    agent: agentKeypair.publicKey,
    mint: mintPubkey,
    walletTokenAccount,
    recipientTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID
  })
  .signers([agentKeypair])
  .rpc()
```

Every transaction is checked against spending limits onchain. Exceeds the limit? **Reverts instantly.**

### Step 5: Check your wallet

```bash
npx @agntos/agentwallet status 0xYourWallet       # Base
npx @agntos/agentwallet status YourSolanaWallet    # Solana
```

Auto-detects chain by address format (`0x` = Base, base58 = Solana).

```
  Wallet
  ────────────────
  Address         0x01Ab...0f03
  Owner           Passkey (FaceID/YubiKey)
  Chain           base
  Paused          No

  Spending        ███░░░░░░░░░░░░░░░░░░░░░░░░░░░ 3%
  Spent today     $1.53 / $50
  Remaining       $48.47
  Per-tx limit    $25
  Gas balance     0.001178 ETH
```

### Step 6: Need higher limits?

```bash
npx @agntos/agentwallet limits 0xWallet --daily 200 --pertx 100 --reason "Trading requires higher limits"
```

Returns a URL. Send it to your human → they review → authenticate with passkey → limits updated on-chain.

## All Commands

```bash
npx @agntos/agentwallet keygen                        # generate Base keypair
npx @agntos/agentwallet keygen --chain solana          # generate Solana keypair
npx @agntos/agentwallet create --agent 0x...          # managed wallet (Base)
npx @agntos/agentwallet create --chain solana --agent PUBKEY  # managed wallet (Solana)
npx @agntos/agentwallet create --agent 0x... --unmanaged  # autonomous wallet
npx @agntos/agentwallet status 0xWALLET               # wallet info (auto-detects chain)
npx @agntos/agentwallet limits 0xWALLET --daily 200 --pertx 100
npx @agntos/agentwallet token-limit 0xWALLET --token 0xTOKEN --token-daily 1000 --token-pertx 300
npx @agntos/agentwallet rm-token 0xWALLET --token 0xTOKEN
npx @agntos/agentwallet pause 0xWALLET
npx @agntos/agentwallet unpause 0xWALLET
npx @agntos/agentwallet stats
```

All commands support `--json` for machine-readable output.

## Contracts

### Architecture

- **Base:** Minimal proxy (EIP-1167) smart wallet with dual-mode ownership (EOA or passkey). Factory deploys via CREATE2 (deterministic addresses), seeds gas. PasskeyVerifier uses RIP-7212 precompile.
- **Solana:** Anchor program with PDA wallets (seeds: `["wallet", owner, agent, index]`). Passkey verified via secp256r1 precompile (P-256). Up to 16 per-token spending limits.

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

**Solana Devnet**
| Item | Address |
|------|---------|
| Program | [`4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e`](https://explorer.solana.com/address/4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e?cluster=devnet) |
| IDL Account | [`6tEPFHmaaDMH2rth1jPWyvDDxh6GcZhkAEj9kKTCY9k6`](https://explorer.solana.com/address/6tEPFHmaaDMH2rth1jPWyvDDxh6GcZhkAEj9kKTCY9k6?cluster=devnet) |

## Security Model

1. **Agent key** — can execute transactions within policy limits only
2. **Owner (passkey)** — can change limits, pause, blacklist, withdraw. Private key lives in device secure enclave (never exported)
3. **Irrevocable handoff** — after passkey registration, admin loses control permanently
   - Base: owner set to zero address
   - Solana: owner transferred to dead address `11111111111111111111111111111112`
4. **Backend** — relays passkey-signed transactions to chain. Cannot forge signatures. If compromised, on-chain limits still hold
5. **Oracle** (Base) — Chainlink ETH/USD feed (8 decimals, aggregated from multiple sources). 1-hour staleness check
6. **Passkey verification**
   - Base: RIP-7212 precompile (P-256)
   - Solana: secp256r1 precompile (P-256)

The backend is a **convenience layer** — all security-critical logic is onchain. An agent can interact with the contracts directly, bypassing the API entirely.

## Other Ways to Use AgentWallet

The CLI is the recommended way. But you can also:

- **SDK** — `import { AgentWallet } from '@agntos/agentwallet'` for programmatic use in Node.js/TypeScript
- **REST API** — `POST https://agntos.dev/wallet/wallet` for direct HTTP calls
- **Direct contract calls** — interact with the smart contracts on Base or Solana without any middleware

See the [SKILL.md](SKILL.md) for full API reference.

## Self-Hosted

```bash
git clone https://github.com/0xArtex/agentwallet-aos
cd agentwallet-aos/src && npm install && npm run build

ADMIN_PRIVATE_KEY=0x... \
FACTORY_ADDRESS=0x77c2a63BB08b090b46eb612235604dEB8150A4A1 \
BASE_RPC=https://base-rpc.publicnode.com \
ETH_USD_ORACLE=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70 \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
SOLANA_RPC=https://api.devnet.solana.com \
SOLANA_PROGRAM_ID=4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e \
node dist/api/server.js
```

Then: `npx @agntos/agentwallet create --agent 0x... --url http://localhost:3002`

## Project Structure

```
cli/                          ← npm package (@agntos/agentwallet)
contracts/base/               ← Solidity smart contracts (45 Forge tests)
contracts/solana/             ← Anchor program (Solana)
src/api/                      ← REST API server
src/base/                     ← Base wallet client + ABIs
src/solana/                   ← Solana wallet client
src/web/                      ← Passkey setup + approval pages
docs/                         ← Architecture diagram
```

## License

MIT
