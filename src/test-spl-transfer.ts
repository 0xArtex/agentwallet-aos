/**
 * E2E test: SPL Token Transfer via AgentWallet Solana program
 * 
 * Steps:
 * 1. Create a test SPL token mint
 * 2. Create a wallet PDA
 * 3. Create token accounts for wallet PDA and recipient
 * 4. Mint tokens to wallet PDA's token account
 * 5. Set token limits via admin
 * 6. Transfer tokens from wallet to recipient (agent signs)
 * 7. Verify balances
 * 8. Test per-tx limit enforcement
 * 9. Test daily limit enforcement
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SolanaWalletClient } from "./solana/client";
import * as fs from "fs";

const PROGRAM_ID = "4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e";
const RPC = "https://api.devnet.solana.com";

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const conn = new Connection(RPC, "confirmed");

  // Load admin keypair
  const adminSecret = JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecret));
  console.log("Admin:", admin.publicKey.toBase58());

  // Generate agent keypair
  const agent = Keypair.generate();
  console.log("Agent:", agent.publicKey.toBase58());

  // Fund agent from admin
  console.log("\n--- Funding agent from admin ---");
  const fundAgentTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: agent.publicKey, lamports: 0.1e9 })
  );
  await sendAndConfirmTransaction(conn, fundAgentTx, [admin]);
  console.log("Funded agent with 0.1 SOL");

  // Create client
  const client = new SolanaWalletClient(RPC, "/root/.config/solana/id.json", PROGRAM_ID);

  // Step 1: Create wallet
  console.log("\n--- Creating wallet ---");
  const walletAddress = await client.createWallet(admin.publicKey.toBase58(), agent.publicKey.toBase58(), 1000000, 500000); // $1 daily, $0.50 per-tx
  console.log("Wallet PDA:", walletAddress);

  // Step 2: Create test SPL token mint
  console.log("\n--- Creating test SPL token mint ---");
  const mint = await createMint(conn, admin, admin.publicKey, null, 6); // 6 decimals like USDC
  console.log("Mint:", mint.toBase58());

  const walletPubkey = new PublicKey(walletAddress);

  // Step 3: Create token accounts
  console.log("\n--- Creating token accounts ---");
  const walletATA = await getOrCreateAssociatedTokenAccount(conn, admin, mint, walletPubkey, true); // allowOwnerOffCurve for PDA
  console.log("Wallet ATA:", walletATA.address.toBase58());

  const recipient = Keypair.generate();
  // Fund recipient for rent
  const fundTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: recipient.publicKey, lamports: 0.01e9 })
  );
  await sendAndConfirmTransaction(conn, fundTx, [admin]);

  const recipientATA = await getOrCreateAssociatedTokenAccount(conn, admin, mint, recipient.publicKey);
  console.log("Recipient ATA:", recipientATA.address.toBase58());

  // Step 4: Mint tokens to wallet ATA
  console.log("\n--- Minting 1000 tokens to wallet ---");
  await mintTo(conn, admin, mint, walletATA.address, admin, 1000_000_000); // 1000 tokens (6 decimals)
  const walletBalance = await getAccount(conn, walletATA.address);
  console.log("Wallet token balance:", Number(walletBalance.amount) / 1e6);

  // Step 5: Set token limit
  console.log("\n--- Setting token limit (daily: 500, per-tx: 200) ---");
  await client.setTokenLimit(walletAddress, mint.toBase58(), 500_000_000, 200_000_000); // 500 daily, 200 per-tx
  console.log("Token limit set");

  await sleep(1000);

  // Step 6: Transfer 100 tokens (should succeed)
  console.log("\n--- Test 1: Transfer 100 tokens (should succeed) ---");
  try {
    const txSig = await client.transferToken(
      walletAddress,
      agent,
      mint.toBase58(),
      walletATA.address.toBase58(),
      recipientATA.address.toBase58(),
      100_000_000, // 100 tokens
      100000,      // $0.10 USD equivalent
    );
    console.log("✅ Transfer succeeded:", txSig);

    const recipBalance = await getAccount(conn, recipientATA.address);
    console.log("Recipient balance:", Number(recipBalance.amount) / 1e6, "tokens");

    const walletBal2 = await getAccount(conn, walletATA.address);
    console.log("Wallet balance:", Number(walletBal2.amount) / 1e6, "tokens");
  } catch (e: any) {
    console.error("❌ Transfer failed:", e.message);
  }

  await sleep(1000);

  // Step 7: Transfer 250 tokens (should fail — per-tx limit is 200)
  console.log("\n--- Test 2: Transfer 250 tokens (should fail — per-tx limit 200) ---");
  try {
    await client.transferToken(
      walletAddress,
      agent,
      mint.toBase58(),
      walletATA.address.toBase58(),
      recipientATA.address.toBase58(),
      250_000_000,
      250000,
    );
    console.error("❌ Should have failed but succeeded!");
  } catch (e: any) {
    if (e.message.includes("TokenPerTxLimitExceeded") || e.message.includes("0x177a")) {
      console.log("✅ Correctly rejected: per-tx limit exceeded");
    } else {
      console.error("❌ Wrong error:", e.message);
    }
  }

  await sleep(1000);

  // Step 8: Transfer 200 tokens twice (second should approach daily limit)
  console.log("\n--- Test 3: Transfer 200 tokens (should succeed — within limits) ---");
  try {
    const txSig = await client.transferToken(
      walletAddress,
      agent,
      mint.toBase58(),
      walletATA.address.toBase58(),
      recipientATA.address.toBase58(),
      200_000_000,
      200000,
    );
    console.log("✅ Transfer succeeded:", txSig);
  } catch (e: any) {
    console.error("❌ Transfer failed:", e.message);
  }

  await sleep(1000);

  // Step 9: Transfer 200 more (should fail — daily limit is 500, already spent 300)
  console.log("\n--- Test 4: Transfer 200 more tokens (should succeed — 300+200=500 = limit) ---");
  try {
    const txSig = await client.transferToken(
      walletAddress,
      agent,
      mint.toBase58(),
      walletATA.address.toBase58(),
      recipientATA.address.toBase58(),
      200_000_000,
      200000,
    );
    console.log("✅ Transfer succeeded (exactly at daily limit):", txSig);
  } catch (e: any) {
    console.error("❌ Transfer failed:", e.message);
  }

  await sleep(1000);

  // Step 10: Transfer 1 more token (should fail — daily limit exhausted)
  console.log("\n--- Test 5: Transfer 1 more token (should fail — daily limit exhausted) ---");
  try {
    await client.transferToken(
      walletAddress,
      agent,
      mint.toBase58(),
      walletATA.address.toBase58(),
      recipientATA.address.toBase58(),
      1_000_000,
      1000,
    );
    console.error("❌ Should have failed but succeeded!");
  } catch (e: any) {
    if (e.message.includes("TokenDailyLimitExceeded") || e.message.includes("0x177b") || e.message.includes("DailyLimit")) {
      console.log("✅ Correctly rejected: daily token limit exceeded");
    } else {
      console.error("❌ Wrong error:", e.message);
    }
  }

  // Final balances
  console.log("\n--- Final Balances ---");
  const finalWallet = await getAccount(conn, walletATA.address);
  const finalRecip = await getAccount(conn, recipientATA.address);
  console.log("Wallet:", Number(finalWallet.amount) / 1e6, "tokens");
  console.log("Recipient:", Number(finalRecip.amount) / 1e6, "tokens");
  console.log("Total transferred:", Number(finalRecip.amount) / 1e6, "tokens (expected: 500)");

  console.log("\n🏁 All SPL token transfer tests complete!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
