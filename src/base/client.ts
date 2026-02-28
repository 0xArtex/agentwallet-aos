import { ethers, Contract, Wallet, JsonRpcProvider } from "ethers";
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
    approvalThreshold: string;
    paused: boolean;
  };
  spentToday: string;
  remainingDaily: string;
  gasBalance: string;
}

export interface PendingTxInfo {
  txId: number;
  to: string;
  amount: string;
  createdAt: number;
  executed: boolean;
  cancelled: boolean;
}

export class BaseWalletClient {
  private provider: JsonRpcProvider;
  private adminWallet: Wallet;
  private factory: Contract;
  private factoryAddress: string;

  constructor(rpcUrl: string, adminPrivateKey: string, factoryAddress: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.adminWallet = new Wallet(adminPrivateKey, this.provider);
    this.factoryAddress = factoryAddress;
    this.factory = new Contract(factoryAddress, FACTORY_ABI, this.adminWallet);
  }

  /**
   * Deploy a new wallet for an agent.
   * Returns the wallet address (deterministic — can be predicted beforehand).
   */
  async createWallet(ownerAddress: string, agentAddress: string): Promise<string> {
    const tx = await this.factory.createWallet(ownerAddress, agentAddress);
    const receipt = await tx.wait();

    // Extract wallet address from WalletCreated event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = this.factory.interface.parseLog(log);
        return parsed?.name === "WalletCreated";
      } catch { return false; }
    });

    if (event) {
      const parsed = this.factory.interface.parseLog(event);
      return parsed!.args.wallet;
    }

    // Fallback: predict address
    const index = await this.factory.walletCount(ownerAddress);
    return this.factory.getAddress(ownerAddress, agentAddress, index - 1n);
  }

  /**
   * Predict a wallet address before deployment.
   */
  async predictAddress(ownerAddress: string, agentAddress: string): Promise<string> {
    const index = await this.factory.walletCount(ownerAddress);
    return this.factory.getAddress(ownerAddress, agentAddress, index);
  }

  /**
   * Get full wallet info.
   */
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
        approvalThreshold: policy.approvalThreshold.toString(),
        paused: policy.paused,
      },
      spentToday: spentToday.toString(),
      remainingDaily: remainingDaily.toString(),
      gasBalance: gasBalance.toString(),
    };
  }

  /**
   * Update wallet policy (must be called by owner).
   */
  async setPolicy(
    walletAddress: string,
    ownerPrivateKey: string,
    dailyLimit: bigint,
    perTxLimit: bigint,
    approvalThreshold: bigint
  ): Promise<string> {
    const ownerWallet = new Wallet(ownerPrivateKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.setPolicy(dailyLimit, perTxLimit, approvalThreshold);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Approve a pending transaction (must be called by owner).
   */
  async approveTx(walletAddress: string, ownerPrivateKey: string, txId: number): Promise<string> {
    const ownerWallet = new Wallet(ownerPrivateKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.approveTx(txId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Cancel a pending transaction (must be called by owner).
   */
  async cancelTx(walletAddress: string, ownerPrivateKey: string, txId: number): Promise<string> {
    const ownerWallet = new Wallet(ownerPrivateKey, this.provider);
    const wallet = new Contract(walletAddress, WALLET_ABI, ownerWallet);
    const tx = await wallet.cancelTx(txId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Get pending transaction info.
   */
  async getPendingTx(walletAddress: string, txId: number): Promise<PendingTxInfo> {
    const wallet = new Contract(walletAddress, WALLET_ABI, this.provider);
    const ptx = await wallet.getPendingTx(txId);
    return {
      txId,
      to: ptx.to,
      amount: ptx.amount.toString(),
      createdAt: Number(ptx.createdAt),
      executed: ptx.executed,
      cancelled: ptx.cancelled,
    };
  }

  /**
   * Top up gas for a wallet (admin only).
   */
  async topUpGas(walletAddress: string): Promise<string> {
    const tx = await this.factory.topUpGas(walletAddress);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Get total gas sponsored for a wallet.
   */
  async gasSponsored(walletAddress: string): Promise<string> {
    const sponsored = await this.factory.gasSponsored(walletAddress);
    return sponsored.toString();
  }

  /**
   * Check if an address is a wallet deployed by our factory.
   */
  async isWallet(address: string): Promise<boolean> {
    return this.factory.isWallet(address);
  }

  /**
   * Get total wallets deployed.
   */
  async totalWallets(): Promise<number> {
    const total = await this.factory.totalWallets();
    return Number(total);
  }
}
