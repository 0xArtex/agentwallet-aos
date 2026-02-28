# AgentWallet

Non-custodial smart wallets for AI agents with on-chain policy enforcement.

## What is this?

AgentWallet gives AI agents real wallets on **Base** and **Solana** with built-in spending limits, human approval flows, and trustless policy enforcement — all without the provider ever touching the private keys.

## How it works

1. Agent generates a keypair **locally** (private key never leaves the agent's machine)
2. Smart wallet deployed with **agent as session key** + **human as owner**
3. Policies enforced **on-chain**: daily limits, per-tx caps, approval thresholds, address blocklists
4. Transactions above threshold → queued for human approval
5. Human can revoke agent access with one transaction

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Agent      │────▶│  Policy Engine    │────▶│  On-Chain    │
│  (has key)   │     │  (checks limits)  │     │  Smart Wallet│
└─────────────┘     └──────────────────┘     └─────────────┘
                           │                        │
                    ┌──────▼──────┐          ┌──────▼──────┐
                    │   Notify    │          │   Execute   │
                    │   Human     │          │   or Queue  │
                    └─────────────┘          └─────────────┘
```

### Base (EVM)
- ERC-4337 smart contract wallets (Solady-based)
- Session keys with scoped permissions
- On-chain policy enforcement (spending limits, approval thresholds)
- Gasless via paymaster

### Solana
- Program-controlled wallets via PDA
- Policy program enforces limits per transaction
- Multi-sig approval for large transactions
- Agent key alone cannot bypass program rules

## Why not custodial?

Every agent wallet provider today is custodial — they hold your keys and you trust them not to rug you. AgentWallet is different:

- **We never see the private key** — architecturally impossible, not just a promise
- **Policies are on-chain** — even if our servers are compromised, limits hold
- **Human stays in control** — revoke agent access anytime with one tx
- **Open source** — audit the contracts yourself

## Project Structure

```
contracts/
  base/       — ERC-4337 smart wallet contracts (Solidity)
  solana/     — Policy program (Anchor/Rust)
src/
  base/       — Base wallet SDK + deployment
  solana/     — Solana wallet SDK + PDA management
  policy/     — Policy engine (limits, approvals, notifications)
  api/        — REST API for wallet management
```

## Status

🚧 Under active development — part of [AgentOS](https://github.com/0xArtex/AgentOS)

## License

MIT
