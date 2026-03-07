import { Contract, Wallet, JsonRpcProvider } from "ethers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FACTORY_ABI = JSON.parse(readFileSync(join(__dirname, "abi/AgentWalletFactory.json"), "utf-8"));
const WALLET_ABI = JSON.parse(readFileSync(join(__dirname, "abi/AgentWallet.json"), "utf-8"));

export interface WalletInfo {
  address: string;
  owner: string;
  agent: string;
  chain: "base";
  policy: {
    dailyLimit: string;
    perTxLimit: string;
    paused: boolean;
  };
  spentToday: string;
  remainingDaily: string;
  gasBalance: string;
}

export class BaseWalletClient {
  private provider: JsonRpcProvider;
  public adminWallet: Wallet;
  private factory: Contract;
  private ethUsdOracle: string;
  private usdcAddress: string;

  constructor(rpcUrl: string, adminPrivateKey: string, factoryAddress: string, ethUsdOracle?: string, usdcAddress?: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.adminWallet = new Wallet(adminPrivateKey, this.provider);
    this.factory = new Contract(factoryAddress, FACTORY_ABI, this.adminWallet);
    this.ethUsdOracle = ethUsdOracle || "";
    this.usdcAddress = usdcAddress || "";
  }

  private async sendWithRetry(fn: () => Promise<any>, label: string, maxRetries = 3): Promise<any> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Reset nonce cache before each attempt
        const nonce = await this.provider.getTransactionCount(this.adminWallet.address, "latest");
        console.log(`[${label}] attempt ${attempt + 1}, nonce: ${nonce}`);
        const tx = await fn();
        console.log(`[${label}] tx hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`[${label}] mined, block: ${receipt?.blockNumber}`);
        return receipt;
      } catch (err: any) {
        const code = err.code || "";
        const msg = err.message || "";
        const isRetryable = code === "NONCE_EXPIRED" || code === "REPLACEMENT_UNDERPRICED" ||
          msg.includes("nonce too low") || msg.includes("replacement transaction underpriced") ||
          msg.includes("already known");
        if (isRetryable && attempt < maxRetries - 1) {
          const delay = 1000 * (attempt + 1);
          console.log(`[${label}] retryable error (${code}), waiting ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async createManagedWallet(agentAddress: string): Promise<string> {
    console.log("[createManagedWallet] sending tx for agent:", agentAddress);
    const receipt = await this.sendWithRetry(
      () => this.factory.createManagedWallet(agentAddress),
      "createManagedWallet"
    );
    const addr = this.extractWalletAddress(receipt) || agentAddress;
    await this.configureOracle(addr);
    return addr;
  }

  async createUnmanagedWallet(agentAddress: string): Promise<string> {
    const receipt = await this.sendWithRetry(
      () => this.factory.createUnmanagedWallet(agentAddress),
      "createUnmanagedWallet"
    );
    const addr = this.extractWalletAddress(receipt) || agentAddress;
    return addr;
  }

  async registerPasskey(walletAddress: string, pubKeyX: string, pubKeyY: string): Promise<string> {
    const wallet = new Contract(walletAddress, WALLET_ABI, this.adminWallet);
    const tx = await wallet.registerPasskey(pubKeyX, pubKeyY);
    return (await tx.wait()).hash;
  }

  private extractWalletAddress(receipt: any): string | null {
    const event = receipt.logs.find((log: any) => {
      try { return this.factory.interface.parseLog({ topics: log.topics, data: log.data })?.name === "WalletCreated"; }
      catch { return false; }
    });
    if (event) {
      return this.factory.interface.parseLog({ topics: event.topics, data: event.data })!.args.wallet;
    }
    return null;
  }

  async createWallet(ownerAddress: string, agentAddress: string): Promise<string> {
    const tx = await this.factory.createWallet(ownerAddress, agentAddress);
    const receipt = await tx.wait();

    const event = receipt.logs.find((log: any) => {
      try {
        return this.factory.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "WalletCreated";
      } catch { return false; }
    });

    let walletAddr: string;
    if (event) {
      const parsed = this.factory.interface.parseLog({ topics: event.topics as string[], data: event.data });
      walletAddr = parsed!.args.wallet;
    } else {
      const index = await this.factory.walletCount(ownerAddress);
      walletAddr = await (this.factory as any).getAddress(ownerAddress, agentAddress, index - 1n);
    }
    await this.configureOracle(walletAddr);
    return walletAddr;
  }

  async predictAddress(ownerAddress: string, agentAddress: string): Promise<string> {
    const index = await this.factory.walletCount(ownerAddress);
    return (this.factory as any).getAddress(ownerAddress, agentAddress, index);
  }

  async getWallet(walletAddress: string): Promise<WalletInfo> {
    const wallet = new Contract(walletAddress, WALLET_ABI, this.provider);

    const [owner, agent, policy, spentToday, remainingDaily, gasBalance] = await Promise.all([
      wallet.owner(),
      wallet.agentKey(),
      wallet.getPolicy(),
      wallet.getSpentToday(),
      wallet.getRemainingDaily(),
      this.provider.getBalance(walletAddress),
    ]);

    return {
      address: walletAddress,
      owner,
      agent,
      chain: "base",
      policy: {
        dailyLimit: policy.dailyLimit.toString(),
        perTxLimit: policy.perTxLimit.toString(),
        paused: policy.paused,
      },
      spentToday: spentToday.toString(),
      remainingDaily: remainingDaily.toString(),
      gasBalance: gasBalance.toString(),
    };
  }

  async setPolicy(walletAddress: string, ownerKey: string, dailyLimit: bigint, perTxLimit: bigint): Promise<string> {
    const ownerWallet = new Wallet(ownerKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.setPolicy(dailyLimit, perTxLimit);
    return (await tx.wait()).hash;
  }

  async setBlacklist(walletAddress: string, ownerKey: string, addr: string, blocked: boolean): Promise<string> {
    const ownerWallet = new Wallet(ownerKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.setBlacklist(addr, blocked);
    return (await tx.wait()).hash;
  }

  async setBlacklistBatch(walletAddress: string, ownerKey: string, addrs: string[], blocked: boolean): Promise<string> {
    const ownerWallet = new Wallet(ownerKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.setBlacklistBatch(addrs, blocked);
    return (await tx.wait()).hash;
  }

  async isBlacklisted(walletAddress: string, addr: string): Promise<boolean> {
    const wallet = new Contract(walletAddress, WALLET_ABI, this.provider);
    return wallet.blacklisted(addr);
  }

  private async configureOracle(walletAddress: string): Promise<void> {
    if (!this.ethUsdOracle || !this.usdcAddress) return;
    try {
      const wallet = new Contract(walletAddress, WALLET_ABI, this.adminWallet);
      await this.sendWithRetry(
        () => wallet.setOracle(this.ethUsdOracle, this.usdcAddress),
        "configureOracle"
      );
    } catch (e: any) {
      if (!e.message?.includes("oracle already set")) throw e;
    }
  }

  async setTokenLimit(walletAddress: string, ownerKey: string, token: string, dailyLimit: bigint, perTxLimit: bigint): Promise<string> {
    const ownerWallet = new Wallet(ownerKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.setTokenLimit(token, dailyLimit, perTxLimit);
    return (await tx.wait()).hash;
  }

  async removeTokenLimit(walletAddress: string, ownerKey: string, token: string): Promise<string> {
    const ownerWallet = new Wallet(ownerKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.removeTokenLimit(token);
    return (await tx.wait()).hash;
  }

  async getTokenLimit(walletAddress: string, token: string): Promise<{ dailyLimit: string; perTxLimit: string; active: boolean }> {
    const wallet = new Contract(walletAddress, WALLET_ABI, this.provider);
    const tl = await wallet.getTokenLimit(token);
    return { dailyLimit: tl.dailyLimit.toString(), perTxLimit: tl.perTxLimit.toString(), active: tl.active };
  }

  async topUpGas(walletAddress: string): Promise<string> {
    const tx = await this.factory.topUpGas(walletAddress);
    return (await tx.wait()).hash;
  }

  async isWallet(address: string): Promise<boolean> {
    return this.factory.isWallet(address);
  }

  async totalWallets(): Promise<number> {
    return Number(await this.factory.totalWallets());
  }
}
