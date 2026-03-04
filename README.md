# AgentWallet

Non-custodial smart wallets for AI agents. On-chain policy enforcement, passkey-based human control, gasless transactions.

## What is this?

AgentWallet gives AI agents real wallets on **Base** with built-in spending limits and human oversight — without anyone ever touching the agent's private keys.

**Key properties:**
- **Non-custodial** — agent generates keypair locally, private key never leaves agent's machine
- **On-chain limits** — daily and per-transaction caps enforced by the smart contract
- **Passkey owner** — human controls the wallet via FaceID/TouchID/YubiKey/Ledger (WebAuthn P-256, verified on-chain via RIP-7212)
- **Chainlink oracle** — ETH transfers auto-converted to USD for limit tracking
- **Per-token limits** — optional spending caps on any ERC-20 token
- **Gasless** — factory seeds each wallet with gas on creation

## How it works

```
Agent creates wallet → Human registers passkey → Agent transacts within limits
                              ↓
                     Human can: raise/lower limits,
                     pause wallet, set token limits,
                     blacklist addresses, emergency withdraw
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

## API

### Create a wallet

```bash
# Managed (human sets up passkey later)
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xAgentPublicKey"}'

# Returns: wallet address + setup URL for human
```

```bash
# Unmanaged (no human owner)
curl -X POST https://agntos.dev/wallet/wallet \
  -H "Content-Type: application/json" \
  -d '{"agent": "0xAgentPublicKey", "mode": "unmanaged"}'
```

### Get wallet info

```bash
curl https://agntos.dev/wallet/wallet/0xWalletAddress
```

### Request limit change (agent → human)

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

# Returns a URL the agent sends to its human
# Human opens link → reviews → authenticates with passkey → done
```

### Request token limit

```bash
curl -X POST https://agntos.dev/wallet/approve/request \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0xWalletAddress",
    "action": "tokenLimit",
    "token": "0xTokenAddress",
    "tokenDailyLimit": "1000",
    "tokenPerTxLimit": "300",
    "tokenDecimals": "18",
    "reason": "Cap exposure on this token"
  }'
```

### Stats

```bash
curl https://agntos.dev/wallet/stats
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
- **Oracle staleness check** — rejects transactions if price data is >1 hour old
- **Nonce-based replay protection** — passkey signatures can't be replayed

### Deployments

**Base Mainnet**
| Contract | Address |
|----------|---------|
| Factory | `0x77c2a63BB08b090b46eb612235604dEB8150A4A1` |
| Implementation | `0xEF85c0F9D468632Ff97a36235FC73d70cc19BAbA` |
| Chainlink ETH/USD | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

**Base Sepolia (testnet)**
| Contract | Address |
|----------|---------|
| Factory | `0x8eD17B67B8C1A24020236987BeD28F9609e93B06` |
| Implementation | `0xFB93e5245303827426Fb1A40D9168Cb738de1F2f` |
| Mock Oracle | `0x65E246C24118CF6439152d725Ad0072ce469805c` |

## Project structure

```
contracts/
  base/
    src/
      AgentWallet.sol         — Smart wallet with policy enforcement
      AgentWalletFactory.sol  — Factory with gas seeding
      IAgentWallet.sol        — Interface and events
      PasskeyVerifier.sol     — WebAuthn P-256 on-chain verification
    test/
      AgentWallet.t.sol       — 45 Forge tests
    script/
      Deploy.s.sol            — Factory deployment
      DeployOracle.s.sol      — Mock oracle for testnet
  solana/                     — Solana program (coming soon)
src/
  api/
    server.ts                 — REST API (Express)
  base/
    client.ts                 — Base wallet SDK
    abi/                      — Contract ABIs
  web/
    setup.html                — Passkey registration page
    approve.html              — Human approval page
```

## Development

```bash
# Install
cd src && npm install

# Build
npm run build

# Run API server
ADMIN_PRIVATE_KEY=0x... FACTORY_ADDRESS=0x... BASE_RPC=https://... node dist/api/server.js

# Run contract tests
cd contracts/base
forge test -v
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

## Security model

1. **Agent key** — can execute transactions within policy limits only
2. **Owner (passkey)** — can change limits, pause, blacklist, withdraw. Passkey private key lives in device secure enclave (never exported)
3. **Backend** — relays passkey-signed transactions to chain. Cannot forge signatures. If backend is compromised, on-chain limits still hold.
4. **Oracle** — Chainlink ETH/USD feed (8 decimals, aggregated from multiple sources). 1-hour staleness check prevents stale price exploitation.

The backend is a **convenience layer** — all security-critical logic is on-chain. An agent could interact with the contract directly, bypassing the API entirely.

## License

MIT
