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

async function create() {
  const mode = hasFlag("unmanaged") ? "unmanaged" : "managed";
  const agent = flag("agent");

  if (!agent) {
    console.error(`
  agentwallet create --agent <ADDRESS> [--unmanaged]

  Create a new smart wallet for an AI agent.

  --agent      Agent's Ethereum address (required)
  --unmanaged  Skip human owner setup (agent has full control)

  Examples:
    agentwallet create --agent 0x1234...abcd
    agentwallet create --agent 0x1234...abcd --unmanaged
`);
    process.exit(1);
  }

  console.log(`Creating ${mode} wallet for agent ${agent}...`);
  const data = await api("POST", "/wallet", { agent, mode });

  console.log("");
  console.log("  Wallet created!");
  console.log("");
  console.log("  Address:  " + data.wallet.address);
  console.log("  Agent:    " + data.wallet.agent);
  console.log("  Chain:    Base (Sepolia testnet)");
  console.log("  Mode:     " + mode);
  console.log("  Daily:    " + parseInt(data.wallet.policy.dailyLimit) / 1e6 + " USDC");
  console.log("  Per-tx:   " + parseInt(data.wallet.policy.perTxLimit) / 1e6 + " USDC");

  if (mode === "managed" && data.setupUrl) {
    console.log("");
    console.log("  ┌─────────────────────────────────────────┐");
    console.log("  │  Send this link to your human:          │");
    console.log("  └─────────────────────────────────────────┘");
    console.log("");
    console.log("  " + data.setupUrl);
    console.log("");
    console.log("  They'll register a passkey (FaceID/fingerprint/YubiKey)");
    console.log("  to become the wallet owner and set spending limits.");
  }

  if (mode === "unmanaged") {
    console.log("");
    console.log("  No human owner. Agent has full control.");
    console.log("  Fund the wallet to start transacting.");
  }

  // Machine-readable output for agents
  console.log("");
  console.log("---");
  print({
    address: data.wallet.address,
    agent: data.wallet.agent,
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
    create              Create a new wallet
    status <addr>       Check wallet status and limits
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
    agentwallet create --agent 0xABC...123
    agentwallet status 0xDEF...456
    agentwallet request-increase --wallet 0xDEF...456 --daily 200

  Docs: https://github.com/0xArtex/agentwallet-aos
`);
}

// ─── Router ───

async function main() {
  try {
    switch (cmd) {
      case "create": await create(); break;
      case "status": await walletStatus(); break;
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
