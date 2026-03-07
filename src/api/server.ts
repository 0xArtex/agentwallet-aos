import express from "express";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { BaseWalletClient } from "../base/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Setup tokens: token → {walletAddress, agentAddress, createdAt}
const setupTokens = new Map<string, { wallet: string; agent: string; createdAt: number }>();

// Wallet credential IDs: walletAddress → credentialId (base64) — persisted to disk
const CREDS_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../../data/credentials.json");

function loadCredentials(): Map<string, string> {
  try {
    const data = JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
    return new Map(Object.entries(data));
  } catch { return new Map(); }
}

function saveCredentials(m: Map<string, string>) {
  mkdirSync(dirname(CREDS_FILE), { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify(Object.fromEntries(m), null, 2));
}

const walletCredentials = loadCredentials();

const PORT = parseInt(process.env.PORT || "3002");
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY || "";
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";
const ETH_USD_ORACLE = process.env.ETH_USD_ORACLE || "";
const USDC_ADDRESS = process.env.USDC_ADDRESS || "";

let baseClient: BaseWalletClient | null = null;

if (ADMIN_KEY && FACTORY_ADDRESS) {
  baseClient = new BaseWalletClient(BASE_RPC, ADMIN_KEY, FACTORY_ADDRESS, ETH_USD_ORACLE, USDC_ADDRESS);
  console.log("Base wallet client initialized");
} else {
  console.warn("Missing ADMIN_PRIVATE_KEY or FACTORY_ADDRESS — Base disabled");
}

const requireBase = (_req: any, res: any, next: any) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });
  next();
};

// ─── Health ───
app.get("/health", (_req, res) => {
  res.json({ status: "ok", chains: { base: !!baseClient, solana: false } });
});

// ─── Keygen (generate agent keypair) ───
app.post("/keygen", async (_req, res) => {
  try {
    const { keccak_256 } = await import("@noble/hashes/sha3");
    const privBytes = crypto.randomBytes(32);
    const privateKey = "0x" + privBytes.toString("hex");
    const ecdh = crypto.createECDH("secp256k1");
    ecdh.setPrivateKey(privBytes);
    const pubBytes = ecdh.getPublicKey().subarray(1);
    const hash = Buffer.from(keccak_256(pubBytes));
    const addrBytes = hash.subarray(12);
    const hex = addrBytes.toString("hex");
    const addrHash = Buffer.from(keccak_256(Buffer.from(hex))).toString("hex");
    let checksummed = "0x";
    for (let i = 0; i < 40; i++) checksummed += parseInt(addrHash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
    res.json({ address: checksummed, privateKey });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Create Wallet (unified) ───
// POST /wallet {agent, mode: "managed"|"unmanaged"}
// Defaults to managed if mode not specified
app.post("/wallet", requireBase, async (req, res) => {
  const { agent, mode = "managed" } = req.body;
  if (!agent) return res.status(400).json({ error: "agent address required" });

  if (mode === "managed") {
    try {
      const address = await baseClient!.createManagedWallet(agent);
      await new Promise(r => setTimeout(r, 2000));
      const info = await baseClient!.getWallet(address);
      const token = crypto.randomBytes(32).toString("hex");
      setupTokens.set(token, { wallet: address, agent, createdAt: Date.now() });
      setTimeout(() => setupTokens.delete(token), 86400000);
      // Always use agntos.dev for public URLs since we're behind a proxy
      const baseUrl = process.env.BASE_URL || "https://agntos.dev";
      const setupUrl = `${baseUrl}/wallet/setup?token=${token}&wallet=${address}`;
      res.json({ wallet: info, setupUrl, setupToken: token, mode: "managed" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  } else if (mode === "unmanaged") {
    try {
      const address = await baseClient!.createUnmanagedWallet(agent);
      await new Promise(r => setTimeout(r, 2000));
      const info = await baseClient!.getWallet(address);
      res.json({ wallet: info, mode: "unmanaged" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(400).json({ error: "mode must be 'managed' or 'unmanaged'" });
  }
});

// ─── Get Wallet ───
app.get("/wallet/:address", requireBase, async (req, res) => {
  const addr = req.params.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  try {
    const info = await baseClient!.getWallet(addr);
    res.json({ wallet: info });
  } catch (err: any) {
    res.status(404).json({ error: "Wallet not found or not an AgentWallet" });
  }
});

// ─── Predict Address ───
app.post("/wallet/predict", requireBase, async (req, res) => {
  const { owner, agent } = req.body;
  if (!owner || !agent) return res.status(400).json({ error: "owner and agent required" });

  try {
    const address = await baseClient!.predictAddress(owner, agent);
    res.json({ address });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Policy ───
app.post("/wallet/:address/policy", requireBase, async (req, res) => {
  const { ownerKey, dailyLimit, perTxLimit } = req.body;
  if (!ownerKey) return res.status(400).json({ error: "ownerKey required" });

  try {
    const txHash = await baseClient!.setPolicy(
      req.params.address, ownerKey, BigInt(dailyLimit || 0), BigInt(perTxLimit || 0)
    );
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Blacklist ───
app.post("/wallet/:address/blacklist", requireBase, async (req, res) => {
  const { ownerKey, address: addr, blocked } = req.body;
  if (!ownerKey || !addr) return res.status(400).json({ error: "ownerKey and address required" });

  try {
    const txHash = await baseClient!.setBlacklist(req.params.address, ownerKey, addr, blocked ?? true);
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/wallet/:address/blacklist/batch", requireBase, async (req, res) => {
  const { ownerKey, addresses, blocked } = req.body;
  if (!ownerKey || !addresses?.length) return res.status(400).json({ error: "ownerKey and addresses required" });

  try {
    const txHash = await baseClient!.setBlacklistBatch(req.params.address, ownerKey, addresses, blocked ?? true);
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/wallet/:address/blacklist/:target", requireBase, async (req, res) => {
  try {
    const blocked = await baseClient!.isBlacklisted(req.params.address, req.params.target);
    res.json({ address: req.params.target, blocked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Gas Top Up ───
app.post("/wallet/:address/topup", requireBase, async (req, res) => {
  try {
    const txHash = await baseClient!.topUpGas(req.params.address);
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stats ───
app.get("/stats", requireBase, async (_req, res) => {
  try {
    const total = await baseClient!.totalWallets();
    res.json({ totalWallets: total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// (managed/unmanaged routes merged into POST /wallet above)

// ─── Setup Page ───
app.get("/setup", (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, "../web/setup.html"), "utf-8");
    res.type("html").send(html);
  } catch {
    res.status(404).send("Setup page not found");
  }
});

// ─── Register Passkey (called from setup page) ───
app.post("/setup/register-passkey", requireBase, async (req, res) => {
  const { token, wallet: walletAddr, pubKeyX, pubKeyY, credentialId } = req.body;
  if (!token || !walletAddr || !pubKeyX || !pubKeyY) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const setup = setupTokens.get(token);
  if (!setup || setup.wallet.toLowerCase() !== walletAddr.toLowerCase()) {
    return res.status(403).json({ error: "Invalid or expired setup token" });
  }

  try {
    const txHash = await baseClient!.registerPasskey(walletAddr, pubKeyX, pubKeyY);
    if (credentialId) {
      walletCredentials.set(walletAddr.toLowerCase(), credentialId);
      saveCredentials(walletCredentials);
    }
    setupTokens.delete(token);
    res.json({ success: true, txHash, message: "Passkey registered on-chain" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Set Limits (called from setup page) ───
app.post("/setup/set-limits", requireBase, async (req, res) => {
  const { token, wallet: walletAddr, dailyLimit, perTxLimit } = req.body;
  if (!token || !walletAddr) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const setup = setupTokens.get(token);
  if (!setup || setup.wallet.toLowerCase() !== walletAddr.toLowerCase()) {
    return res.status(403).json({ error: "Invalid or expired setup token" });
  }

  try {
    // Admin (factory deployer) is temp owner before passkey registration,
    // so we can set policy via the admin key
    const txHash = await baseClient!.setPolicy(
      walletAddr,
      process.env.ADMIN_PRIVATE_KEY || "",
      BigInt(dailyLimit || 0),
      BigInt(perTxLimit || 0)
    );

    res.json({ success: true, txHash, message: "Limits configured" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Approval Page ───
app.get("/approve", (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, "../web/approve.html"), "utf-8");
    res.type("html").set("Cache-Control", "no-store").send(html);
  } catch {
    res.status(404).send("Approve page not found");
  }
});

// Approval challenges: challengeId → {action, wallet, params, challengeStr, createdAt}
const approvalChallenges = new Map<string, any>();

// ─── Approval Challenge (step 1: agent or page requests a challenge) ───
app.post("/approve/challenge", async (req, res) => {
  const { action, wallet: walletAddr, dailyLimit, perTxLimit, token, tokenDailyLimit, tokenPerTxLimit } = req.body;
  if (!action || !walletAddr) return res.status(400).json({ error: "action and wallet required" });

  const challengeId = crypto.randomBytes(32).toString("hex");
  const challengeStr = `agentwallet:${action}:${walletAddr}:${challengeId}:${Date.now()}`;

  approvalChallenges.set(challengeId, {
    action, wallet: walletAddr, dailyLimit, perTxLimit,
    token, tokenDailyLimit, tokenPerTxLimit,
    challengeStr, createdAt: Date.now()
  });
  // Expire after 5 minutes
  setTimeout(() => approvalChallenges.delete(challengeId), 300000);

  const credId = walletCredentials.get(walletAddr.toLowerCase());
  res.json({ challengeId, challengeStr, credentialId: credId || null });
});

// ─── Approval Execute (step 2: page sends passkey signature) ───
app.post("/approve/execute", requireBase, async (req, res) => {
  const { wallet: walletAddr, action, dailyLimit, perTxLimit, token, tokenDailyLimit, tokenPerTxLimit,
          challengeId, authenticatorData, clientDataJSON, signature } = req.body;

  if (!walletAddr || !action || !challengeId || !authenticatorData || !clientDataJSON || !signature) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const challenge = approvalChallenges.get(challengeId);
  if (!challenge || challenge.wallet.toLowerCase() !== walletAddr.toLowerCase()) {
    return res.status(403).json({ error: "Invalid or expired challenge" });
  }

  try {
    // Decode base64 fields
    const authDataBuf = Buffer.from(authenticatorData, "base64");
    const authDataBytes = new Uint8Array(authDataBuf);
    const clientJSONStr = Buffer.from(clientDataJSON, "base64").toString("utf-8");
    const sigBytes = Buffer.from(signature, "base64");

    console.log("[approve] authData:", "0x" + authDataBuf.toString("hex"));
    console.log("[approve] clientDataJSON:", clientJSONStr);
    console.log("[approve] sig:", "0x" + sigBytes.toString("hex"));

    // Parse DER signature to r, s (as bytes32 hex strings)
    const { r, s } = parseDERSignature(sigBytes);
    console.log("[approve] r:", r);
    console.log("[approve] s:", s);

    // Manually verify with precompile to debug
    const { createHash } = await import("crypto");
    const clientDataHash = createHash("sha256").update(clientJSONStr).digest();
    const msgHash = createHash("sha256").update(Buffer.concat([authDataBuf, clientDataHash])).digest();
    console.log("[approve] messageHash:", "0x" + msgHash.toString("hex"));

    // Get wallet contract — admin relays the passkey-signed tx
    // The contract verifies the P-256 signature on-chain
    const { Contract } = await import("ethers");
    const WALLET_ABI = JSON.parse(readFileSync(join(__dirname, "../base/abi/AgentWallet.json"), "utf-8"));
    const wallet = new Contract(walletAddr, WALLET_ABI, baseClient!.adminWallet);

    let txHash: string;

    if (action === "setPolicy") {
      const tx = await wallet.setPolicyWithPasskey(
        BigInt(dailyLimit || challenge.dailyLimit),
        BigInt(perTxLimit || challenge.perTxLimit),
        authDataBytes, clientJSONStr, r, s
      );
      txHash = (await tx.wait()).hash;
    } else if (action === "pause") {
      const tx = await wallet.pauseWithPasskey(authDataBytes, clientJSONStr, r, s);
      txHash = (await tx.wait()).hash;
    } else if (action === "unpause") {
      const tx = await wallet.unpauseWithPasskey(authDataBytes, clientJSONStr, r, s);
      txHash = (await tx.wait()).hash;
    } else if (action === "setTokenLimit") {
      const tAddr = token || challenge.token;
      const tDaily = tokenDailyLimit || challenge.tokenDailyLimit;
      const tPerTx = tokenPerTxLimit || challenge.tokenPerTxLimit;
      if (!tAddr || !tDaily || !tPerTx) return res.status(400).json({ error: "token, tokenDailyLimit, tokenPerTxLimit required" });
      const tx = await wallet.setTokenLimitWithPasskey(tAddr, BigInt(tDaily), BigInt(tPerTx), authDataBytes, clientJSONStr, r, s);
      txHash = (await tx.wait()).hash;
    } else if (action === "removeTokenLimit") {
      const tAddr = token || challenge.token;
      if (!tAddr) return res.status(400).json({ error: "token required" });
      const tx = await wallet.removeTokenLimitWithPasskey(tAddr, authDataBytes, clientJSONStr, r, s);
      txHash = (await tx.wait()).hash;
    } else {
      return res.status(400).json({ error: "Unknown action: " + action });
    }

    approvalChallenges.delete(challengeId);
    res.json({ success: true, txHash, message: action + " executed" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent: Request Limit Increase ───
// Agent calls this, gets back a URL to send to their human
app.post("/approve/request", (_req, res) => {
  const { wallet: walletAddr, action, dailyLimit, perTxLimit,
          token, tokenDailyLimit, tokenPerTxLimit, tokenDecimals,
          reason } = _req.body;
  if (!walletAddr) return res.status(400).json({ error: "wallet required" });

  const host = process.env.BASE_URL || "https://agntos.dev";
  const params = new URLSearchParams({ wallet: walletAddr });
  if (action) params.set("action", action);
  if (dailyLimit) params.set("daily", dailyLimit);
  if (perTxLimit) params.set("pertx", perTxLimit);
  if (token) params.set("token", token);
  if (tokenDailyLimit) params.set("tdl", tokenDailyLimit);
  if (tokenPerTxLimit) params.set("tpl", tokenPerTxLimit);
  if (tokenDecimals) params.set("dec", tokenDecimals);
  if (reason) params.set("reason", reason);

  const approvalUrl = `${host}/wallet/approve?${params.toString()}`;
  res.json({ approvalUrl, message: "Send this URL to your human to approve the change" });
});

// Parse DER-encoded ECDSA signature into r, s as bytes32
function parseDERSignature(sig: Buffer): { r: string; s: string } {
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let offset = 2; // skip 0x30 and total length
  if (sig[offset] !== 0x02) throw new Error("Invalid DER: expected 0x02 for r");
  offset++;
  const rLen = sig[offset++];
  let rBytes = sig.slice(offset, offset + rLen);
  offset += rLen;
  if (sig[offset] !== 0x02) throw new Error("Invalid DER: expected 0x02 for s");
  offset++;
  const sLen = sig[offset++];
  let sBytes = sig.slice(offset, offset + sLen);

  // Remove leading zeros (DER pads with 0x00 if high bit set)
  if (rBytes.length === 33 && rBytes[0] === 0) rBytes = rBytes.slice(1);
  if (sBytes.length === 33 && sBytes[0] === 0) sBytes = sBytes.slice(1);

  // Pad to 32 bytes
  const rPadded = Buffer.alloc(32); rBytes.copy(rPadded, 32 - rBytes.length);
  const sPadded = Buffer.alloc(32); sBytes.copy(sPadded, 32 - sBytes.length);

  return {
    r: "0x" + rPadded.toString("hex"),
    s: "0x" + sPadded.toString("hex")
  };
}

app.listen(PORT, () => {
  console.log(`AgentWallet API on port ${PORT}`);
});
