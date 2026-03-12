import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
// @ts-ignore - CJS module
import anchor from "@coral-xyz/anchor";
const { Program, AnchorProvider, Wallet: AnchorWallet, BN } = anchor;
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDL = JSON.parse(readFileSync(join(__dirname, "idl.json"), "utf-8"));

export interface SolanaWalletInfo {
  address: string;
  owner: string;
  agent: string;
  chain: "solana";
  policy: { dailyLimit: string; perTxLimit: string; paused: boolean };
  spentToday: string;
  remainingDaily: string;
  solBalance: string;
  gasBalance: string; // alias for solBalance for compatibility
  passkeyRegistered: boolean;
  tokenLimits: Array<{ mint: string; dailyLimit: string; perTxLimit: string; spentToday: string }>;
}

export class SolanaWalletClient {
  private connection: Connection;
  private adminKeypair: Keypair;
  private programId: PublicKey;
  private provider: any;
  private program: any;

  constructor(rpcUrl: string, adminKey: string, programId: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);

    // adminKey can be base58 secret key or a file path to JSON array
    if (adminKey.startsWith("/") || adminKey.startsWith(".")) {
      const bytes = JSON.parse(readFileSync(adminKey, "utf-8"));
      this.adminKeypair = Keypair.fromSecretKey(new Uint8Array(bytes));
    } else {
      // base58 encoded secret key - decode it
      const { default: bs58 } = await_import_bs58();
      this.adminKeypair = Keypair.fromSecretKey(bs58.decode(adminKey));
    }

    const wallet = new AnchorWallet(this.adminKeypair);
    this.provider = new AnchorProvider(this.connection, wallet, { commitment: "confirmed" });
    this.program = new Program(IDL, this.provider);
  }

  get adminPublicKey(): PublicKey {
    return this.adminKeypair.publicKey;
  }

  private getFactoryPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("factory")],
      this.programId
    );
  }

  private getWalletPda(owner: PublicKey, agent: PublicKey, index: any): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("wallet"), owner.toBuffer(), agent.toBuffer(), index.toArrayLike(Buffer, "le", 8)],
      this.programId
    );
  }

  async initializeFactory(): Promise<string> {
    const [factoryPda] = this.getFactoryPda();
    const tx = await this.program.methods
      .initializeFactory()
      .accounts({
        factory: factoryPda,
        admin: this.adminKeypair.publicKey,
        systemProgram: PublicKey.default,
      })
      .signers([this.adminKeypair])
      .rpc();
    return tx;
  }

  async totalWallets(): Promise<number> {
    const [factoryPda] = this.getFactoryPda();
    try {
      const factory = await (this.program.account as any)["factory"].fetch(factoryPda);
      return (factory.totalWallets as any).toNumber();
    } catch {
      return 0;
    }
  }

  async createWallet(owner: string, agent: string, dailyLimit: number, perTxLimit: number): Promise<string> {
    const ownerPubkey = new PublicKey(owner);
    const agentPubkey = new PublicKey(agent);
    const [factoryPda] = this.getFactoryPda();

    // Get current total_wallets for PDA derivation
    const factory = await (this.program.account as any)["factory"].fetch(factoryPda);
    const index = factory.totalWallets as any;

    const [walletPda] = this.getWalletPda(ownerPubkey, agentPubkey, index);

    await this.program.methods
      .createWallet(new BN(dailyLimit), new BN(perTxLimit))
      .accounts({
        factory: factoryPda,
        wallet: walletPda,
        owner: ownerPubkey,
        agent: agentPubkey,
        payer: this.adminKeypair.publicKey,
        systemProgram: PublicKey.default,
      })
      .signers([this.adminKeypair])
      .rpc();

    return walletPda.toBase58();
  }

  async getWallet(walletAddress: string): Promise<SolanaWalletInfo> {
    const walletPubkey = new PublicKey(walletAddress);
    const walletAccount = await (this.program.account as any)["wallet"].fetch(walletPubkey);
    const solBalance = await this.connection.getBalance(walletPubkey);

    const dailyLimit = (walletAccount.dailyLimit as any).toString();
    const spentToday = (walletAccount.spentToday as any).toString();
    const dailyLimitNum = BigInt(dailyLimit);
    const spentTodayNum = BigInt(spentToday);
    const remaining = dailyLimitNum > spentTodayNum ? (dailyLimitNum - spentTodayNum).toString() : "0";

    const tokenLimits = (walletAccount.tokenLimits as any[] || []).map((tl: any) => ({
      mint: tl.mint.toBase58(),
      dailyLimit: tl.dailyLimit.toString(),
      perTxLimit: tl.perTxLimit.toString(),
      spentToday: tl.spentToday.toString(),
    }));

    return {
      address: walletAddress,
      owner: (walletAccount.owner as PublicKey).toBase58(),
      agent: (walletAccount.agent as PublicKey).toBase58(),
      chain: "solana",
      policy: {
        dailyLimit,
        perTxLimit: (walletAccount.perTxLimit as any).toString(),
        paused: walletAccount.paused as boolean,
      },
      spentToday,
      remainingDaily: remaining,
      solBalance: solBalance.toString(),
      gasBalance: solBalance.toString(),
      passkeyRegistered: walletAccount.passkeyRegistered as boolean,
      tokenLimits,
    };
  }

  async setPolicy(walletAddress: string, ownerKeypair: Uint8Array, dailyLimit: number, perTxLimit: number): Promise<string> {
    const owner = Keypair.fromSecretKey(ownerKeypair);
    const walletPubkey = new PublicKey(walletAddress);

    const tx = await this.program.methods
      .setPolicy(new BN(dailyLimit), new BN(perTxLimit))
      .accounts({
        wallet: walletPubkey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    return tx;
  }

  /** Set policy using admin keypair (admin must be current owner — for managed wallet setup) */
  async setPolicyAsAdmin(walletAddress: string, dailyLimit: number, perTxLimit: number): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);

    const tx = await this.program.methods
      .setPolicy(new BN(dailyLimit), new BN(perTxLimit))
      .accounts({
        wallet: walletPubkey,
        owner: this.adminKeypair.publicKey,
      })
      .signers([this.adminKeypair])
      .rpc();

    return tx;
  }

  /** Set per-token spending limits (owner/admin must sign) */
  async setTokenLimit(walletAddress: string, mint: string, dailyLimit: number, perTxLimit: number): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(mint);

    const tx = await this.program.methods
      .setTokenLimit(mintPubkey, new BN(dailyLimit), new BN(perTxLimit))
      .accounts({
        wallet: walletPubkey,
        owner: this.adminKeypair.publicKey,
      })
      .signers([this.adminKeypair])
      .rpc();

    return tx;
  }

  /** Register passkey on a wallet (admin must be current owner) */
  async registerPasskey(walletAddress: string, passkeyPubkey: number[]): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);

    const tx = await this.program.methods
      .registerPasskey(passkeyPubkey)
      .accounts({
        wallet: walletPubkey,
        owner: this.adminKeypair.publicKey,
      })
      .signers([this.adminKeypair])
      .rpc();

    return tx;
  }

  /** Transfer SOL from wallet (agent signs) */
  async transferSol(
    walletAddress: string,
    agentKeypair: Keypair,
    recipient: string,
    amountLamports: number,
    amountUsdc: number,
  ): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);
    const recipientPubkey = new PublicKey(recipient);

    const tx = await this.program.methods
      .transferSol(new BN(amountUsdc), new BN(amountLamports))
      .accounts({
        wallet: walletPubkey,
        agent: agentKeypair.publicKey,
        recipient: recipientPubkey,
      })
      .signers([agentKeypair])
      .rpc();

    return tx;
  }

  /** Transfer SPL token from wallet (agent signs) */
  async transferToken(
    walletAddress: string,
    agentKeypair: Keypair,
    mint: string,
    walletTokenAccount: string,
    recipientTokenAccount: string,
    amount: number,
    amountUsdc: number,
  ): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(mint);
    const walletTA = new PublicKey(walletTokenAccount);
    const recipientTA = new PublicKey(recipientTokenAccount);

    // Derive PDA signer seeds from wallet account
    const walletAccount = await (this.program.account as any)["wallet"].fetch(walletPubkey);
    const ownerKey = walletAccount.owner as PublicKey;
    const agentKey = walletAccount.agent as PublicKey;
    const index = walletAccount.index;
    const bump = walletAccount.bump;

    const tx = await this.program.methods
      .transferToken(new BN(amount), new BN(amountUsdc))
      .accounts({
        wallet: walletPubkey,
        agent: agentKeypair.publicKey,
        mint: mintPubkey,
        walletTokenAccount: walletTA,
        recipientTokenAccount: recipientTA,
        tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      })
      .signers([agentKeypair])
      .rpc();

    return tx;
  }

  /** Execute arbitrary CPI from wallet (agent signs) — for DEX swaps, etc. */
  async execute(
    walletAddress: string,
    agentKeypair: Keypair,
    targetProgramId: string,
    instructionData: Buffer,
    amountUsdc: number,
    remainingAccounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>,
  ): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);
    const targetProgram = new PublicKey(targetProgramId);

    const accountMetas = remainingAccounts.map(acc => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    }));

    const tx = await this.program.methods
      .execute(targetProgram, instructionData, new BN(amountUsdc))
      .accounts({
        wallet: walletPubkey,
        agent: agentKeypair.publicKey,
      })
      .remainingAccounts(accountMetas)
      .signers([agentKeypair])
      .rpc();

    return tx;
  }

  /** Transfer ownership (admin must be current owner — final setup step) */
  async transferOwnership(walletAddress: string, newOwner: string): Promise<string> {
    const walletPubkey = new PublicKey(walletAddress);
    const newOwnerPubkey = new PublicKey(newOwner);

    const tx = await this.program.methods
      .transferOwnership(newOwnerPubkey)
      .accounts({
        wallet: walletPubkey,
        owner: this.adminKeypair.publicKey,
      })
      .signers([this.adminKeypair])
      .rpc();

    return tx;
  }
}

// Sync-compatible bs58 import helper (module is already installed)
function await_import_bs58() {
  // bs58 is ESM-only in v6+, but we can use the sync require trick
  // Actually, since this constructor is sync, we need a workaround
  // Use a simple base58 decode inline
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  return {
    default: {
      decode(str: string): Uint8Array {
        const bytes: number[] = [0];
        for (const char of str) {
          const val = ALPHABET.indexOf(char);
          if (val === -1) throw new Error("Invalid base58 char: " + char);
          for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] * 58;
          bytes[0] += val;
          let carry = 0;
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] += carry;
            carry = (bytes[i] >> 8);
            bytes[i] &= 0xff;
          }
          while (carry) {
            bytes.push(carry & 0xff);
            carry >>= 8;
          }
        }
        // leading zeros
        for (const char of str) {
          if (char !== '1') break;
          bytes.push(0);
        }
        return new Uint8Array(bytes.reverse());
      },
      encode(bytes: Uint8Array): string {
        const digits: number[] = [0];
        for (const byte of bytes) {
          for (let i = 0; i < digits.length; i++) digits[i] = digits[i] * 256;
          digits[0] += byte;
          let carry = 0;
          for (let i = 0; i < digits.length; i++) {
            digits[i] += carry;
            carry = (digits[i] / 58) | 0;
            digits[i] %= 58;
          }
          while (carry) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
          }
        }
        let str = "";
        for (const byte of bytes) {
          if (byte !== 0) break;
          str += "1";
        }
        for (let i = digits.length - 1; i >= 0; i--) {
          str += ALPHABET[digits[i]];
        }
        return str;
      }
    }
  };
}
