import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
const { Program, AnchorProvider, Wallet: AnchorWallet, BN } = anchor;
import { createMint, createAccount, mintTo, getAccount, TOKEN_PROGRAM_ID, createTransferInstruction } from "@solana/spl-token";
import { readFileSync } from "fs";

const IDL = JSON.parse(readFileSync("/root/agentwallet-aos/solana/agent-wallet/target/idl/agent_wallet.json", "utf-8"));
const PROGRAM_ID = new PublicKey("4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e");

// Admin (deploy wallet)
const adminBytes = JSON.parse(readFileSync("/root/.config/solana/id.json", "utf-8"));
const adminKeypair = Keypair.fromSecretKey(new Uint8Array(adminBytes));

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Create fresh agent keypair
  const agentKeypair = Keypair.generate();
  const recipient = Keypair.generate();
  
  console.log("=== EXECUTE INSTRUCTION E2E TEST ===\n");
  console.log("Admin:", adminKeypair.publicKey.toBase58());
  console.log("Agent:", agentKeypair.publicKey.toBase58());
  console.log("Recipient:", recipient.publicKey.toBase58());

  // Setup: fund agent for tx fees
  const adminProvider = new AnchorProvider(connection, new AnchorWallet(adminKeypair), { commitment: "confirmed" });
  const fundTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: adminKeypair.publicKey, toPubkey: agentKeypair.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: adminKeypair.publicKey, toPubkey: recipient.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
  );
  await adminProvider.sendAndConfirm(fundTx);
  console.log("✅ Funded agent + recipient\n");

  // Create wallet via API
  console.log("--- Creating wallet via API ---");
  const createRes = await fetch("http://localhost:3002/wallet", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: agentKeypair.publicKey.toBase58(), chain: "solana", mode: "managed" })
  }).then(r => r.json());
  
  const walletAddress = createRes.wallet.address;
  console.log("Wallet:", walletAddress);
  console.log("Setup URL:", createRes.setupUrl);

  // Increase limits for testing ($10/day, $5/tx)
  const token = createRes.setupToken;
  await fetch("http://localhost:3002/setup/set-limits", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, wallet: walletAddress, dailyLimit: "10000000", perTxLimit: "5000000" })
  }).then(r => r.json());
  console.log("✅ Limits set: $10/day, $5/tx\n");

  const walletPda = new PublicKey(walletAddress);

  // Fund wallet PDA with SOL
  const fundWalletTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: adminKeypair.publicKey, toPubkey: walletPda, lamports: 0.1 * LAMPORTS_PER_SOL })
  );
  await adminProvider.sendAndConfirm(fundWalletTx);
  console.log("✅ Funded wallet with 0.1 SOL\n");

  // Agent's program connection
  const agentProvider = new AnchorProvider(connection, new AnchorWallet(agentKeypair), { commitment: "confirmed" });
  const program = new Program(IDL, agentProvider);

  // ─── Test 1: Execute a system program SOL transfer via CPI ───
  console.log("--- Test 1: Execute → System Program Transfer (0.01 SOL) ---");
  {
    const transferIx = SystemProgram.transfer({
      fromPubkey: walletPda,
      toPubkey: recipient.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    });

    const recipBalBefore = await connection.getBalance(recipient.publicKey);

    try {
      const tx = await program.methods
        .execute(SystemProgram.programId, Buffer.from(transferIx.data), new BN(500_000)) // $0.50
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey })
        .remainingAccounts([
          { pubkey: walletPda, isWritable: true, isSigner: false }, // from (wallet PDA signs via CPI)
          { pubkey: recipient.publicKey, isWritable: true, isSigner: false }, // to
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }, // system program
        ])
        .signers([agentKeypair])
        .rpc();
      
      const recipBalAfter = await connection.getBalance(recipient.publicKey);
      const diff = (recipBalAfter - recipBalBefore) / LAMPORTS_PER_SOL;
      console.log(`✅ Transferred ${diff} SOL to recipient`);
      console.log("   TX:", tx.slice(0, 40) + "...");
    } catch (e: any) {
      console.log("❌", e.message?.slice(0, 150));
      // Log full error for debugging
      if (e.logs) console.log("   Logs:", e.logs.slice(-3).join("\n         "));
    }
  }

  // Check spending
  let w = await (program.account as any)["wallet"].fetch(walletPda);
  console.log("   Spent: $" + w.spentToday.toNumber()/1e6 + " / $" + w.dailyLimit.toNumber()/1e6);

  // ─── Test 2: Execute with amount_usdc = 0 (free interaction) ───
  console.log("\n--- Test 2: Execute with $0 (free CPI — no spending tracked) ---");
  {
    // Just do a SOL transfer but report $0 (e.g. claiming rewards)
    const transferIx = SystemProgram.transfer({
      fromPubkey: walletPda,
      toPubkey: recipient.publicKey,
      lamports: 1000, // tiny amount
    });

    try {
      await program.methods
        .execute(SystemProgram.programId, Buffer.from(transferIx.data), new BN(0))
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey })
        .remainingAccounts([
          { pubkey: walletPda, isWritable: true, isSigner: false },
          { pubkey: recipient.publicKey, isWritable: true, isSigner: false },
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        ])
        .signers([agentKeypair])
        .rpc();
      
      w = await (program.account as any)["wallet"].fetch(walletPda);
      console.log("✅ Executed (no spending tracked). Spent still: $" + w.spentToday.toNumber()/1e6);
    } catch (e: any) {
      console.log("❌", e.message?.slice(0, 150));
    }
  }

  // ─── Test 3: Execute exceeding per-tx limit ───
  console.log("\n--- Test 3: Execute exceeding per-tx limit ($6 > $5) ---");
  {
    const transferIx = SystemProgram.transfer({
      fromPubkey: walletPda,
      toPubkey: recipient.publicKey,
      lamports: 1000,
    });

    try {
      await program.methods
        .execute(SystemProgram.programId, Buffer.from(transferIx.data), new BN(6_000_000)) // $6 > $5 limit
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey })
        .remainingAccounts([
          { pubkey: walletPda, isWritable: true, isSigner: false },
          { pubkey: recipient.publicKey, isWritable: true, isSigner: false },
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        ])
        .signers([agentKeypair])
        .rpc();
      console.log("❌ Should have failed!");
    } catch (e: any) {
      console.log(e.toString().includes("PerTxLimitExceeded") ? "✅ PerTxLimitExceeded" : "❌ " + e.message?.slice(0, 100));
    }
  }

  // ─── Test 4: SPL Token transfer via execute ───
  console.log("\n--- Test 4: Execute → SPL Token Transfer ---");
  {
    // Create a test token
    const mint = await createMint(connection, adminKeypair, adminKeypair.publicKey, null, 6);
    console.log("   Mint:", mint.toBase58());

    // Create token accounts
    const walletTokenAccount = await createAccount(connection, adminKeypair, mint, walletPda, Keypair.generate());
    const recipientTokenAccount = await createAccount(connection, adminKeypair, mint, recipient.publicKey, Keypair.generate());

    // Mint tokens to wallet
    await mintTo(connection, adminKeypair, mint, walletTokenAccount, adminKeypair, 1_000_000_000); // 1000 tokens
    console.log("   Minted 1000 tokens to wallet");

    // Build SPL transfer instruction (wallet PDA is the authority)
    const tokenTransferIx = createTransferInstruction(
      walletTokenAccount,     // source
      recipientTokenAccount,  // destination
      walletPda,              // authority (wallet PDA)
      50_000_000,             // 50 tokens
    );

    try {
      const tx = await program.methods
        .execute(TOKEN_PROGRAM_ID, Buffer.from(tokenTransferIx.data), new BN(1_000_000)) // $1
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey })
        .remainingAccounts([
          { pubkey: walletTokenAccount, isWritable: true, isSigner: false },
          { pubkey: recipientTokenAccount, isWritable: true, isSigner: false },
          { pubkey: walletPda, isWritable: false, isSigner: false }, // authority
          { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
        ])
        .signers([agentKeypair])
        .rpc();

      const recipTokenBal = await getAccount(connection, recipientTokenAccount);
      console.log("✅ Transferred", Number(recipTokenBal.amount) / 1e6, "tokens to recipient");
      console.log("   TX:", tx.slice(0, 40) + "...");
    } catch (e: any) {
      console.log("❌", e.message?.slice(0, 150));
      if (e.logs) console.log("   Logs:", e.logs.slice(-5).join("\n         "));
    }
  }

  // ─── Test 5: Execute when paused (should fail) ───
  console.log("\n--- Test 5: Execute when paused ---");
  {
    // Pause via admin (still owner)
    const adminProgram = new Program(IDL, adminProvider);
    await adminProgram.methods
      .pause()
      .accounts({ wallet: walletPda, owner: adminKeypair.publicKey })
      .signers([adminKeypair])
      .rpc();
    console.log("   Paused wallet");

    const transferIx = SystemProgram.transfer({
      fromPubkey: walletPda, toPubkey: recipient.publicKey, lamports: 1000,
    });

    try {
      await program.methods
        .execute(SystemProgram.programId, Buffer.from(transferIx.data), new BN(0))
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey })
        .remainingAccounts([
          { pubkey: walletPda, isWritable: true, isSigner: false },
          { pubkey: recipient.publicKey, isWritable: true, isSigner: false },
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        ])
        .signers([agentKeypair])
        .rpc();
      console.log("❌ Should have failed!");
    } catch (e: any) {
      console.log(e.toString().includes("Paused") ? "✅ Correctly rejected: Paused" : "❌ " + e.message?.slice(0, 100));
    }

    // Unpause
    await adminProgram.methods
      .unpause()
      .accounts({ wallet: walletPda, owner: adminKeypair.publicKey })
      .signers([adminKeypair])
      .rpc();
    console.log("   Unpaused wallet");
  }

  // ─── Final status ───
  console.log("\n=== FINAL STATUS ===");
  const final_ = await fetch("http://localhost:3002/wallet/" + walletAddress).then(r => r.json());
  const fw = final_.wallet;
  console.log(`Wallet: ${fw.address}`);
  console.log(`Spent: $${Number(fw.spentToday)/1e6} / $${Number(fw.policy.dailyLimit)/1e6}`);
  console.log(`SOL: ${Number(fw.solBalance)/LAMPORTS_PER_SOL}`);
  console.log(`Paused: ${fw.policy.paused}`);

  console.log("\n🏁 EXECUTE E2E COMPLETE!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
