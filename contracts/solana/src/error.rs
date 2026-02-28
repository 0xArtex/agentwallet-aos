use solana_program::program_error::ProgramError;

#[derive(Debug, Clone, Copy)]
pub enum WalletError {
    NotOwner,
    NotAgent,
    Paused,
    ExceedsDailyLimit,
    ExceedsPerTxLimit,
    InvalidPendingTx,
    TxExpired,
    TxAlreadyFinalized,
    AlreadyInitialized,
}

impl From<WalletError> for ProgramError {
    fn from(e: WalletError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
