import express from "express";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { BaseWalletClient } from "../base/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Setup tokens: token → {walletAddress, agentAddress, createdAt}
const setupTokens = new Map<string, { wallet: string; agent: string; createdAt: number }>();

const PORT = parseInt(process.env.PORT || "3002");
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY || "";
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";

let baseClient: BaseWalletClient | null = null;

if (ADMIN_KEY && FACTORY_ADDRESS) {
  baseClient = new BaseWalletClient(BASE_RPC, ADMIN_KEY, FACTORY_ADDRESS);
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
  try {
    const info = await baseClient!.getWallet(req.params.address);
    res.json({ wallet: info });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
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

app.get("/test", (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, "../web/test.html"), "utf-8");
    res.type("html").set("Cache-Control", "no-store").send(html);
  } catch {
    res.status(404).send("Test page not found");
  }
});

app.get("/s2", (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, "../web/setup.html"), "utf-8");
    res.type("html").set("Cache-Control", "no-store").send(html);
  } catch {
    res.status(404).send("Setup page not found");
  }
});

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

app.listen(PORT, () => {
  console.log(`AgentWallet API on port ${PORT}`);
});
