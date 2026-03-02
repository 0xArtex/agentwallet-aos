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
  private adminWallet: Wallet;
  private factory: Contract;

  constructor(rpcUrl: string, adminPrivateKey: string, factoryAddress: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.adminWallet = new Wallet(adminPrivateKey, this.provider);
    this.factory = new Contract(factoryAddress, FACTORY_ABI, this.adminWallet);
  }

  async createManagedWallet(agentAddress: string): Promise<string> {
    const tx = await this.factory.createManagedWallet(agentAddress);
    const receipt = await tx.wait();
    return this.extractWalletAddress(receipt) || agentAddress;
  }

  async createUnmanagedWallet(agentAddress: string): Promise<string> {
    const tx = await this.factory.createUnmanagedWallet(agentAddress);
    const receipt = await tx.wait();
    return this.extractWalletAddress(receipt) || agentAddress;
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

    if (event) {
      const parsed = this.factory.interface.parseLog({ topics: event.topics as string[], data: event.data });
      return parsed!.args.wallet;
    }

    const index = await this.factory.walletCount(ownerAddress);
    return (this.factory as any).getAddress(ownerAddress, agentAddress, index - 1n);
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
