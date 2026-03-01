---
name: agentwallet-aos
version: 0.1.0
description: Non-custodial smart wallets for AI agents with on-chain policy enforcement. Base + Solana. Gasless.
homepage: https://github.com/0xArtex/agentwallet-aos
---

# AgentWallet

Non-custodial smart wallets for AI agents. Your keys stay on your machine. Policies enforced on-chain.

## Quick Start

```bash
# Create a wallet (agent generates keypair locally, sends only the public key)
curl -X POST https://agntos.dev/wallet \
  -H "Content-Type: application/json" \
  -d '{"owner": "0xHUMAN_ADDRESS", "agent": "0xAGENT_ADDRESS"}'
```

Response:
```json
{
  "success": true,
  "wallet": {
    "address": "0x...",
    "chain": "base",
    "policy": {
      "dailyLimit": "50000000",
      "perTxLimit": "25000000",
      "approvalThreshold": "25000000",
      "paused": false
    },
    "gasBalance": "1000000000000000"
  }
}
```

## Default Policies

| Policy | Default | Description |
|--------|---------|-------------|
| Daily Limit | 50 USDC | Max spend per 24h rolling window |
| Per-Tx Limit | 25 USDC | Max per single transaction |
| Approval Threshold | 25 USDC | Above this → queued for human approval |
| Gas Seed | ~$0.07 | Auto-funded on creation, covers ~140 txs |

Agent can transact immediately. Human tunes policies later.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /wallet | Create wallet (owner + agent addresses) |
| GET | /wallet/:address | Get wallet info + policy + balances |
| POST | /wallet/predict | Predict address before deployment |
| POST | /wallet/:address/policy | Update spending limits (owner) |
| POST | /wallet/:address/approve/:txId | Approve pending tx (owner) |
| POST | /wallet/:address/cancel/:txId | Cancel pending tx (owner) |
| GET | /wallet/:address/pending/:txId | Get pending tx details |
| POST | /wallet/:address/topup | Top up gas (admin) |
| GET | /stats | Total wallets deployed |
| GET | /health | Service health + chain status |

## How It Works

1. **Agent generates keypair locally** — private key never leaves the agent's machine
2. **Smart wallet deployed on-chain** — agent = session key, human = owner
3. **Policies enforced by the contract** — not by us, not by trust — by math
4. **Tx within limits** → executes instantly
5. **Tx above threshold** → queued, human approves via their wallet
6. **Gas auto-funded** — agent never thinks about gas fees

## Chains

- **Base** — ERC-4337 smart contract wallets (live)
- **Solana** — PDA-based program wallets (coming soon)

## Security

- Provider NEVER sees private keys
- Policies are on-chain and immutable without owner signature
- Human can revoke agent access with one transaction
- Open source — audit the contracts yourself
