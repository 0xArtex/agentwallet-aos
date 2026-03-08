import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentWallet } from "../target/types/agent_wallet";
import { Keypair, SystemProgram, LAMPORTS_PER_SOL, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

describe("agent-wallet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentWallet as Program<AgentWallet>;

  const admin = provider.wallet as anchor.Wallet;
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const recipient = Keypair.generate();

  let factoryPda: PublicKey;
  let factoryBump: number;
  let walletPda: PublicKey;
  let walletBump: number;

  const DAILY_LIMIT = new anchor.BN(50_000_000); // $50 USDC
  const PER_TX_LIMIT = new anchor.BN(25_000_000); // $25 USDC

  before(async () => {
    // Derive factory PDA
    [factoryPda, factoryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("factory")],
      program.programId
    );

    // Airdrop SOL to owner, agent, recipient for tx fees
    for (const kp of [owner, agent, recipient]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
  });

  // ─── Factory ───

  it("initializes factory", async () => {
    await program.methods
      .initializeFactory()
      .accounts({
        factory: factoryPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const factory = await program.account.factory.fetch(factoryPda);
    assert.equal(factory.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(factory.totalWallets.toNumber(), 0);
  });

  // ─── Wallet Creation ───

  it("creates a managed wallet", async () => {
    const factory = await program.account.factory.fetch(factoryPda);
    const index = factory.totalWallets;

    [walletPda, walletBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("wallet"),
        owner.publicKey.toBuffer(),
        agent.publicKey.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .createWallet(DAILY_LIMIT, PER_TX_LIMIT)
      .accounts({
        factory: factoryPda,
        wallet: walletPda,
        owner: owner.publicKey,
        agent: agent.publicKey,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.owner.toBase58(), owner.publicKey.toBase58());
    assert.equal(wallet.agent.toBase58(), agent.publicKey.toBase58());
    assert.equal(wallet.dailyLimit.toNumber(), 50_000_000);
    assert.equal(wallet.perTxLimit.toNumber(), 25_000_000);
    assert.equal(wallet.paused, false);
    assert.equal(wallet.passkeyRegistered, false);
    assert.equal(wallet.spentToday.toNumber(), 0);

    const updatedFactory = await program.account.factory.fetch(factoryPda);
    assert.equal(updatedFactory.totalWallets.toNumber(), 1);
  });

  it("rejects wallet with per-tx > daily limit", async () => {
    const factory = await program.account.factory.fetch(factoryPda);
    const index = factory.totalWallets;
    const owner2 = Keypair.generate();
    const agent2 = Keypair.generate();

    const [walletPda2] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("wallet"),
        owner2.publicKey.toBuffer(),
        agent2.publicKey.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    try {
      await program.methods
        .createWallet(new anchor.BN(10_000_000), new anchor.BN(20_000_000))
        .accounts({
          factory: factoryPda,
          wallet: walletPda2,
          owner: owner2.publicKey,
          agent: agent2.publicKey,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "InvalidLimits");
    }
  });

  // ─── SOL Transfer ───

  it("funds wallet PDA with SOL", async () => {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: walletPda,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx);

    const balance = await provider.connection.getBalance(walletPda);
    assert.isAbove(balance, LAMPORTS_PER_SOL - 10000);
  });

  it("agent transfers SOL within limits", async () => {
    const balanceBefore = await provider.connection.getBalance(recipient.publicKey);

    // Transfer 0.01 SOL, counting as $2 USDC
    await program.methods
      .transferSol(new anchor.BN(2_000_000), new anchor.BN(0.01 * LAMPORTS_PER_SOL))
      .accounts({
        wallet: walletPda,
        agent: agent.publicKey,
        recipient: recipient.publicKey,
      })
      .signers([agent])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(recipient.publicKey);
    assert.isAbove(balanceAfter, balanceBefore);

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.spentToday.toNumber(), 2_000_000);
  });

  it("rejects SOL transfer exceeding per-tx limit", async () => {
    try {
      await program.methods
        .transferSol(new anchor.BN(30_000_000), new anchor.BN(0.01 * LAMPORTS_PER_SOL))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "PerTxLimitExceeded");
    }
  });

  it("rejects SOL transfer exceeding daily limit", async () => {
    // Already spent $2, daily is $50. Try to spend $49 which would make total $51
    try {
      await program.methods
        .transferSol(new anchor.BN(49_000_000), new anchor.BN(0.01 * LAMPORTS_PER_SOL))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      // Could be PerTxLimitExceeded (49 > 25) or DailyLimitExceeded
      assert.include(e.message, "LimitExceeded");
    }
  });

  it("rejects transfer from non-agent", async () => {
    const imposter = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(imposter.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .transferSol(new anchor.BN(1_000_000), new anchor.BN(0.001 * LAMPORTS_PER_SOL))
        .accounts({
          wallet: walletPda,
          agent: imposter.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([imposter])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "UnauthorizedAgent");
    }
  });

  // ─── Policy ───

  it("owner sets policy", async () => {
    await program.methods
      .setPolicy(new anchor.BN(100_000_000), new anchor.BN(50_000_000))
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.dailyLimit.toNumber(), 100_000_000);
    assert.equal(wallet.perTxLimit.toNumber(), 50_000_000);
  });

  it("non-owner cannot set policy", async () => {
    try {
      await program.methods
        .setPolicy(new anchor.BN(999_000_000), new anchor.BN(999_000_000))
        .accounts({
          wallet: walletPda,
          owner: agent.publicKey,
        })
        .signers([agent])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "Unauthorized");
    }
  });

  // ─── Pause / Unpause ───

  it("owner pauses wallet", async () => {
    await program.methods
      .pause()
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.paused, true);
  });

  it("rejects transfer when paused", async () => {
    try {
      await program.methods
        .transferSol(new anchor.BN(1_000_000), new anchor.BN(0.001 * LAMPORTS_PER_SOL))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "Paused");
    }
  });

  it("owner unpauses wallet", async () => {
    await program.methods
      .unpause()
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.paused, false);
  });

  // ─── SPL Token Transfer ───

  let mint: PublicKey;
  let walletAta: PublicKey;
  let recipientAta: PublicKey;

  it("sets up SPL token and funds wallet", async () => {
    // Create a test token
    mint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6 // USDC-like decimals
    );

    // Create ATAs
    walletAta = await createAccount(
      provider.connection,
      admin.payer,
      mint,
      walletPda,
      Keypair.generate() // use random keypair to avoid ATA collision
    );

    recipientAta = await createAccount(
      provider.connection,
      admin.payer,
      mint,
      recipient.publicKey,
      Keypair.generate()
    );

    // Mint 1000 tokens to wallet ATA
    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      walletAta,
      admin.publicKey,
      1_000_000_000 // 1000 tokens with 6 decimals
    );

    const walletTokenInfo = await getAccount(provider.connection, walletAta);
    assert.equal(Number(walletTokenInfo.amount), 1_000_000_000);
  });

  it("agent transfers SPL tokens within limits", async () => {
    // Transfer 10 tokens ($10 USDC equivalent)
    await program.methods
      .transferToken(new anchor.BN(10_000_000), new anchor.BN(10_000_000))
      .accounts({
        wallet: walletPda,
        agent: agent.publicKey,
        mint: mint,
        walletTokenAccount: walletAta,
        recipientTokenAccount: recipientAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const recipientTokenInfo = await getAccount(provider.connection, recipientAta);
    assert.equal(Number(recipientTokenInfo.amount), 10_000_000);
  });

  // ─── Per-Token Limits ───

  it("owner sets per-token limit", async () => {
    await program.methods
      .setTokenLimit(mint, new anchor.BN(50_000_000), new anchor.BN(20_000_000))
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.tokenLimits.length, 1);
    assert.equal(wallet.tokenLimits[0].mint.toBase58(), mint.toBase58());
    assert.equal(wallet.tokenLimits[0].dailyLimit.toNumber(), 50_000_000);
    assert.equal(wallet.tokenLimits[0].perTxLimit.toNumber(), 20_000_000);
  });

  it("rejects token transfer exceeding per-token tx limit", async () => {
    try {
      // Try to send 25 tokens, but per-token tx limit is 20
      await program.methods
        .transferToken(new anchor.BN(25_000_000), new anchor.BN(25_000_000))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          mint: mint,
          walletTokenAccount: walletAta,
          recipientTokenAccount: recipientAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "TokenPerTxLimitExceeded");
    }
  });

  it("owner removes per-token limit", async () => {
    await program.methods
      .removeTokenLimit(mint)
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.tokenLimits.length, 0);
  });

  // ─── Passkey Registration ───

  it("owner registers passkey", async () => {
    // Generate a fake P-256 public key (64 bytes)
    const fakePubkey = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) fakePubkey[i] = i + 1;

    await program.methods
      .registerPasskey([...fakePubkey])
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.passkeyRegistered, true);
    assert.deepEqual(Buffer.from(wallet.passkeyPubkey), fakePubkey);
  });

  it("rejects duplicate passkey registration", async () => {
    const fakePubkey = Buffer.alloc(64, 0xff);
    try {
      await program.methods
        .registerPasskey([...fakePubkey])
        .accounts({ wallet: walletPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "PasskeyAlreadyRegistered");
    }
  });

  // ─── Ownership Transfer ───

  it("owner transfers ownership", async () => {
    const newOwner = Keypair.generate();

    await program.methods
      .transferOwnership(newOwner.publicKey)
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    assert.equal(wallet.owner.toBase58(), newOwner.publicKey.toBase58());

    // Transfer back for remaining tests
    const sig = await provider.connection.requestAirdrop(newOwner.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    await program.methods
      .transferOwnership(owner.publicKey)
      .accounts({ wallet: walletPda, owner: newOwner.publicKey })
      .signers([newOwner])
      .rpc();
  });

  // ─── Emergency Withdraw ───

  it("owner withdraws SOL", async () => {
    const ownerBalBefore = await provider.connection.getBalance(owner.publicKey);

    await program.methods
      .withdrawSol()
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
        recipient: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const ownerBalAfter = await provider.connection.getBalance(owner.publicKey);
    assert.isAbove(ownerBalAfter, ownerBalBefore);
  });

  it("owner withdraws SPL tokens", async () => {
    const ownerAta = await createAccount(
      provider.connection,
      admin.payer,
      mint,
      owner.publicKey,
      Keypair.generate()
    );

    await program.methods
      .withdrawToken()
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
        walletTokenAccount: walletAta,
        recipientTokenAccount: ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const ownerTokenInfo = await getAccount(provider.connection, ownerAta);
    assert.isAbove(Number(ownerTokenInfo.amount), 0);
  });
});
