#!/usr/bin/env node

const API = process.env.AGENTWALLET_API || "https://agntos.dev/wallet";
const args = process.argv.slice(2);
const cmd = args[0];

function flag(name: string): string | undefined {
  const i = args.indexOf("--" + name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function hasFlag(name: string): boolean {
  return args.includes("--" + name);
}

async function api(method: string, path: string, body?: any): Promise<any> {
  const opts: any = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function print(obj: any) {
  console.log(JSON.stringify(obj, null, 2));
}

// ─── Commands ───

async function keygen() {
  const { ethers } = await import("ethers");
  const wallet = ethers.Wallet.createRandom();

  console.log("");
  console.log("  New agent keypair generated:");
  console.log("");
  console.log("  Address:     " + wallet.address);
  console.log("  Private key: " + wallet.privateKey);
  console.log("");
  console.log("  Save the private key securely. You'll need it to sign transactions.");
  console.log("  Use the address with 'agentwallet create --agent " + wallet.address + "'");

  console.log("");
  console.log("---");
  print({ address: wallet.address, privateKey: wallet.privateKey });
}

async function create() {
  const mode = hasFlag("unmanaged") ? "unmanaged" : "managed";
  let agent = flag("agent");

  // Auto-generate agent keypair if not provided
  let privateKey: string | null = null;
  if (!agent) {
    const { ethers } = await import("ethers");
    const kp = ethers.Wallet.createRandom();
    agent = kp.address;
    privateKey = kp.privateKey;
  }

  console.log(`Creating ${mode} wallet...`);
  const data = await api("POST", "/wallet", { agent, mode });

  console.log("");
  console.log("  Wallet created!");
  console.log("");
  console.log("  ┌─ Wallet (fund this address) ────────────┐");
  console.log("  │  " + data.wallet.address);
  console.log("  └─────────────────────────────────────────┘");
  console.log("");
  if (privateKey) {
    console.log("  Agent key (save this — you sign transactions with it):");
    console.log("    Address:     " + agent);
    console.log("    Private key: " + privateKey);
    console.log("");
  } else {
    console.log("  Agent key:  " + agent);
    console.log("");
  }
  console.log("  Chain:    Base (Sepolia testnet)");
  console.log("  Daily:    " + parseInt(data.wallet.policy.dailyLimit) / 1e6 + " USDC");
  console.log("  Per-tx:   " + parseInt(data.wallet.policy.perTxLimit) / 1e6 + " USDC");

  if (mode === "managed" && data.setupUrl) {
    console.log("");
    console.log("  ┌─ Setup link (send to your human) ───────┐");
    console.log("  │  They register FaceID/fingerprint to     │");
    console.log("  │  become owner and set spending limits.    │");
    console.log("  └─────────────────────────────────────────┘");
    console.log("");
    console.log("  " + data.setupUrl);
  }

  if (mode === "unmanaged") {
    console.log("");
    console.log("  No human owner. You have full control.");
  }

  console.log("");
  console.log("  Next steps:");
  console.log("    1. " + (mode === "managed" ? "Send setup link to your human" : "Fund the wallet"));
  console.log("    2. Human sends ETH/USDC to " + data.wallet.address);
  console.log("    3. Use your private key to sign transactions");

  // Machine-readable output for agents
  console.log("");
  console.log("---");
  print({
    wallet: data.wallet.address,
    agentAddress: agent,
    agentPrivateKey: privateKey,
    mode,
    setupUrl: data.setupUrl || null,
    policy: data.wallet.policy
  });
}

async function walletStatus() {
  const addr = flag("wallet") || args[1];
  if (!addr) {
    console.error(`
  agentwallet status <ADDRESS>

  Check wallet status, limits, and spending.

  Examples:
    agentwallet status 0x1234...abcd
    agentwallet status --wallet 0x1234...abcd
`);
    process.exit(1);
  }

  const data = await api("GET", "/wallet/" + addr);
  const w = data.wallet;
  const daily = parseInt(w.policy.dailyLimit) / 1e6;
  const perTx = parseInt(w.policy.perTxLimit) / 1e6;
  const spent = parseInt(w.spentToday) / 1e6;
  const remaining = parseInt(w.remainingDaily) / 1e6;
  const gas = parseFloat(w.gasBalance) / 1e18;

  console.log("");
  console.log("  Wallet:     " + w.address);
  console.log("  Owner:      " + (w.owner === "0x0000000000000000000000000000000000000000" ? "Passkey (non-custodial)" : w.owner));
  console.log("  Agent:      " + w.agent);
  console.log("  Chain:      " + w.chain);
  console.log("  Paused:     " + (w.policy.paused ? "YES" : "no"));
  console.log("");
  console.log("  Limits:");
  console.log("    Daily:    " + daily + " USDC  (spent " + spent + " / remaining " + remaining + ")");
  console.log("    Per-tx:   " + perTx + " USDC");
  console.log("  Gas:        " + gas.toFixed(6) + " ETH");

  console.log("");
  console.log("---");
  print(w);
}

async function send() {
  const wallet = flag("wallet");
  const to = flag("to");
  const amount = flag("amount");
  const key = flag("key") || process.env.AGENTWALLET_KEY;
  const token = flag("token"); // ERC20 address, omit for ETH

  if (!wallet || !to || !amount || !key) {
    console.error(`
  agentwallet send --wallet <WALLET> --to <RECIPIENT> --amount <AMOUNT> --key <PRIVATE_KEY>

  Send funds from your wallet. Amount is in the token's native units (USDC = dollars).

  --wallet   Your smart wallet address (required)
  --to       Recipient address (required)
  --amount   Amount to send in USDC/ETH (required)
  --key      Your agent private key (required, or set AGENTWALLET_KEY env var)
  --token    ERC20 token address (omit for native ETH)

  Examples:
    agentwallet send --wallet 0xWallet --to 0xRecipient --amount 10 --key 0xPrivKey
    AGENTWALLET_KEY=0xPrivKey agentwallet send --wallet 0xW --to 0xR --amount 5
`);
    process.exit(1);
  }

  const { ethers } = await import("ethers");
  const { readFileSync } = await import("fs");
  const { join, dirname } = await import("path");
  const { fileURLToPath } = await import("url");

  // Use public RPC — agent doesn't need our backend for transactions
  const RPC = process.env.AGENTWALLET_RPC || "https://base-sepolia-rpc.publicnode.com";
  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(key, provider);

  // Minimal ABI for execute and executeERC20
  const WALLET_ABI = [
    "function execute(address to, uint256 value, bytes calldata data) external",
    "function executeERC20(address token, address to, uint256 amount) external"
  ];

  const contract = new ethers.Contract(wallet, WALLET_ABI, signer);

  if (token) {
    // ERC20 transfer — assume 6 decimals (USDC)
    const decimals = 6;
    const raw = BigInt(Math.round(parseFloat(amount) * 10 ** decimals));
    console.log(`Sending ${amount} tokens to ${to}...`);
    const tx = await contract.executeERC20(token, to, raw);
    const receipt = await tx.wait();
    console.log("");
    console.log("  Sent!");
    console.log("  Tx: " + receipt.hash);
    console.log("");
    console.log("---");
    print({ tx: receipt.hash, to, amount, token });
  } else {
    // Native ETH transfer
    const raw = ethers.parseEther(amount);
    console.log(`Sending ${amount} ETH to ${to}...`);
    const tx = await contract.execute(to, raw, "0x");
    const receipt = await tx.wait();
    console.log("");
    console.log("  Sent!");
    console.log("  Tx: " + receipt.hash);
    console.log("");
    console.log("---");
    print({ tx: receipt.hash, to, amount });
  }
}

async function requestIncrease() {
  const addr = flag("wallet") || args[1];
  const daily = flag("daily");
  const perTx = flag("pertx");
  const reason = flag("reason");

  if (!addr) {
    console.error(`
  agentwallet request-increase --wallet <ADDRESS> [options]

  Request a limit increase from the wallet owner.
  Returns a URL to send to your human for passkey approval.

  --wallet   Wallet address (required)
  --daily    New daily limit in USDC (e.g. 200)
  --pertx    New per-tx limit in USDC (e.g. 100)
  --reason   Human-readable reason for the increase

  Examples:
    agentwallet request-increase --wallet 0x1234...abcd --daily 200 --pertx 100
    agentwallet request-increase --wallet 0x1234...abcd --daily 500 --reason "Need to buy NFTs"
`);
    process.exit(1);
  }

  const body: any = { wallet: addr };
  if (daily) body.dailyLimit = String(parseFloat(daily) * 1e6);
  if (perTx) body.perTxLimit = String(parseFloat(perTx) * 1e6);
  if (reason) body.reason = reason;

  const data = await api("POST", "/approve/request", body);

  console.log("");
  console.log("  ┌─────────────────────────────────────────┐");
  console.log("  │  Send this link to your human:          │");
  console.log("  └─────────────────────────────────────────┘");
  console.log("");
  console.log("  " + data.approvalUrl);
  console.log("");
  console.log("  They'll authenticate with their passkey to approve.");

  console.log("");
  console.log("---");
  print({ approvalUrl: data.approvalUrl });
}

async function walletPause() {
  const addr = flag("wallet") || args[1];
  if (!addr) {
    console.error("  Usage: agentwallet pause --wallet <ADDRESS>");
    process.exit(1);
  }

  const data = await api("POST", "/approve/request", { wallet: addr, action: "pause" });
  console.log("");
  console.log("  Send this to your human to pause the wallet:");
  console.log("  " + data.approvalUrl);
  console.log("");
  console.log("---");
  print({ approvalUrl: data.approvalUrl });
}

async function stats() {
  const data = await api("GET", "/stats");
  console.log("");
  console.log("  Total wallets: " + data.totalWallets);
  console.log("");
  console.log("---");
  print(data);
}

function help() {
  console.log(`
  agentwallet — Non-custodial smart wallets for AI agents

  Commands:
    keygen              Generate a new agent keypair
    create              Create a new wallet
    status <addr>       Check wallet status and limits
    send                Send ETH or tokens from your wallet
    request-increase    Request limit increase (returns link for human)
    pause               Request wallet pause (returns link for human)
    stats               Network stats

  Options:
    --agent <addr>      Agent's address (for create)
    --wallet <addr>     Wallet address
    --unmanaged         No human owner (for create)
    --daily <amount>    Daily limit in USDC
    --pertx <amount>    Per-tx limit in USDC
    --reason <text>     Reason for increase request

  Environment:
    AGENTWALLET_API     API endpoint (default: https://agntos.dev/wallet)

  Examples:
    agentwallet create                          # generates key + deploys wallet
    agentwallet create --agent 0xABC...123      # use existing key
    agentwallet create --unmanaged              # no human owner
    agentwallet status 0xDEF...456
    agentwallet request-increase --wallet 0xDEF...456 --daily 200

  Docs: https://github.com/0xArtex/agentwallet-aos
`);
}

// ─── Router ───

async function main() {
  try {
    switch (cmd) {
      case "keygen": await keygen(); break;
      case "create": await create(); break;
      case "status": await walletStatus(); break;
      case "send": await send(); break;
      case "request-increase": await requestIncrease(); break;
      case "pause": await walletPause(); break;
      case "stats": await stats(); break;
      case "help": case "--help": case "-h": case undefined: help(); break;
      default:
        console.error("  Unknown command: " + cmd);
        console.error("  Run 'agentwallet help' for usage.");
        process.exit(1);
    }
  } catch (e: any) {
    console.error("");
    console.error("  Error: " + e.message);
    console.error("");
    process.exit(1);
  }
}

main();
