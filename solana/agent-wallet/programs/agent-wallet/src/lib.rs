use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as SplTransfer};

declare_id!("4XHYgv4fczfAtkKB792yrP57iakR9extKtkigsXCJm5e");

const WALLET_SEED: &[u8] = b"wallet";
const FACTORY_SEED: &[u8] = b"factory";
const MAX_TOKEN_LIMITS: usize = 16;

/// Secp256r1 precompile program ID
const SECP256R1_PROGRAM_ID: [u8; 32] = [
    0x06, 0xa7, 0xd5, 0x17, 0x18, 0x7b, 0xd1, 0x60,
    0x35, 0xba, 0xd7, 0x18, 0x08, 0x1e, 0xb1, 0xe8,
    0x67, 0x78, 0xd5, 0xa5, 0xea, 0x52, 0x20, 0xb0,
    0x43, 0xb2, 0x17, 0xf7, 0x05, 0x00, 0x00, 0x00,
];

// ─── Errors ───

#[error_code]
pub enum WalletError {
    #[msg("Unauthorized: only the owner can perform this action")]
    Unauthorized,
    #[msg("Unauthorized: only the agent can perform this action")]
    UnauthorizedAgent,
    #[msg("Wallet is paused")]
    Paused,
    #[msg("Transfer exceeds per-transaction limit")]
    PerTxLimitExceeded,
    #[msg("Transfer exceeds daily spending limit")]
    DailyLimitExceeded,
    #[msg("Transfer exceeds per-transaction token limit")]
    TokenPerTxLimitExceeded,
    #[msg("Transfer exceeds daily token limit")]
    TokenDailyLimitExceeded,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid limit: per-tx limit cannot exceed daily limit")]
    InvalidLimits,
    #[msg("Token limit not found")]
    TokenLimitNotFound,
    #[msg("Max token limits reached")]
    MaxTokenLimitsReached,
    #[msg("Passkey already registered")]
    PasskeyAlreadyRegistered,
    #[msg("Passkey not registered")]
    PasskeyNotRegistered,
    #[msg("Invalid passkey signature")]
    InvalidPasskeySignature,
    #[msg("Missing secp256r1 verification instruction")]
    MissingSecp256r1Ix,
}

// ─── State ───

#[account]
pub struct Factory {
    pub admin: Pubkey,
    pub total_wallets: u64,
    pub bump: u8,
}

impl Factory {
    pub const SIZE: usize = 8 + 32 + 8 + 1;
}

#[account]
pub struct Wallet {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub index: u64,
    pub daily_limit: u64,
    pub per_tx_limit: u64,
    pub spent_today: u64,
    pub last_reset_day: u64,
    pub paused: bool,
    pub bump: u8,
    /// Passkey P-256 public key (64 bytes uncompressed x,y). All zeros = not set.
    pub passkey_pubkey: [u8; 64],
    /// Whether passkey is registered
    pub passkey_registered: bool,
    pub token_limits: Vec<TokenLimit>,
}

impl Wallet {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 64 + 1 + 4 + (MAX_TOKEN_LIMITS * TokenLimit::SIZE);
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TokenLimit {
    pub mint: Pubkey,
    pub daily_limit: u64,
    pub per_tx_limit: u64,
    pub spent_today: u64,
    pub last_reset_day: u64,
}

impl TokenLimit {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 8;
}

// ─── Program ───

#[program]
pub mod agent_wallet {
    use super::*;

    pub fn initialize_factory(ctx: Context<InitializeFactory>) -> Result<()> {
        let factory = &mut ctx.accounts.factory;
        factory.admin = ctx.accounts.admin.key();
        factory.total_wallets = 0;
        factory.bump = ctx.bumps.factory;
        Ok(())
    }

    pub fn create_wallet(
        ctx: Context<CreateWallet>,
        daily_limit: u64,
        per_tx_limit: u64,
    ) -> Result<()> {
        require!(per_tx_limit <= daily_limit, WalletError::InvalidLimits);

        let factory = &mut ctx.accounts.factory;
        let wallet = &mut ctx.accounts.wallet;

        wallet.owner = ctx.accounts.owner.key();
        wallet.agent = ctx.accounts.agent.key();
        wallet.index = factory.total_wallets;
        wallet.daily_limit = daily_limit;
        wallet.per_tx_limit = per_tx_limit;
        wallet.spent_today = 0;
        wallet.last_reset_day = 0;
        wallet.paused = false;
        wallet.bump = ctx.bumps.wallet;
        wallet.passkey_pubkey = [0u8; 64];
        wallet.passkey_registered = false;
        wallet.token_limits = Vec::new();

        factory.total_wallets = factory.total_wallets.checked_add(1).ok_or(WalletError::Overflow)?;

        let wallet_key = wallet.key();
        let owner_key = wallet.owner;
        let agent_key = wallet.agent;
        let idx = wallet.index;

        emit!(WalletCreated {
            wallet: wallet_key,
            owner: owner_key,
            agent: agent_key,
            index: idx,
        });

        Ok(())
    }

    // ─── Passkey Registration (owner signs with Ed25519, stores P-256 pubkey) ───

    pub fn register_passkey(
        ctx: Context<OwnerAction>,
        passkey_pubkey: [u8; 64],
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        require!(!wallet.passkey_registered, WalletError::PasskeyAlreadyRegistered);

        wallet.passkey_pubkey = passkey_pubkey;
        wallet.passkey_registered = true;

        Ok(())
    }

    // ─── Agent Transfers ───

    pub fn transfer_sol(ctx: Context<TransferSol>, amount_usdc: u64, amount_lamports: u64) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;

        require!(!wallet.paused, WalletError::Paused);
        require!(ctx.accounts.agent.key() == wallet.agent, WalletError::UnauthorizedAgent);

        reset_daily_if_needed(wallet)?;

        require!(amount_usdc <= wallet.per_tx_limit, WalletError::PerTxLimitExceeded);
        let new_spent = wallet.spent_today.checked_add(amount_usdc).ok_or(WalletError::Overflow)?;
        require!(new_spent <= wallet.daily_limit, WalletError::DailyLimitExceeded);

        wallet.spent_today = new_spent;
        let wallet_key = wallet.key();
        let recipient_key = ctx.accounts.recipient.key();

        wallet.sub_lamports(amount_lamports)?;
        ctx.accounts.recipient.add_lamports(amount_lamports)?;

        emit!(TransferExecuted {
            wallet: wallet_key,
            recipient: recipient_key,
            amount_lamports,
            amount_usdc,
            token: None,
        });

        Ok(())
    }

    pub fn transfer_token(
        ctx: Context<TransferToken>,
        amount: u64,
        amount_usdc: u64,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;

        require!(!wallet.paused, WalletError::Paused);
        require!(ctx.accounts.agent.key() == wallet.agent, WalletError::UnauthorizedAgent);

        reset_daily_if_needed(wallet)?;

        let mint = ctx.accounts.mint.key();

        for tl in wallet.token_limits.iter_mut() {
            if tl.mint == mint {
                let clock = Clock::get()?;
                let today = (clock.unix_timestamp as u64) / 86400;
                if today > tl.last_reset_day {
                    tl.spent_today = 0;
                    tl.last_reset_day = today;
                }
                require!(amount <= tl.per_tx_limit, WalletError::TokenPerTxLimitExceeded);
                let new_token_spent = tl.spent_today.checked_add(amount).ok_or(WalletError::Overflow)?;
                require!(new_token_spent <= tl.daily_limit, WalletError::TokenDailyLimitExceeded);
                tl.spent_today = new_token_spent;
                break;
            }
        }

        require!(amount_usdc <= wallet.per_tx_limit, WalletError::PerTxLimitExceeded);
        let new_spent = wallet.spent_today.checked_add(amount_usdc).ok_or(WalletError::Overflow)?;
        require!(new_spent <= wallet.daily_limit, WalletError::DailyLimitExceeded);

        wallet.spent_today = new_spent;
        let wallet_key = wallet.key();
        let recipient_key = ctx.accounts.recipient_token_account.key();

        let owner_key = wallet.owner;
        let agent_key = wallet.agent;
        let index_bytes = wallet.index.to_le_bytes();
        let bump = wallet.bump;

        let seeds: &[&[u8]] = &[
            WALLET_SEED,
            owner_key.as_ref(),
            agent_key.as_ref(),
            &index_bytes,
            &[bump],
        ];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SplTransfer {
                    from: ctx.accounts.wallet_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.wallet.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(TransferExecuted {
            wallet: wallet_key,
            recipient: recipient_key,
            amount_lamports: amount,
            amount_usdc,
            token: Some(mint),
        });

        Ok(())
    }

    // ─── Owner Actions (Ed25519 signer) ───

    pub fn set_policy(ctx: Context<OwnerAction>, daily_limit: u64, per_tx_limit: u64) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        require!(per_tx_limit <= daily_limit, WalletError::InvalidLimits);

        wallet.daily_limit = daily_limit;
        wallet.per_tx_limit = per_tx_limit;

        emit!(PolicyUpdated {
            wallet: wallet.key(),
            daily_limit,
            per_tx_limit,
        });
        Ok(())
    }

    pub fn set_token_limit(ctx: Context<OwnerAction>, mint: Pubkey, daily_limit: u64, per_tx_limit: u64) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        require!(per_tx_limit <= daily_limit, WalletError::InvalidLimits);

        for tl in wallet.token_limits.iter_mut() {
            if tl.mint == mint {
                tl.daily_limit = daily_limit;
                tl.per_tx_limit = per_tx_limit;
                return Ok(());
            }
        }
        require!(wallet.token_limits.len() < MAX_TOKEN_LIMITS, WalletError::MaxTokenLimitsReached);
        wallet.token_limits.push(TokenLimit { mint, daily_limit, per_tx_limit, spent_today: 0, last_reset_day: 0 });
        Ok(())
    }

    pub fn remove_token_limit(ctx: Context<OwnerAction>, mint: Pubkey) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        let idx = wallet.token_limits.iter().position(|tl| tl.mint == mint).ok_or(WalletError::TokenLimitNotFound)?;
        wallet.token_limits.remove(idx);
        Ok(())
    }

    pub fn pause(ctx: Context<OwnerAction>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        wallet.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerAction>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        wallet.paused = false;
        Ok(())
    }

    pub fn transfer_ownership(ctx: Context<OwnerAction>, new_owner: Pubkey) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);
        wallet.owner = new_owner;
        Ok(())
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>) -> Result<()> {
        let wallet = &ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);

        let rent = Rent::get()?.minimum_balance(Wallet::SIZE);
        let balance = wallet.to_account_info().lamports();
        let withdrawable = balance.saturating_sub(rent);

        if withdrawable > 0 {
            wallet.sub_lamports(withdrawable)?;
            ctx.accounts.recipient.add_lamports(withdrawable)?;
        }
        Ok(())
    }

    pub fn withdraw_token(ctx: Context<WithdrawToken>) -> Result<()> {
        let wallet = &ctx.accounts.wallet;
        require!(ctx.accounts.owner.key() == wallet.owner, WalletError::Unauthorized);

        let amount = ctx.accounts.wallet_token_account.amount;
        if amount == 0 { return Ok(()); }

        let owner_key = wallet.owner;
        let agent_key = wallet.agent;
        let index_bytes = wallet.index.to_le_bytes();
        let bump = wallet.bump;

        let seeds: &[&[u8]] = &[WALLET_SEED, owner_key.as_ref(), agent_key.as_ref(), &index_bytes, &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SplTransfer {
                    from: ctx.accounts.wallet_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.wallet.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    // ─── Passkey-Authenticated Owner Actions ───
    // These verify a secp256r1 signature in a preceding instruction.
    // The signed message must contain the wallet address + action data.
    // This allows FaceID/fingerprint/hardware key to control the wallet.

    pub fn set_policy_with_passkey(
        ctx: Context<PasskeyAction>,
        daily_limit: u64,
        per_tx_limit: u64,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(wallet.passkey_registered, WalletError::PasskeyNotRegistered);
        require!(per_tx_limit <= daily_limit, WalletError::InvalidLimits);

        // Verify secp256r1 signature in preceding instruction
        verify_passkey_signature(&ctx.accounts.instructions_sysvar, &wallet.passkey_pubkey)?;

        wallet.daily_limit = daily_limit;
        wallet.per_tx_limit = per_tx_limit;

        emit!(PolicyUpdated {
            wallet: wallet.key(),
            daily_limit,
            per_tx_limit,
        });
        Ok(())
    }

    pub fn set_token_limit_with_passkey(
        ctx: Context<PasskeyAction>,
        mint: Pubkey,
        daily_limit: u64,
        per_tx_limit: u64,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(wallet.passkey_registered, WalletError::PasskeyNotRegistered);
        require!(per_tx_limit <= daily_limit, WalletError::InvalidLimits);
        verify_passkey_signature(&ctx.accounts.instructions_sysvar, &wallet.passkey_pubkey)?;

        for tl in wallet.token_limits.iter_mut() {
            if tl.mint == mint {
                tl.daily_limit = daily_limit;
                tl.per_tx_limit = per_tx_limit;
                return Ok(());
            }
        }
        require!(wallet.token_limits.len() < MAX_TOKEN_LIMITS, WalletError::MaxTokenLimitsReached);
        wallet.token_limits.push(TokenLimit { mint, daily_limit, per_tx_limit, spent_today: 0, last_reset_day: 0 });
        Ok(())
    }

    pub fn pause_with_passkey(ctx: Context<PasskeyAction>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(wallet.passkey_registered, WalletError::PasskeyNotRegistered);
        verify_passkey_signature(&ctx.accounts.instructions_sysvar, &wallet.passkey_pubkey)?;
        wallet.paused = true;
        Ok(())
    }

    pub fn unpause_with_passkey(ctx: Context<PasskeyAction>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(wallet.passkey_registered, WalletError::PasskeyNotRegistered);
        verify_passkey_signature(&ctx.accounts.instructions_sysvar, &wallet.passkey_pubkey)?;
        wallet.paused = false;
        Ok(())
    }

    pub fn transfer_ownership_with_passkey(ctx: Context<PasskeyAction>, new_owner: Pubkey) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        require!(wallet.passkey_registered, WalletError::PasskeyNotRegistered);
        verify_passkey_signature(&ctx.accounts.instructions_sysvar, &wallet.passkey_pubkey)?;
        wallet.owner = new_owner;
        Ok(())
    }
}

// ─── Helpers ───

fn reset_daily_if_needed(wallet: &mut Wallet) -> Result<()> {
    let clock = Clock::get()?;
    let today = (clock.unix_timestamp as u64) / 86400;
    if today > wallet.last_reset_day {
        wallet.spent_today = 0;
        wallet.last_reset_day = today;
    }
    Ok(())
}

/// Verify that a preceding instruction in the transaction is a secp256r1
/// signature verification matching the wallet's registered passkey.
/// The secp256r1 precompile instruction format:
///   - Byte 0: num_signatures (u8)
///   - For each signature:
///     - Bytes: signature_offset (u16), signature_ix_idx (u8),
///              pubkey_offset (u16), pubkey_ix_idx (u8),
///              message_offset (u16), message_size (u16), message_ix_idx (u8)
///   - Then the actual signature (64 bytes), pubkey (33 bytes compressed or 64 uncompressed), message
fn verify_passkey_signature(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &[u8; 64],
) -> Result<()> {
    let current_idx = ix_sysvar::load_current_index_checked(instructions_sysvar)
        .map_err(|_| WalletError::MissingSecp256r1Ix)?;

    // Look for a secp256r1 verify instruction before the current one
    let secp_program_id = Pubkey::new_from_array(SECP256R1_PROGRAM_ID);

    for idx in 0..current_idx {
        let ix = ix_sysvar::load_instruction_at_checked(idx as usize, instructions_sysvar)
            .map_err(|_| WalletError::MissingSecp256r1Ix)?;

        if ix.program_id == secp_program_id {
            // Found a secp256r1 verification instruction.
            // The precompile will have already verified the signature if
            // the transaction succeeded. We just need to verify the pubkey
            // in the instruction data matches our stored passkey.
            //
            // Instruction data layout (for 1 signature):
            //   [0]: num_signatures = 1
            //   [1..3]: signature_offset (u16 LE)
            //   [3]: signature_ix_idx
            //   [4..6]: pubkey_offset (u16 LE)
            //   [6]: pubkey_ix_idx
            //   [7..9]: message_offset (u16 LE)
            //   [9..11]: message_size (u16 LE)
            //   [11]: message_ix_idx
            //   Then: signature (64 bytes), pubkey (64 bytes uncompressed), message
            let data = &ix.data;
            if data.len() < 12 { continue; }
            if data[0] != 1 { continue; } // expect exactly 1 signature

            let pubkey_offset = u16::from_le_bytes([data[4], data[5]]) as usize;

            // Extract the pubkey from instruction data
            if data.len() < pubkey_offset + 64 { continue; }
            let ix_pubkey = &data[pubkey_offset..pubkey_offset + 64];

            // Compare with stored passkey
            if ix_pubkey == expected_pubkey {
                return Ok(());
            }
        }
    }

    Err(WalletError::MissingSecp256r1Ix.into())
}

// ─── Accounts ───

#[derive(Accounts)]
pub struct InitializeFactory<'info> {
    #[account(init, payer = admin, space = Factory::SIZE, seeds = [FACTORY_SEED], bump)]
    pub factory: Account<'info, Factory>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateWallet<'info> {
    #[account(mut, seeds = [FACTORY_SEED], bump = factory.bump)]
    pub factory: Account<'info, Factory>,
    #[account(
        init,
        payer = payer,
        space = Wallet::SIZE,
        seeds = [WALLET_SEED, owner.key().as_ref(), agent.key().as_ref(), &factory.total_wallets.to_le_bytes()],
        bump,
    )]
    pub wallet: Account<'info, Wallet>,
    /// CHECK: Owner pubkey
    pub owner: UncheckedAccount<'info>,
    /// CHECK: Agent pubkey
    pub agent: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferSol<'info> {
    #[account(mut)]
    pub wallet: Account<'info, Wallet>,
    pub agent: Signer<'info>,
    /// CHECK: Recipient receives SOL
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TransferToken<'info> {
    #[account(mut)]
    pub wallet: Account<'info, Wallet>,
    pub agent: Signer<'info>,
    /// CHECK: Token mint
    pub mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub wallet_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(mut)]
    pub wallet: Account<'info, Wallet>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct PasskeyAction<'info> {
    #[account(mut)]
    pub wallet: Account<'info, Wallet>,
    /// CHECK: Payer for tx fees, anyone can relay
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Instructions sysvar for introspecting secp256r1 verify ix
    #[account(address = ix_sysvar::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub wallet: Account<'info, Wallet>,
    pub owner: Signer<'info>,
    /// CHECK: Recipient
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WithdrawToken<'info> {
    #[account(mut)]
    pub wallet: Account<'info, Wallet>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub wallet_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ─── Events ───

#[event]
pub struct WalletCreated {
    pub wallet: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub index: u64,
}

#[event]
pub struct TransferExecuted {
    pub wallet: Pubkey,
    pub recipient: Pubkey,
    pub amount_lamports: u64,
    pub amount_usdc: u64,
    pub token: Option<Pubkey>,
}

#[event]
pub struct PolicyUpdated {
    pub wallet: Pubkey,
    pub daily_limit: u64,
    pub per_tx_limit: u64,
}
