use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::error::WalletError;
use crate::instruction::WalletInstruction;
use crate::state::{PendingTx, WalletState};

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = WalletInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match instruction {
        WalletInstruction::Initialize { owner, agent } => {
            process_initialize(program_id, accounts, owner, agent)
        }
        WalletInstruction::Transfer { amount } => {
            process_transfer(program_id, accounts, amount)
        }
        WalletInstruction::SetPolicy {
            daily_limit,
            per_tx_limit,
            approval_threshold,
        } => process_set_policy(accounts, daily_limit, per_tx_limit, approval_threshold),
        WalletInstruction::SetAgentKey { new_agent } => {
            process_set_agent_key(accounts, new_agent)
        }
        WalletInstruction::RevokeAgent => process_revoke_agent(accounts),
        WalletInstruction::ApproveTx => process_approve_tx(program_id, accounts),
        WalletInstruction::CancelTx => process_cancel_tx(accounts),
        WalletInstruction::Pause => process_pause(accounts),
        WalletInstruction::Unpause => process_unpause(accounts),
        WalletInstruction::EmergencyWithdraw { amount } => {
            process_emergency_withdraw(program_id, accounts, amount)
        }
    }
}

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    owner: Pubkey,
    agent: Pubkey,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;

    // Derive PDA
    let (pda, bump) = Pubkey::find_program_address(
        &[WalletState::SEED, owner.as_ref(), agent.as_ref()],
        program_id,
    );
    if pda != *wallet_info.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check not already initialized
    if !wallet_info.data_is_empty() {
        return Err(WalletError::AlreadyInitialized.into());
    }

    // Create account
    let space = 8 + WalletState::LEN; // 8 byte discriminator + state
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            wallet_info.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[payer.clone(), wallet_info.clone(), system_program.clone()],
        &[&[WalletState::SEED, owner.as_ref(), agent.as_ref(), &[bump]]],
    )?;

    let clock = Clock::get()?;
    let state = WalletState {
        owner,
        agent,
        daily_limit: WalletState::DEFAULT_DAILY_LIMIT,
        per_tx_limit: WalletState::DEFAULT_PER_TX_LIMIT,
        approval_threshold: WalletState::DEFAULT_APPROVAL_THRESHOLD,
        spent_today: 0,
        day_start: clock.unix_timestamp,
        paused: false,
        bump,
        pending_count: 0,
    };

    // Write discriminator + state
    let mut data = wallet_info.try_borrow_mut_data()?;
    data[..8].copy_from_slice(b"agtwalet");
    state.serialize(&mut &mut data[8..])?;

    msg!("AgentWallet initialized: owner={}, agent={}", owner, agent);
    Ok(())
}

fn load_wallet(wallet_info: &AccountInfo) -> Result<WalletState, ProgramError> {
    let data = wallet_info.try_borrow_data()?;
    if data.len() < 8 + WalletState::LEN || &data[..8] != b"agtwalet" {
        return Err(ProgramError::InvalidAccountData);
    }
    WalletState::try_from_slice(&data[8..8 + WalletState::LEN])
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_wallet(wallet_info: &AccountInfo, state: &WalletState) -> ProgramResult {
    let mut data = wallet_info.try_borrow_mut_data()?;
    state.serialize(&mut &mut data[8..])?;
    Ok(())
}

fn require_owner(state: &WalletState, signer: &Pubkey) -> ProgramResult {
    if *signer != state.owner {
        return Err(WalletError::NotOwner.into());
    }
    Ok(())
}

fn require_agent(state: &WalletState, signer: &Pubkey) -> ProgramResult {
    if *signer != state.agent {
        return Err(WalletError::NotAgent.into());
    }
    Ok(())
}

fn process_transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;
    let token_source = next_account_info(iter)?;
    let token_dest = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    let mut state = load_wallet(wallet_info)?;

    if !signer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_agent(&state, signer.key)?;

    if state.paused {
        return Err(WalletError::Paused.into());
    }
    if amount > state.per_tx_limit {
        return Err(WalletError::ExceedsPerTxLimit.into());
    }

    // Reset daily counter if new day
    let clock = Clock::get()?;
    if clock.unix_timestamp >= state.day_start + WalletState::DAY_SECONDS {
        state.day_start = clock.unix_timestamp;
        state.spent_today = 0;
    }

    if state.spent_today + amount > state.daily_limit {
        return Err(WalletError::ExceedsDailyLimit.into());
    }

    // Above approval threshold → queue
    if amount > state.approval_threshold {
        let pending_info = next_account_info(iter)?;
        let system_program = next_account_info(iter)?;

        let tx_index = state.pending_count;
        let (pending_pda, pending_bump) = Pubkey::find_program_address(
            &[
                PendingTx::SEED,
                wallet_info.key.as_ref(),
                &tx_index.to_le_bytes(),
            ],
            program_id,
        );
        if pending_pda != *pending_info.key {
            return Err(ProgramError::InvalidSeeds);
        }

        let space = 8 + PendingTx::LEN;
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                signer.key,
                pending_info.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[signer.clone(), pending_info.clone(), system_program.clone()],
            &[&[
                PendingTx::SEED,
                wallet_info.key.as_ref(),
                &tx_index.to_le_bytes(),
                &[pending_bump],
            ]],
        )?;

        let ptx = PendingTx {
            to: *token_dest.key,
            amount,
            created_at: clock.unix_timestamp,
            executed: false,
            cancelled: false,
            wallet: *wallet_info.key,
        };

        let mut pdata = pending_info.try_borrow_mut_data()?;
        pdata[..8].copy_from_slice(b"pendgtx_");
        ptx.serialize(&mut &mut pdata[8..])?;

        state.pending_count += 1;
        save_wallet(wallet_info, &state)?;

        msg!("Transaction queued (index {}): {} USDC to {}", tx_index, amount, token_dest.key);
        return Ok(());
    }

    // Within limits → execute immediately via PDA signing
    let seeds = &[
        WalletState::SEED,
        state.owner.as_ref(),
        state.agent.as_ref(),
        &[state.bump],
    ];

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            token_source.key,
            token_dest.key,
            wallet_info.key,
            &[],
            amount,
        )?,
        &[token_source.clone(), token_dest.clone(), wallet_info.clone()],
        &[seeds],
    )?;

    state.spent_today += amount;
    save_wallet(wallet_info, &state)?;

    msg!("Transfer executed: {} USDC to {}", amount, token_dest.key);
    Ok(())
}

fn process_set_policy(
    accounts: &[AccountInfo],
    daily_limit: u64,
    per_tx_limit: u64,
    approval_threshold: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;

    let mut state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;

    if daily_limit > 0 { state.daily_limit = daily_limit; }
    if per_tx_limit > 0 { state.per_tx_limit = per_tx_limit; }
    if approval_threshold > 0 { state.approval_threshold = approval_threshold; }

    save_wallet(wallet_info, &state)?;
    msg!("Policy updated: daily={}, per_tx={}, threshold={}", state.daily_limit, state.per_tx_limit, state.approval_threshold);
    Ok(())
}

fn process_set_agent_key(accounts: &[AccountInfo], new_agent: Pubkey) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;

    let mut state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;
    state.agent = new_agent;
    save_wallet(wallet_info, &state)?;
    msg!("Agent key updated to {}", new_agent);
    Ok(())
}

fn process_revoke_agent(accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;

    let mut state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;
    state.agent = Pubkey::default();
    save_wallet(wallet_info, &state)?;
    msg!("Agent key revoked");
    Ok(())
}

fn process_approve_tx(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;
    let pending_info = next_account_info(iter)?;
    let token_source = next_account_info(iter)?;
    let token_dest = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    let state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;

    let pdata = pending_info.try_borrow_data()?;
    if &pdata[..8] != b"pendgtx_" {
        return Err(WalletError::InvalidPendingTx.into());
    }
    let mut ptx = PendingTx::try_from_slice(&pdata[8..8 + PendingTx::LEN])
        .map_err(|_| WalletError::InvalidPendingTx)?;
    drop(pdata);

    if ptx.executed || ptx.cancelled {
        return Err(WalletError::TxAlreadyFinalized.into());
    }

    let clock = Clock::get()?;
    if clock.unix_timestamp > ptx.created_at + PendingTx::EXPIRY_SECONDS {
        return Err(WalletError::TxExpired.into());
    }

    // Execute the transfer
    let seeds = &[
        WalletState::SEED,
        state.owner.as_ref(),
        state.agent.as_ref(),
        &[state.bump],
    ];

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            token_source.key,
            token_dest.key,
            wallet_info.key,
            &[],
            ptx.amount,
        )?,
        &[token_source.clone(), token_dest.clone(), wallet_info.clone()],
        &[seeds],
    )?;

    ptx.executed = true;
    let mut pdata = pending_info.try_borrow_mut_data()?;
    ptx.serialize(&mut &mut pdata[8..])?;

    msg!("Pending tx approved and executed: {} USDC", ptx.amount);
    Ok(())
}

fn process_cancel_tx(accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;
    let pending_info = next_account_info(iter)?;

    let state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;

    let pdata = pending_info.try_borrow_data()?;
    if &pdata[..8] != b"pendgtx_" {
        return Err(WalletError::InvalidPendingTx.into());
    }
    let mut ptx = PendingTx::try_from_slice(&pdata[8..8 + PendingTx::LEN])
        .map_err(|_| WalletError::InvalidPendingTx)?;
    drop(pdata);

    if ptx.executed || ptx.cancelled {
        return Err(WalletError::TxAlreadyFinalized.into());
    }

    ptx.cancelled = true;
    let mut pdata = pending_info.try_borrow_mut_data()?;
    ptx.serialize(&mut &mut pdata[8..])?;

    msg!("Pending tx cancelled");
    Ok(())
}

fn process_pause(accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;

    let mut state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;
    state.paused = true;
    save_wallet(wallet_info, &state)?;
    msg!("Wallet paused");
    Ok(())
}

fn process_unpause(accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;

    let mut state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;
    state.paused = false;
    save_wallet(wallet_info, &state)?;
    msg!("Wallet unpaused");
    Ok(())
}

fn process_emergency_withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let signer = next_account_info(iter)?;
    let wallet_info = next_account_info(iter)?;
    let token_source = next_account_info(iter)?;
    let token_dest = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;

    let state = load_wallet(wallet_info)?;
    require_owner(&state, signer.key)?;

    let seeds = &[
        WalletState::SEED,
        state.owner.as_ref(),
        state.agent.as_ref(),
        &[state.bump],
    ];

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            token_source.key,
            token_dest.key,
            wallet_info.key,
            &[],
            amount,
        )?,
        &[token_source.clone(), token_dest.clone(), wallet_info.clone()],
        &[seeds],
    )?;

    msg!("Emergency withdrawal: {} tokens", amount);
    Ok(())
}
