#!/usr/bin/env node

const BASE_URL = process.env.AGENTWALLET_URL || "https://agntos.dev/wallet";

// ─── Helpers ───

function usage() {
  console.log(`
  agentwallet — Non-custodial smart wallets for AI agents

  Usage:
    agentwallet create [--unmanaged]          Create a wallet
    agentwallet status <wallet>               Get wallet info
    agentwallet request-increase <wallet>     Request limit increase from human
    agentwallet set-token-limit <wallet>      Request token limit from human
    agentwallet remove-token-limit <wallet>   Request token limit removal
    agentwallet pause <wallet>                Request wallet pause
    agentwallet unpause <wallet>              Request wallet unpause

  Options:
    --agent <address>        Agent public key (required for create)
    --daily <usd>            Daily limit in USD
    --pertx <usd>            Per-transaction limit in USD
    --token <address>        Token contract address
    --token-daily <amount>   Token daily limit (in token units)
    --token-pertx <amount>   Token per-tx limit (in token units)
    --decimals <n>           Token decimals (default: 18)
    --reason <text>          Reason for the request
    --url <base_url>         API base URL (default: https://agntos.dev/wallet)
    --json                   Output raw JSON

  Environment:
    AGENTWALLET_URL          Override API base URL
    AGENTWALLET_AGENT        Default agent address

  Examples:
    agentwallet create --agent 0x1234...
    agentwallet create --agent 0x1234... --unmanaged
    agentwallet status 0xWallet...
    agentwallet request-increase 0xWallet... --daily 200 --pertx 100
    agentwallet set-token-limit 0xWallet... --token 0xToken... --token-daily 1000 --token-pertx 300
`);
  process.exit(0);
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = "";

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!command && !arg.startsWith("-")) {
      command = arg;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

async function api(method: string, path: string, body?: any): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();
  if (data.error) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }
  return data;
}

function requireArg(flags: Record<string, string | boolean>, key: string, envFallback?: string): string {
  const val = flags[key] || (envFallback ? process.env[envFallback] : "");
  if (!val || val === true) {
    console.error(`Error: --${key} is required`);
    process.exit(1);
  }
  return val as string;
}

function requireWallet(positional: string[]): string {
  if (!positional[0]) {
    console.error("Error: wallet address required");
    process.exit(1);
  }
  return positional[0];
}

// ─── Commands ───

async function cmdCreate(flags: Record<string, string | boolean>) {
  const agent = requireArg(flags, "agent", "AGENTWALLET_AGENT");
  const mode = flags.unmanaged ? "unmanaged" : undefined;

  const body: any = { agent };
  if (mode) body.mode = mode;

  const data = await api("POST", "/wallet", body);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const w = data.wallet;
  console.log(`\n  Wallet created\n`);
  console.log(`  Address:        ${w.address}`);
  console.log(`  Agent:          ${w.agent}`);
  console.log(`  Mode:           ${data.mode || "managed"}`);
  console.log(`  Daily limit:    $${parseInt(w.policy.dailyLimit) / 1e6}`);
  console.log(`  Per-tx limit:   $${parseInt(w.policy.perTxLimit) / 1e6}`);
  console.log(`  Gas balance:    ${parseInt(w.gasBalance) / 1e18} ETH`);

  if (data.setupUrl) {
    console.log(`\n  Setup URL (send to your human):\n  ${data.setupUrl}`);
  }
  console.log();
}

async function cmdStatus(positional: string[], flags: Record<string, string | boolean>) {
  const wallet = requireWallet(positional);
  const data = await api("GET", `/wallet/${wallet}`);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const w = data.wallet;
  console.log(`\n  Wallet ${w.address}\n`);
  console.log(`  Owner:          ${w.owner === "0x0000000000000000000000000000000000000000" ? "(passkey)" : w.owner}`);
  console.log(`  Agent:          ${w.agent}`);
  console.log(`  Chain:          ${w.chain}`);
  console.log(`  Daily limit:    $${parseInt(w.policy.dailyLimit) / 1e6}`);
  console.log(`  Per-tx limit:   $${parseInt(w.policy.perTxLimit) / 1e6}`);
  console.log(`  Paused:         ${w.policy.paused}`);
  console.log(`  Spent today:    $${parseInt(w.spentToday) / 1e6}`);
  console.log(`  Remaining:      $${parseInt(w.remainingDaily) / 1e6}`);
  console.log(`  Gas balance:    ${parseInt(w.gasBalance) / 1e18} ETH`);
  console.log();
}

async function cmdRequestIncrease(positional: string[], flags: Record<string, string | boolean>) {
  const wallet = requireWallet(positional);
  const body: any = {
    wallet,
    action: "limits",
  };
  if (flags.daily) body.dailyLimit = flags.daily as string;
  if (flags.pertx) body.perTxLimit = flags.pertx as string;
  if (flags.reason) body.reason = flags.reason as string;

  if (!body.dailyLimit && !body.perTxLimit) {
    console.error("Error: --daily and/or --pertx required");
    process.exit(1);
  }

  const data = await api("POST", "/approve/request", body);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`\n  Approval URL (send to your human):\n  ${data.approvalUrl}\n`);
}

async function cmdSetTokenLimit(positional: string[], flags: Record<string, string | boolean>) {
  const wallet = requireWallet(positional);
  const token = requireArg(flags, "token");
  const tokenDaily = requireArg(flags, "token-daily");
  const tokenPertx = requireArg(flags, "token-pertx");
  const decimals = (flags.decimals as string) || "18";

  const body: any = {
    wallet,
    action: "tokenLimit",
    token,
    tokenDailyLimit: tokenDaily,
    tokenPerTxLimit: tokenPertx,
    tokenDecimals: decimals,
  };
  if (flags.reason) body.reason = flags.reason as string;

  const data = await api("POST", "/approve/request", body);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`\n  Approval URL (send to your human):\n  ${data.approvalUrl}\n`);
}

async function cmdRemoveTokenLimit(positional: string[], flags: Record<string, string | boolean>) {
  const wallet = requireWallet(positional);
  const token = requireArg(flags, "token");

  const body: any = {
    wallet,
    action: "removeTokenLimit",
    token,
  };
  if (flags.reason) body.reason = flags.reason as string;

  const data = await api("POST", "/approve/request", body);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`\n  Approval URL (send to your human):\n  ${data.approvalUrl}\n`);
}

async function cmdPause(positional: string[], flags: Record<string, string | boolean>) {
  const wallet = requireWallet(positional);
  const data = await api("POST", "/approve/request", { wallet, action: "pause", reason: flags.reason || undefined });

  if (flags.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  Approval URL (send to your human):\n  ${data.approvalUrl}\n`);
}

async function cmdUnpause(positional: string[], flags: Record<string, string | boolean>) {
  const wallet = requireWallet(positional);
  const data = await api("POST", "/approve/request", { wallet, action: "unpause", reason: flags.reason || undefined });

  if (flags.json) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`\n  Approval URL (send to your human):\n  ${data.approvalUrl}\n`);
}

// ─── Main ───

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  if (flags.url) {
    // Override BASE_URL — this is a hack but works for CLI
    (globalThis as any).__BASE_URL = flags.url;
  }

  if (!command || flags.help || flags.h) usage();

  switch (command) {
    case "create":
      await cmdCreate(flags);
      break;
    case "status":
      await cmdStatus(positional, flags);
      break;
    case "request-increase":
      await cmdRequestIncrease(positional, flags);
      break;
    case "set-token-limit":
      await cmdSetTokenLimit(positional, flags);
      break;
    case "remove-token-limit":
      await cmdRemoveTokenLimit(positional, flags);
      break;
    case "pause":
      await cmdPause(positional, flags);
      break;
    case "unpause":
      await cmdUnpause(positional, flags);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
