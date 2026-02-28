import express from "express";
import { BaseWalletClient } from "../base/client.js";

const app = express();
app.use(express.json());

// ─── Config ───
const PORT = parseInt(process.env.PORT || "3002");
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY || "";
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";

let baseClient: BaseWalletClient | null = null;

if (ADMIN_KEY && FACTORY_ADDRESS) {
  baseClient = new BaseWalletClient(BASE_RPC, ADMIN_KEY, FACTORY_ADDRESS);
  console.log("✅ Base wallet client initialized");
} else {
  console.warn("⚠️ Missing ADMIN_PRIVATE_KEY or FACTORY_ADDRESS — Base wallet endpoints disabled");
}

// ─── Health ───
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    chains: {
      base: !!baseClient,
      solana: false, // TODO
    },
  });
});

// ─── Create Wallet ───
app.post("/wallet", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  const { owner, agent } = req.body;
  if (!owner || !agent) return res.status(400).json({ error: "owner and agent addresses required" });

  try {
    const address = await baseClient.createWallet(owner, agent);
    const info = await baseClient.getWallet(address);
    res.json({
      success: true,
      wallet: info,
      message: "Wallet created with default policies and gas seeded",
    });
  } catch (err: any) {
    console.error("[wallet] Create error:", err.message);
    res.status(500).json({ error: "Failed to create wallet", message: err.message });
  }
});

// ─── Get Wallet ───
app.get("/wallet/:address", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  try {
    const info = await baseClient.getWallet(req.params.address);
    res.json({ wallet: info });
  } catch (err: any) {
    res.status(404).json({ error: "Wallet not found", message: err.message });
  }
});

// ─── Predict Address ───
app.post("/wallet/predict", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  const { owner, agent } = req.body;
  if (!owner || !agent) return res.status(400).json({ error: "owner and agent addresses required" });

  try {
    const address = await baseClient.predictAddress(owner, agent);
    res.json({ address });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Policy ───
app.post("/wallet/:address/policy", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  const { ownerKey, dailyLimit, perTxLimit, approvalThreshold } = req.body;
  if (!ownerKey) return res.status(400).json({ error: "ownerKey required" });

  try {
    const txHash = await baseClient.setPolicy(
      req.params.address,
      ownerKey,
      BigInt(dailyLimit || 0),
      BigInt(perTxLimit || 0),
      BigInt(approvalThreshold || 0),
    );
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Approve Pending Tx ───
app.post("/wallet/:address/approve/:txId", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  const { ownerKey } = req.body;
  if (!ownerKey) return res.status(400).json({ error: "ownerKey required" });

  try {
    const txHash = await baseClient.approveTx(
      req.params.address,
      ownerKey,
      parseInt(req.params.txId),
    );
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cancel Pending Tx ───
app.post("/wallet/:address/cancel/:txId", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  const { ownerKey } = req.body;
  if (!ownerKey) return res.status(400).json({ error: "ownerKey required" });

  try {
    const txHash = await baseClient.cancelTx(
      req.params.address,
      ownerKey,
      parseInt(req.params.txId),
    );
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get Pending Tx ───
app.get("/wallet/:address/pending/:txId", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  try {
    const ptx = await baseClient.getPendingTx(
      req.params.address,
      parseInt(req.params.txId),
    );
    res.json({ pendingTx: ptx });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ─── Top Up Gas ───
app.post("/wallet/:address/topup", async (req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  try {
    const txHash = await baseClient.topUpGas(req.params.address);
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stats ───
app.get("/stats", async (_req, res) => {
  if (!baseClient) return res.status(503).json({ error: "Base client not configured" });

  try {
    const total = await baseClient.totalWallets();
    res.json({ totalWallets: total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───
app.listen(PORT, () => {
  console.log(`🔐 AgentWallet API running on port ${PORT}`);
});
