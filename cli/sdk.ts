/**
 * AgentWallet SDK — Non-custodial smart wallets for AI agents
 *
 * @example
 * ```ts
 * import { AgentWallet } from '@agntos/agentwallet'
 *
 * const aw = new AgentWallet()
 * const { wallet, setupUrl } = await aw.create('0xAgentAddress')
 * console.log(wallet.address) // your new wallet
 * console.log(setupUrl)       // send this to your human
 * ```
 */

export interface WalletPolicy {
  dailyLimit: string
  perTxLimit: string
  paused: boolean
}

export interface WalletInfo {
  address: string
  owner: string
  agent: string
  chain: string
  policy: WalletPolicy
  spentToday: string
  remainingDaily: string
  gasBalance: string
}

export interface CreateResult {
  wallet: WalletInfo
  setupUrl?: string
  setupToken?: string
  mode: 'managed' | 'unmanaged'
}

export interface ApprovalResult {
  approvalUrl: string
}

export interface StatsResult {
  totalWallets: number
}

export class AgentWalletError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message)
    this.name = 'AgentWalletError'
  }
}

export class AgentWallet {
  private baseUrl: string

  /**
   * @param baseUrl - API endpoint (default: https://agntos.dev/wallet)
   */
  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || process.env.AGENTWALLET_URL || 'https://agntos.dev/wallet').replace(/\/$/, '')
  }

  private async request(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json()
    if (data.error) throw new AgentWalletError(data.error, res.status)
    return data
  }

  /** Create a managed wallet (human registers passkey later) */
  async create(agent: string): Promise<CreateResult> {
    return this.request('POST', '/wallet', { agent })
  }

  /** Create an unmanaged wallet (agent is its own owner) */
  async createUnmanaged(agent: string): Promise<CreateResult> {
    return this.request('POST', '/wallet', { agent, mode: 'unmanaged' })
  }

  /** Get wallet info, balances, and policy */
  async status(wallet: string): Promise<{ wallet: WalletInfo }> {
    return this.request('GET', `/wallet/${wallet}`)
  }

  /** Get total wallets created */
  async stats(): Promise<StatsResult> {
    return this.request('GET', '/stats')
  }

  /** Request a limit increase — returns URL for human to approve */
  async requestLimitIncrease(wallet: string, opts: {
    dailyLimit?: number
    perTxLimit?: number
    reason?: string
  }): Promise<ApprovalResult> {
    return this.request('POST', '/approve/request', {
      wallet,
      action: 'limits',
      ...(opts.dailyLimit !== undefined ? { dailyLimit: String(opts.dailyLimit) } : {}),
      ...(opts.perTxLimit !== undefined ? { perTxLimit: String(opts.perTxLimit) } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
    })
  }

  /** Request a per-token spending limit — returns URL for human to approve */
  async requestTokenLimit(wallet: string, opts: {
    token: string
    dailyLimit: number
    perTxLimit: number
    decimals?: number
    reason?: string
  }): Promise<ApprovalResult> {
    return this.request('POST', '/approve/request', {
      wallet,
      action: 'tokenLimit',
      token: opts.token,
      tokenDailyLimit: String(opts.dailyLimit),
      tokenPerTxLimit: String(opts.perTxLimit),
      tokenDecimals: String(opts.decimals ?? 18),
      ...(opts.reason ? { reason: opts.reason } : {}),
    })
  }

  /** Request removal of a per-token limit — returns URL for human to approve */
  async requestRemoveTokenLimit(wallet: string, opts: {
    token: string
    reason?: string
  }): Promise<ApprovalResult> {
    return this.request('POST', '/approve/request', {
      wallet,
      action: 'removeTokenLimit',
      token: opts.token,
      ...(opts.reason ? { reason: opts.reason } : {}),
    })
  }

  /** Request wallet pause — returns URL for human to approve */
  async requestPause(wallet: string, reason?: string): Promise<ApprovalResult> {
    return this.request('POST', '/approve/request', {
      wallet,
      action: 'pause',
      ...(reason ? { reason } : {}),
    })
  }

  /** Request wallet unpause — returns URL for human to approve */
  async requestUnpause(wallet: string, reason?: string): Promise<ApprovalResult> {
    return this.request('POST', '/approve/request', {
      wallet,
      action: 'unpause',
      ...(reason ? { reason } : {}),
    })
  }
}

export default AgentWallet
