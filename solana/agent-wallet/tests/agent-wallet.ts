import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentWallet } from "../target/types/agent_wallet";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

describe("agent-wallet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.agentWallet as Program<AgentWallet>;

  const admin = provider.wallet as anchor.Wallet;
  const owner = Keypair.generate();
  const agent = Keypair.generate();

  let factoryPda: PublicKey;
  let factoryBump: number;
  let walletPda: PublicKey;
  let walletBump: number;

  // Token test vars
  let mint: PublicKey;
  let walletTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;
  const mintAuthority = Keypair.generate();
  const recipient = Keypair.generate();

  before(async () => {
    // Derive factory PDA
    [factoryPda, factoryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("factory")],
      program.programId
    );

    // Fund test accounts from provider wallet (airdrop often rate-limited on devnet)
    const fundTx = new anchor.web3.Transaction();
    for (const [dest, amount] of [
      [owner.publicKey, 0.15 * LAMPORTS_PER_SOL],
      [agent.publicKey, 0.15 * LAMPORTS_PER_SOL],
      [recipient.publicKey, 0.01 * LAMPORTS_PER_SOL],
      [mintAuthority.publicKey, 0.1 * LAMPORTS_PER_SOL],
    ] as [PublicKey, number][]) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: dest,
          lamports: amount,
        })
      );
    }
    await provider.sendAndConfirm(fundTx);
  });

  // ─── Factory ───

  it("Initializes factory", async () => {
    await program.methods
      .initializeFactory()
      .accounts({
        factory: factoryPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const factory = await program.account.factory.fetch(factoryPda);
    expect(factory.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(factory.totalWallets.toNumber()).to.equal(0);
  });

  // ─── Wallet Creation ───

  it("Creates a wallet", async () => {
    const index = new BN(0);
    [walletPda, walletBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("wallet"),
        owner.publicKey.toBuffer(),
        agent.publicKey.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const dailyLimit = new BN(1_000_000); // 1 USDC (6 decimals)
    const perTxLimit = new BN(500_000);   // 0.5 USDC

    await program.methods
      .createWallet(dailyLimit, perTxLimit)
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
    expect(wallet.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(wallet.agent.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(wallet.dailyLimit.toNumber()).to.equal(1_000_000);
    expect(wallet.perTxLimit.toNumber()).to.equal(500_000);
    expect(wallet.paused).to.equal(false);
    expect(wallet.index.toNumber()).to.equal(0);

    const factory = await program.account.factory.fetch(factoryPda);
    expect(factory.totalWallets.toNumber()).to.equal(1);
  });

  it("Rejects wallet with per_tx > daily limit", async () => {
    try {
      const index = new BN(1);
      const [badWalletPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("wallet"),
          owner.publicKey.toBuffer(),
          agent.publicKey.toBuffer(),
          index.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // This should use factory.total_wallets = 1 now, so index=1
      await program.methods
        .createWallet(new BN(100), new BN(200)) // per_tx > daily
        .accounts({
          factory: factoryPda,
          wallet: badWalletPda,
          owner: owner.publicKey,
          agent: agent.publicKey,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("InvalidLimits");
    }
  });

  // ─── SOL Transfer ───

  it("Funds wallet with SOL", async () => {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: walletPda,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx);

    const balance = await provider.connection.getBalance(walletPda);
    expect(balance).to.be.greaterThan(0.05 * LAMPORTS_PER_SOL);
  });

  it("Agent transfers SOL", async () => {
    const recipientBalanceBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    const amountLamports = new BN(0.01 * LAMPORTS_PER_SOL);
    const amountUsdc = new BN(100_000); // 0.1 USDC worth

    await program.methods
      .transferSol(amountUsdc, amountLamports)
      .accounts({
        wallet: walletPda,
        agent: agent.publicKey,
        recipient: recipient.publicKey,
      })
      .signers([agent])
      .rpc();

    const recipientBalanceAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(
      0.01 * LAMPORTS_PER_SOL
    );

    const wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.spentToday.toNumber()).to.equal(100_000);
  });

  it("Rejects SOL transfer exceeding per-tx limit", async () => {
    try {
      await program.methods
        .transferSol(new BN(600_000), new BN(0.01 * LAMPORTS_PER_SOL)) // 0.6 USDC > 0.5 per_tx
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("PerTxLimitExceeded");
    }
  });

  it("Rejects SOL transfer exceeding daily limit", async () => {
    // Already spent 100k, daily is 1M. Try spending 950k more.
    try {
      await program.methods
        .transferSol(new BN(500_000), new BN(0.001 * LAMPORTS_PER_SOL))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();

      // That worked (100k + 500k = 600k < 1M). Now try another 500k.
      await program.methods
        .transferSol(new BN(500_000), new BN(0.001 * LAMPORTS_PER_SOL))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("DailyLimitExceeded");
    }
  });

  it("Rejects SOL transfer from non-agent", async () => {
    const rando = Keypair.generate();
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: rando.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    try {
      await program.methods
        .transferSol(new BN(1000), new BN(1000))
        .accounts({
          wallet: walletPda,
          agent: rando.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([rando])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("UnauthorizedAgent");
    }
  });

  // ─── Owner Actions ───

  it("Owner sets policy", async () => {
    await program.methods
      .setPolicy(new BN(5_000_000), new BN(2_000_000))
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.dailyLimit.toNumber()).to.equal(5_000_000);
    expect(wallet.perTxLimit.toNumber()).to.equal(2_000_000);
  });

  it("Non-owner cannot set policy", async () => {
    try {
      await program.methods
        .setPolicy(new BN(999), new BN(999))
        .accounts({
          wallet: walletPda,
          owner: agent.publicKey,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("Owner pauses and unpauses", async () => {
    await program.methods
      .pause()
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    let wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.paused).to.equal(true);

    // Agent can't transfer while paused
    try {
      await program.methods
        .transferSol(new BN(1000), new BN(1000))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("Paused");
    }

    await program.methods
      .unpause()
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.paused).to.equal(false);
  });

  // ─── Token Limits ───

  it("Owner sets and removes token limit", async () => {
    const fakeMint = Keypair.generate().publicKey;

    await program.methods
      .setTokenLimit(fakeMint, new BN(10_000_000), new BN(1_000_000))
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    let wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.tokenLimits.length).to.equal(1);
    expect(wallet.tokenLimits[0].mint.toBase58()).to.equal(fakeMint.toBase58());
    expect(wallet.tokenLimits[0].dailyLimit.toNumber()).to.equal(10_000_000);

    // Update existing
    await program.methods
      .setTokenLimit(fakeMint, new BN(20_000_000), new BN(5_000_000))
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.tokenLimits.length).to.equal(1);
    expect(wallet.tokenLimits[0].dailyLimit.toNumber()).to.equal(20_000_000);

    // Remove
    await program.methods
      .removeTokenLimit(fakeMint)
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.tokenLimits.length).to.equal(0);
  });

  // ─── SPL Token Transfer ───

  it("Agent transfers SPL tokens", async () => {
    // Create mint
    mint = await createMint(
      provider.connection,
      (admin as any).payer || admin.payer,
      mintAuthority.publicKey,
      null,
      6
    );

    // Create token accounts
    walletTokenAccount = await createAccount(
      provider.connection,
      (admin as any).payer || admin.payer,
      mint,
      walletPda,
      Keypair.generate()
    );

    recipientTokenAccount = await createAccount(
      provider.connection,
      (admin as any).payer || admin.payer,
      mint,
      recipient.publicKey,
      Keypair.generate()
    );

    // Mint tokens to wallet's token account
    await mintTo(
      provider.connection,
      (admin as any).payer || admin.payer,
      mint,
      walletTokenAccount,
      mintAuthority,
      1_000_000_000 // 1000 tokens
    );

    // Set token limit
    await program.methods
      .setTokenLimit(mint, new BN(500_000_000), new BN(100_000_000))
      .accounts({ wallet: walletPda, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    // Transfer 50 tokens
    const amount = new BN(50_000_000);
    const amountUsdc = new BN(50_000); // 0.05 USDC equivalent

    await program.methods
      .transferToken(amount, amountUsdc)
      .accounts({
        wallet: walletPda,
        agent: agent.publicKey,
        mint: mint,
        walletTokenAccount: walletTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const recipientAccount = await getAccount(
      provider.connection,
      recipientTokenAccount
    );
    expect(Number(recipientAccount.amount)).to.equal(50_000_000);
  });

  it("Rejects token transfer exceeding per-token limit", async () => {
    try {
      // Per-token per_tx limit is 100M (100 tokens). Try 200 tokens.
      await program.methods
        .transferToken(new BN(200_000_000), new BN(10_000))
        .accounts({
          wallet: walletPda,
          agent: agent.publicKey,
          mint: mint,
          walletTokenAccount: walletTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("TokenPerTxLimitExceeded");
    }
  });

  // ─── Withdraw ───

  it("Owner withdraws SOL", async () => {
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
    expect(ownerBalAfter).to.be.greaterThan(ownerBalBefore);
  });

  it("Owner withdraws tokens", async () => {
    const ownerTokenAccount = await createAccount(
      provider.connection,
      (admin as any).payer || admin.payer,
      mint,
      owner.publicKey,
      Keypair.generate()
    );

    await program.methods
      .withdrawToken()
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
        walletTokenAccount: walletTokenAccount,
        recipientTokenAccount: ownerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const account = await getAccount(provider.connection, ownerTokenAccount);
    expect(Number(account.amount)).to.be.greaterThan(0);
  });

  // ─── Ownership Transfer ───

  it("Owner transfers ownership", async () => {
    const newOwner = Keypair.generate();

    await program.methods
      .transferOwnership(newOwner.publicKey)
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());

    // Old owner can't act anymore
    try {
      await program.methods
        .pause()
        .accounts({ wallet: walletPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }

    // Fund new owner and transfer back
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: newOwner.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    await program.methods
      .transferOwnership(owner.publicKey)
      .accounts({
        wallet: walletPda,
        owner: newOwner.publicKey,
      })
      .signers([newOwner])
      .rpc();
  });

  // ─── Passkey Registration ───

  it("Owner registers passkey", async () => {
    const fakePasskey = Buffer.alloc(64);
    fakePasskey.fill(0xab);

    await program.methods
      .registerPasskey([...fakePasskey])
      .accounts({
        wallet: walletPda,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const wallet = await program.account.wallet.fetch(walletPda);
    expect(wallet.passkeyRegistered).to.equal(true);
    expect(Buffer.from(wallet.passkeyPubkey)).to.deep.equal(fakePasskey);
  });

  it("Rejects duplicate passkey registration", async () => {
    const fakePasskey = Buffer.alloc(64);
    fakePasskey.fill(0xcd);

    try {
      await program.methods
        .registerPasskey([...fakePasskey])
        .accounts({
          wallet: walletPda,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.contain("PasskeyAlreadyRegistered");
    }
  });
});
