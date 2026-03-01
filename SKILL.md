# AgentWallet — Non-Custodial Smart Wallets for AI Agents

Non-custodial smart wallets with on-chain policy enforcement. Your agent gets a real wallet with spending limits, blacklists, and human oversight — all enforced by smart contracts, not trust.

**Network:** Base Sepolia (testnet)
**Base URL:** `https://agntos.dev/wallet`

## Quick Start

### 1. Create a wallet
```bash
curl -X POST https://agntos.dev/wallet \
  -H "Content-Type: application/json" \
  -d '{"owner": "<HUMAN_ADDRESS>", "agent": "<AGENT_ADDRESS>"}'
```

Response:
```json
{
  "wallet": {
    "address": "0x...",
    "owner": "0x...",
    "agent": "0x...",
    "chain": "base",
    "policy": {
      "dailyLimit": "50000000",
      "perTxLimit": "25000000",
      "paused": false
    },
    "spentToday": "0",
    "remainingDaily": "50000000",
    "gasBalance": "28000000000000"
  }
}
```

- `owner` = human's address (controls policy, can pause/withdraw)
- `agent` = agent's address (can transact within limits)
- Gas is auto-funded on creation (~$0.07, covers ~140 txs)
- Default limits: 50 USDC/day, 25 USDC/tx

### 2. Check wallet status
```
GET https://agntos.dev/wallet/<WALLET_ADDRESS>
```

### 3. Predict wallet address (before creation)
```bash
curl -X POST https://agntos.dev/wallet/predict \
  -H "Content-Type: application/json" \
  -d '{"owner": "<HUMAN_ADDRESS>", "agent": "<AGENT_ADDRESS>"}'
```

## Transactions

Agents transact directly with the smart contract on-chain using their private key. All transactions execute immediately if within limits. If limits are exceeded, the transaction reverts.

The wallet contract is at the address returned by `/wallet`. Call `execute()` or `executeERC20()` with the agent's key:

- `execute(to, amount, data)` — send ETH or call any contract
- `executeERC20(token, to, amount)` — transfer ERC20 tokens

## Policy Management (Human/Owner)

### Update limits
```bash
curl -X POST https://agntos.dev/wallet/<WALLET_ADDRESS>/policy \
  -H "Content-Type: application/json" \
  -d '{"ownerKey": "<OWNER_PRIVATE_KEY>", "dailyLimit": "500000000", "perTxLimit": "200000000"}'
```
Pass `0` for any field to keep the current value. Changes take effect immediately.

### Blacklist an address
```bash
curl -X POST https://agntos.dev/wallet/<WALLET_ADDRESS>/blacklist \
  -H "Content-Type: application/json" \
  -d '{"ownerKey": "<OWNER_PRIVATE_KEY>", "address": "0xSCAM...", "blocked": true}'
```

### Batch blacklist
```bash
curl -X POST https://agntos.dev/wallet/<WALLET_ADDRESS>/blacklist/batch \
  -H "Content-Type: application/json" \
  -d '{"ownerKey": "<OWNER_PRIVATE_KEY>", "addresses": ["0x...", "0x..."], "blocked": true}'
```

### Check if address is blacklisted
```
GET https://agntos.dev/wallet/<WALLET_ADDRESS>/blacklist/<TARGET_ADDRESS>
```

## How It Works

- **Hard limits, not queues** — transactions execute instantly or revert. No approval queues.
- **Daily limit** — resets every 24h. Hit it? Wait for tomorrow or ask human to raise it.
- **Per-tx limit** — single transaction cap. Prevents draining.
- **Blacklist** — human blocks specific addresses. Agent can never send to them.
- **Pause** — emergency brake. Human pauses, all agent txs revert until unpaused.
- **Emergency withdraw** — human can pull all funds at any time.
- **Agent key rotation** — human can replace or revoke the agent's key instantly.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /wallet/health | Service health + chain status |
| POST | /wallet | Create new wallet |
| GET | /wallet/:address | Get wallet info + policy + balances |
| POST | /wallet/predict | Predict address before creation |
| POST | /wallet/:address/policy | Update spending limits |
| POST | /wallet/:address/blacklist | Block/unblock an address |
| POST | /wallet/:address/blacklist/batch | Batch block/unblock |
| GET | /wallet/:address/blacklist/:target | Check if address is blocked |
| POST | /wallet/:address/topup | Top up gas (admin) |
| GET | /wallet/stats | Total wallets deployed |

## Security Model

- **Non-custodial**: agent's private key never leaves the agent's machine
- **On-chain enforcement**: policies are in the smart contract, not in our API
- **No backdoors**: even we (the provider) cannot move funds or override policies
- **Human controls**: owner can pause, withdraw, revoke, blacklist at any time
- **Gas auto-funded**: agent never needs to acquire gas manually

## Contract Addresses (Base Sepolia)

- Factory: `0x449bd8C8105f0584ab8437596D553cDf4a457aa4`
- Chain ID: 84532
