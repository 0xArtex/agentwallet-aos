use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Wallet policy — on-chain spending rules enforced by the program.
///
/// Defaults (set at initialization):
/// - daily_limit:         50_000_000 (50 USDC, 6 decimals)
/// - per_tx_limit:        25_000_000 (25 USDC)
/// - approval_threshold:  25_000_000 (25 USDC)
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct WalletState {
    /// Human owner — can update policy, approve/reject txs, revoke agent
    pub owner: Pubkey,
    /// Agent session key — can transact within policy bounds
    pub agent: Pubkey,
    /// Max USDC spendable per rolling 24h window (6 decimals)
    pub daily_limit: u64,
    /// Max USDC per single transaction
    pub per_tx_limit: u64,
    /// Txs above this amount get queued for human approval
    pub approval_threshold: u64,
    /// Total spent in current day window
    pub spent_today: u64,
    /// Timestamp when current day window started
    pub day_start: i64,
    /// Whether the wallet is paused
    pub paused: bool,
    /// Bump seed for PDA derivation
    pub bump: u8,
    /// Number of pending transactions
    pub pending_count: u32,
}

impl WalletState {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 4; // 110 bytes
    pub const SEED: &'static [u8] = b"agent_wallet";

    pub const DEFAULT_DAILY_LIMIT: u64 = 50_000_000;       // 50 USDC
    pub const DEFAULT_PER_TX_LIMIT: u64 = 25_000_000;      // 25 USDC
    pub const DEFAULT_APPROVAL_THRESHOLD: u64 = 25_000_000; // 25 USDC
    pub const DAY_SECONDS: i64 = 86400;
}

/// A transaction queued for human approval
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct PendingTx {
    /// Destination token account
    pub to: Pubkey,
    /// USDC amount (6 decimals)
    pub amount: u64,
    /// When this was created
    pub created_at: i64,
    /// Whether it's been executed
    pub executed: bool,
    /// Whether it's been cancelled
    pub cancelled: bool,
    /// Wallet this belongs to
    pub wallet: Pubkey,
}

impl PendingTx {
    pub const LEN: usize = 32 + 8 + 8 + 1 + 1 + 32; // 82 bytes
    pub const SEED: &'static [u8] = b"pending_tx";
    pub const EXPIRY_SECONDS: i64 = 7 * 86400; // 7 days
}
