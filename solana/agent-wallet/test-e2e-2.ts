import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
const { Program, AnchorProvider, Wallet: AnchorWallet, BN } = anchor;
import { readFileSync } from "fs";

const IDL = JSON.parse(readFileSync("/root/agentwallet-aos/solana/agent-wallet/target/idl/agent_wallet.json", "utf-8"));
const PROGRAM_ID = new PublicKey("4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e");

const AGENT_SECRET = "4HJfbrswJsJC1M6i8x8GA2DKk6z8nHMn35DUuCMfzkPYDG9wuzXV287bvFAMbvabo7vdGPQnCGqdECXNphrM6157";
const WALLET_PDA = "6Bsogq1EW94Brrj9rFmhPf6nMtoxgshSaz9QyEoSbWpf";

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
  const wallet2 = new AnchorWallet(agentKeypair);
  const provider = new AnchorProvider(connection, wallet2, { commitment: "confirmed" });
  const program = new Program(IDL, provider);
  const recipient = Keypair.generate().publicKey;

  console.log("=== FULL E2E TEST ===\n");
  console.log("Agent:", agentKeypair.publicKey.toBase58());
  console.log("Wallet:", WALLET_PDA);
  
  const agentBal = await connection.getBalance(agentKeypair.publicKey);
  const walletBal = await connection.getBalance(walletPda);
  console.log("Agent balance:", agentBal / LAMPORTS_PER_SOL, "SOL");
  console.log("Wallet balance:", walletBal / LAMPORTS_PER_SOL, "SOL");

  // Test 1: Transfer SOL within limits
  console.log("\n--- 1. Transfer 0.001 SOL ($0.1 USDC) ---");
  try {
    const tx = await program.methods
      .transferSol(new BN(100_000), new BN(0.001 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("✅ TX:", tx.slice(0, 30) + "...");
  } catch (e: any) { console.log("❌", e.message?.slice(0, 120)); }

  // Test 2: Check spending
  let w = await (program.account as any)["wallet"].fetch(walletPda);
  console.log("   Spent: $" + w.spentToday.toNumber()/1e6 + " / $" + w.dailyLimit.toNumber()/1e6);

  // Test 3: Per-tx limit exceeded
  console.log("\n--- 2. Per-tx limit exceeded ($0.6 > $0.5) ---");
  try {
    await program.methods
      .transferSol(new BN(600_000), new BN(0.001 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("❌ Should have failed!");
  } catch (e: any) {
    console.log(e.toString().includes("PerTxLimitExceeded") ? "✅ PerTxLimitExceeded" : "❌ " + e.message?.slice(0,80));
  }

  // Test 4: Multiple transfers to hit daily
  console.log("\n--- 3. Drain daily limit ($1) ---");
  for (let i = 0; i < 4; i++) {
    try {
      await program.methods
        .transferSol(new BN(300_000), new BN(0.0003 * LAMPORTS_PER_SOL))
        .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
        .signers([agentKeypair])
        .rpc();
      w = await (program.account as any)["wallet"].fetch(walletPda);
      console.log(`   TX ${i+1}: ✅ spent=$${w.spentToday.toNumber()/1e6}`);
    } catch (e: any) {
      console.log(`   TX ${i+1}: ${e.toString().includes("DailyLimitExceeded") ? "✅ DailyLimitExceeded" : "❌ "+e.message?.slice(0,80)}`);
    }
  }

  // Test 5: Unauthorized signer
  console.log("\n--- 4. Unauthorized signer ---");
  try {
    const rando = Keypair.generate();
    await program.methods
      .transferSol(new BN(1000), new BN(1000))
      .accounts({ wallet: walletPda, agent: rando.publicKey, recipient })
      .signers([rando])
      .rpc();
    console.log("❌ Should have failed!");
  } catch (e: any) {
    console.log("✅ Rejected (expected)");
  }

  // Test 6: Increase limits via API
  console.log("\n--- 5. Increase limits to $5/day $2/tx ---");
  const token = await fetch("http://localhost:3002/setup/refresh-token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: WALLET_PDA, chain: "solana" })
  }).then(r => r.json()).then(d => d.token);
  const lr = await fetch("http://localhost:3002/setup/set-limits", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, wallet: WALLET_PDA, dailyLimit: "5000000", perTxLimit: "2000000" })
  }).then(r => r.json());
  console.log(lr.success ? "✅ Limits updated" : "❌ " + lr.error);

  // Test 7: Now bigger transfer works
  console.log("\n--- 6. $1.5 transfer (was blocked, now allowed) ---");
  try {
    const tx = await program.methods
      .transferSol(new BN(1_500_000), new BN(0.003 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("✅ TX:", tx.slice(0, 30) + "...");
  } catch (e: any) { console.log("❌", e.message?.slice(0, 120)); }

  // Test 8: Register passkey
  console.log("\n--- 7. Register passkey ---");
  const token2 = await fetch("http://localhost:3002/setup/refresh-token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: WALLET_PDA, chain: "solana" })
  }).then(r => r.json()).then(d => d.token);
  const fakeX = "0x" + Array(32).fill(0).map(()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  const fakeY = "0x" + Array(32).fill(0).map(()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  const rr = await fetch("http://localhost:3002/setup/register-passkey", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token2, wallet: WALLET_PDA, pubKeyX: fakeX, pubKeyY: fakeY, credentialId: "dGVzdA==" })
  }).then(r => r.json());
  console.log(rr.success ? "✅ Passkey registered + ownership transferred" : "❌ " + rr.error);

  w = await (program.account as any)["wallet"].fetch(walletPda);
  console.log("   Owner:", w.owner.toBase58());
  console.log("   Dead?", w.owner.toBase58() === "11111111111111111111111111111112" ? "✅" : "❌");

  // Test 9: Agent still works after passkey
  console.log("\n--- 8. Agent transfer after passkey ---");
  try {
    const tx = await program.methods
      .transferSol(new BN(100_000), new BN(0.0002 * LAMPORTS_PER_SOL))
      .accounts({ wallet: walletPda, agent: agentKeypair.publicKey, recipient })
      .signers([agentKeypair])
      .rpc();
    console.log("✅ Agent still works! TX:", tx.slice(0, 30) + "...");
  } catch (e: any) { console.log("❌", e.message?.slice(0, 120)); }

  // Final
  console.log("\n=== FINAL STATUS ===");
  const final = await fetch("http://localhost:3002/wallet/" + WALLET_PDA).then(r => r.json());
  const fw = final.wallet;
  console.log(`Wallet: ${fw.address}`);
  console.log(`Owner: ${fw.owner}`);
  console.log(`Passkey: ${fw.passkeyRegistered}`);
  console.log(`Spent: $${Number(fw.spentToday)/1e6} / $${Number(fw.policy.dailyLimit)/1e6}`);
  console.log(`SOL: ${Number(fw.solBalance)/LAMPORTS_PER_SOL}`);

  console.log("\n🏁 ALL DONE!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
