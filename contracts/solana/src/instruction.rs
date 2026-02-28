use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum WalletInstruction {
    /// Initialize a new agent wallet.
    /// Accounts: [signer payer, wallet PDA, system_program]
    Initialize {
        owner: Pubkey,
        agent: Pubkey,
    },

    /// Transfer USDC (agent only). Auto-executes if within limits,
    /// or creates a PendingTx account if above approval threshold.
    /// Accounts: [signer agent, wallet PDA, token_source, token_dest, token_program, (optional: pending_tx PDA, system_program)]
    Transfer {
        amount: u64,
    },

    /// Update spending policy (owner only).
    /// Accounts: [signer owner, wallet PDA]
    SetPolicy {
        daily_limit: u64,
        per_tx_limit: u64,
        approval_threshold: u64,
    },

    /// Replace the agent key (owner only).
    /// Accounts: [signer owner, wallet PDA]
    SetAgentKey {
        new_agent: Pubkey,
    },

    /// Revoke agent access entirely (owner only).
    /// Accounts: [signer owner, wallet PDA]
    RevokeAgent,

    /// Approve a pending transaction (owner only).
    /// Accounts: [signer owner, wallet PDA, pending_tx PDA, token_source, token_dest, token_program]
    ApproveTx,

    /// Cancel a pending transaction (owner only).
    /// Accounts: [signer owner, wallet PDA, pending_tx PDA, refund_to]
    CancelTx,

    /// Pause wallet (owner only).
    /// Accounts: [signer owner, wallet PDA]
    Pause,

    /// Unpause wallet (owner only).
    /// Accounts: [signer owner, wallet PDA]
    Unpause,

    /// Emergency withdraw all tokens (owner only).
    /// Accounts: [signer owner, wallet PDA, token_source, token_dest, token_program]
    EmergencyWithdraw {
        amount: u64,
    },
}
