import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
const { Program, AnchorProvider, Wallet: AnchorWallet, BN } = anchor;
import { readFileSync } from "fs";

const IDL = JSON.parse(readFileSync("/root/agentwallet-aos/solana/agent-wallet/target/idl/agent_wallet.json", "utf-8"));
const PROGRAM_ID = new PublicKey("4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e");

// Agent keypair (from keygen)
const AGENT_SECRET = "31STBTFgu8t8TmDKKWgvhpNQBvxUktnvV5o9aZcnjYGwSZ8VLQDYDBp9VRMvHVNHjNPPvXaCqemwatAsQA96XHwm";
const WALLET_PDA = "BxQaypdTMbC7dTP6iFmrMyFtwbgwvwQq2nZYrf8NisdM";

// Inline base58 decoder
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const val = ALPHABET.indexOf(char);
    for (let i = 0; i < bytes.length; i++) bytes[i] *= 58;
    bytes[0] += val;
    let carry = 0;
    for (let i = 0; i < bytes.length; i++) { bytes[i] += carry; carry = bytes[i] >> 8; bytes[i] &= 0xff; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const c of str) { if (c !== '1') break; bytes.push(0); }
  return new Uint8Array(bytes.reverse());
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const agentKeypair = Keypair.fromSecretKey(bs58decode(AGENT_SECRET));
  const walletPda = new PublicKey(WALLET_PDA);
  
  const wallet = new AnchorWallet(agentKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(IDL, provider);

  // Random recipient
  const recipient = Keypair.generate().publicKey;

  console.log("=== E2E Test: Solana Agent Wallet ===\n");
  console.log("Wallet PDA:", WALLET_PDA);
  console.log("Agent:", agentKeypair.publicKey.toBase58());
  console.log("Recipient:", recipient.toBase58());

  // Check balance
  const bal = await connection.getBalance(walletPda);
  console.log("\nWallet balance:", bal / LAMPORTS_PER_SOL, "SOL");

  // 1. Transfer SOL (within limits)
  console.log("\n--- Test 1: Transfer 0.001 SOL (0.1 USDC worth) ---");
  try {
    const tx = await program.methods
      .transferSol(new BN(100_000), new BN(0.001 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("✅ Success! TX:", tx);
  } catch (e: any) { console.log("❌ Failed:", e.message?.slice(0, 100)); }

  // 2. Check spent today
  const info = await (program.account as any)["wallet"].fetch(walletPda);
  console.log("\nSpent today:", info.spentToday.toNumber(), "($" + info.spentToday.toNumber() / 1e6 + ")");
  console.log("Daily limit:", info.dailyLimit.toNumber(), "($" + info.dailyLimit.toNumber() / 1e6 + ")");

  // 3. Transfer exceeding per-tx limit (should fail)
  console.log("\n--- Test 2: Transfer exceeding per-tx limit ($0.6 > $0.5 per-tx) ---");
  try {
    await program.methods
      .transferSol(new BN(600_000), new BN(0.001 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("❌ Should have failed!");
  } catch (e: any) {
    if (e.toString().includes("PerTxLimitExceeded")) console.log("✅ Correctly rejected: PerTxLimitExceeded");
    else console.log("❌ Wrong error:", e.message?.slice(0, 100));
  }

  // 4. Multiple transfers to hit daily limit
  console.log("\n--- Test 3: Multiple transfers to approach daily limit ---");
  for (let i = 0; i < 3; i++) {
    try {
      await program.methods
        .transferSol(new BN(300_000), new BN(0.0005 * LAMPORTS_PER_SOL))
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
        .signers([agentKeypair])
        .rpc();
      const w = await (program.account as any)["wallet"].fetch(walletPda);
      console.log(`  TX ${i+1}: ✅ spent=$${w.spentToday.toNumber()/1e6}`);
    } catch (e: any) {
      if (e.toString().includes("DailyLimitExceeded")) {
        console.log(`  TX ${i+1}: ✅ Correctly rejected: DailyLimitExceeded`);
      } else {
        console.log(`  TX ${i+1}: ❌`, e.message?.slice(0, 80));
      }
    }
  }

  // 5. Transfer from unauthorized signer (should fail)
  console.log("\n--- Test 4: Unauthorized signer ---");
  const rando = Keypair.generate();
  try {
    await program.methods
      .transferSol(new BN(1000), new BN(1000))
      .accounts({ wallet: walletPda, agent: rando.publicKey, recipient })
      .signers([rando])
      .rpc();
    console.log("❌ Should have failed!");
  } catch (e: any) {
    if (e.toString().includes("UnauthorizedAgent") || e.toString().includes("unknown signer") || e.toString().includes("Signature verification")) {
      console.log("✅ Correctly rejected: unauthorized");
    } else {
      console.log("Result:", e.message?.slice(0, 100));
    }
  }

  // 6. Set limits via API (increase daily to $5)
  console.log("\n--- Test 5: Set limits via API ---");
  const token = await fetch("http://localhost:3002/setup/refresh-token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: WALLET_PDA, chain: "solana" })
  }).then(r => r.json()).then(d => d.token);
  
  const setRes = await fetch("http://localhost:3002/setup/set-limits", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, wallet: WALLET_PDA, dailyLimit: "5000000", perTxLimit: "2000000" })
  }).then(r => r.json());
  console.log("Set limits:", setRes.success ? "✅" : "❌", setRes.message || setRes.error);

  // Verify new limits
  const w2 = await (program.account as any)["wallet"].fetch(walletPda);
  console.log("New daily limit: $" + w2.dailyLimit.toNumber() / 1e6);
  console.log("New per-tx limit: $" + w2.perTxLimit.toNumber() / 1e6);

  // 7. Now transfer should work again (higher limits)
  console.log("\n--- Test 6: Transfer with new higher limits ---");
  try {
    const tx = await program.methods
      .transferSol(new BN(1_000_000), new BN(0.002 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("✅ $1 transfer succeeded! TX:", tx.slice(0, 20) + "...");
  } catch (e: any) { console.log("❌ Failed:", e.message?.slice(0, 100)); }

  // 8. Register passkey + verify ownership transfer
  console.log("\n--- Test 7: Register passkey (simulated) ---");
  const token2 = await fetch("http://localhost:3002/setup/refresh-token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: WALLET_PDA, chain: "solana" })
  }).then(r => r.json()).then(d => d.token);

  const fakeX = "0x" + Array(32).fill(0).map(() => Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  const fakeY = "0x" + Array(32).fill(0).map(() => Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  
  const regRes = await fetch("http://localhost:3002/setup/register-passkey", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token2, wallet: WALLET_PDA, pubKeyX: fakeX, pubKeyY: fakeY, credentialId: "dGVzdA==" })
  }).then(r => r.json());
  console.log("Register passkey:", regRes.success ? "✅" : "❌", regRes.message || regRes.error);

  // Verify owner is now dead address
  const w3 = await (program.account as any)["wallet"].fetch(walletPda);
  console.log("Owner after passkey:", w3.owner.toBase58());
  console.log("Passkey registered:", w3.passkeyRegistered);
  const isDead = w3.owner.toBase58() === "11111111111111111111111111111112";
  console.log(isDead ? "✅ Owner is dead address — passkey is sole authority" : "❌ Owner NOT transferred!");

  // 9. Agent can still transfer (passkey doesn't affect agent)
  console.log("\n--- Test 8: Agent still works after passkey ---");
  try {
    const tx = await program.methods
      .transferSol(new BN(100_000), new BN(0.0005 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("✅ Agent can still transfer! TX:", tx.slice(0, 20) + "...");
  } catch (e: any) { console.log("❌ Failed:", e.message?.slice(0, 100)); }

  // Final status
  console.log("\n=== Final Wallet Status ===");
  const final = await fetch("http://localhost:3002/wallet/" + WALLET_PDA).then(r => r.json());
  console.log(JSON.stringify(final.wallet, null, 2));

  // Base wallet status
  console.log("\n=== Base Wallet Status ===");
  const baseFinal = await fetch("http://localhost:3002/wallet/0x303ce0ba7Bd759B0E4c203854d58E4814730F22a").then(r => r.json());
  console.log(JSON.stringify(baseFinal.wallet, null, 2));

  console.log("\n🏁 All tests complete!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
