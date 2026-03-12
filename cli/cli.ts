#!/usr/bin/env node

import { AgentWallet } from './sdk.js'

// ─── Colors (no deps) ───
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  orange: '\x1b[38;5;208m',
}

const VERSION = '1.2.0'

// ─── Parse args ───
function parse(argv: string[]) {
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []
  let command = ''

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (!command && !arg.startsWith('-')) {
      command = arg
    } else if (arg === '-h' || arg === '--help') {
      flags.help = true
    } else if (arg === '-v' || arg === '--version') {
      flags.version = true
    } else if (arg === '--json') {
      flags.json = true
    } else if (arg === '--unmanaged') {
      flags.unmanaged = true
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg)
    }
  }

  return { command, positional, flags }
}

// ─── Output helpers ───
function header(text: string) {
  console.log(`\n${c.orange}${c.bold}${text}${c.reset}`)
  console.log(`${c.gray}${'─'.repeat(text.length + 4)}${c.reset}`)
}

function row(label: string, value: string, color = c.white) {
  console.log(`  ${c.gray}${label.padEnd(16)}${c.reset}${color}${value}${c.reset}`)
}

function success(text: string) {
  console.log(`\n  ${c.green}✓${c.reset} ${text}`)
}

function error(text: string) {
  console.error(`\n  ${c.red}✗${c.reset} ${text}\n`)
  process.exit(1)
}

function link(url: string) {
  console.log(`\n  ${c.cyan}${url}${c.reset}`)
  console.log(`  ${c.gray}Send this link to your human${c.reset}\n`)
}

// ─── Help ───
function help() {
  console.log(`
${c.orange}${c.bold}agentwallet${c.reset} ${c.dim}v${VERSION}${c.reset}
Non-custodial smart wallets for AI agents on Base and Solana

${c.bold}Commands${c.reset}
  ${c.cyan}create${c.reset}              Create a new wallet
  ${c.cyan}status${c.reset} ${c.dim}<wallet>${c.reset}     Check wallet info & balances
  ${c.cyan}limits${c.reset} ${c.dim}<wallet>${c.reset}     Request a limit increase
  ${c.cyan}token-limit${c.reset} ${c.dim}<wallet>${c.reset} Set a per-token spending limit
  ${c.cyan}rm-token${c.reset} ${c.dim}<wallet>${c.reset}   Remove a token limit
  ${c.cyan}pause${c.reset} ${c.dim}<wallet>${c.reset}      Request emergency pause
  ${c.cyan}unpause${c.reset} ${c.dim}<wallet>${c.reset}    Request unpause
  ${c.cyan}execute${c.reset}             Execute arbitrary contract call / CPI
  ${c.cyan}keygen${c.reset}              Generate a new agent keypair
  ${c.cyan}stats${c.reset}               Total wallets deployed

${c.bold}Options${c.reset}
  ${c.yellow}--agent${c.reset} ${c.dim}<addr>${c.reset}      Agent's Base (EVM) public address
  ${c.yellow}--agent-sol${c.reset} ${c.dim}<addr>${c.reset}  Agent's Solana public address
  ${c.yellow}--chain${c.reset} ${c.dim}<chain>${c.reset}     Chain: base, solana, or both (default: both)
  ${c.yellow}--daily${c.reset} ${c.dim}<usd>${c.reset}       Daily limit in USD
  ${c.yellow}--pertx${c.reset} ${c.dim}<usd>${c.reset}       Per-transaction limit in USD
  ${c.yellow}--token${c.reset} ${c.dim}<addr>${c.reset}      Token contract address
  ${c.yellow}--token-daily${c.reset} ${c.dim}<n>${c.reset}   Token daily limit
  ${c.yellow}--token-pertx${c.reset} ${c.dim}<n>${c.reset}   Token per-tx limit
  ${c.yellow}--decimals${c.reset} ${c.dim}<n>${c.reset}      Token decimals (default: 18)
  ${c.yellow}--reason${c.reset} ${c.dim}<text>${c.reset}     Reason for the request
  ${c.yellow}--unmanaged${c.reset}         Create without human owner
  ${c.yellow}--url${c.reset} ${c.dim}<url>${c.reset}         API base URL
  ${c.yellow}--json${c.reset}             Output raw JSON
  ${c.yellow}--version${c.reset}          Show version
  ${c.yellow}--help${c.reset}             Show this help

${c.bold}Examples${c.reset}
  ${c.dim}# Generate keypairs for both chains${c.reset}
  ${c.green}$${c.reset} agentwallet keygen

  ${c.dim}# Create wallets on both chains (recommended)${c.reset}
  ${c.green}$${c.reset} agentwallet create --agent 0xEvmAddress --agent-sol SolanaAddress

  ${c.dim}# Create on a single chain${c.reset}
  ${c.green}$${c.reset} agentwallet create --chain base --agent 0xEvmAddress
  ${c.green}$${c.reset} agentwallet create --chain solana --agent SolanaPubkey

  ${c.dim}# Check your wallet (auto-detects chain)${c.reset}
  ${c.green}$${c.reset} agentwallet status 0xBaseWallet...
  ${c.green}$${c.reset} agentwallet status SolanaWallet...

  ${c.dim}# Need higher limits? Ask your human${c.reset}
  ${c.green}$${c.reset} agentwallet limits 0xWallet... --daily 200 --pertx 100

${c.bold}Environment${c.reset}
  ${c.yellow}AGENTWALLET_URL${c.reset}        API endpoint (default: https://agntos.dev/wallet)
  ${c.yellow}AGENTWALLET_AGENT${c.reset}      Default Base agent address
  ${c.yellow}AGENTWALLET_AGENT_SOL${c.reset}  Default Solana agent address

${c.dim}Docs: https://github.com/0xArtex/agentwallet-aos${c.reset}
${c.dim}npm:  https://www.npmjs.com/package/@agntos/agentwallet${c.reset}
`)
}

// ─── Commands ───

function printWallet(data: any, chainLabel: string) {
  const w = data.wallet
  const gasUnit = w.chain === 'solana' ? 'SOL' : 'ETH'
  const gasDivisor = w.chain === 'solana' ? 1e9 : 1e18
  console.log(`\n  ${c.cyan}${chainLabel}${c.reset}`)
  row('Address', w.address, c.bold + c.white)
  row('Agent', w.agent)
  row('Mode', data.mode, data.mode === 'managed' ? c.yellow : c.green)
  row('Daily limit', `$${Number(w.policy.dailyLimit) / 1e6}`)
  row('Per-tx limit', `$${Number(w.policy.perTxLimit) / 1e6}`)
  row('Gas funded', `${Number(w.gasBalance) / gasDivisor} ${gasUnit}`, c.green)
  if (data.setupUrl) {
    console.log(`  ${c.gray}Setup URL${c.reset}       ${c.cyan}${data.setupUrl}${c.reset}`)
  }
}

async function cmdCreate(aw: AgentWallet, flags: Record<string, string | boolean>) {
  const chain = flags.chain as string | undefined
  const agentBase = (flags.agent as string) || process.env.AGENTWALLET_AGENT || ''
  const agentSol = (flags['agent-sol'] as string) || process.env.AGENTWALLET_AGENT_SOL || ''

  // Single chain mode
  if (chain === 'base' || chain === 'solana') {
    const agent = chain === 'solana' ? (agentSol || agentBase) : agentBase
    if (!agent) {
      error(`--agent <address> is required\n\n  Generate keypairs: agentwallet keygen --chain ${chain}`)
    }
    const data = flags.unmanaged ? await aw.createUnmanaged(agent, chain) : await aw.create(agent, chain)
    if (flags.json) return console.log(JSON.stringify(data, null, 2))
    header(flags.unmanaged ? 'Wallet created (unmanaged)' : 'Wallet created')
    printWallet(data, chain === 'solana' ? 'SOLANA' : 'BASE (EVM)')
    console.log()
    return
  }

  // Default: create BOTH wallets
  if (!agentBase && !agentSol) {
    console.error(`
  ${c.red}✗${c.reset} Agent addresses required

  ${c.dim}Provide both chain addresses:${c.reset}
  ${c.green}$${c.reset} agentwallet create --agent 0xEvmAddress --agent-sol SolanaAddress

  ${c.dim}Or create for a single chain:${c.reset}
  ${c.green}$${c.reset} agentwallet create --chain base --agent 0xEvmAddress
  ${c.green}$${c.reset} agentwallet create --chain solana --agent SolanaAddress

  ${c.dim}Generate keypairs for both chains:${c.reset}
  ${c.green}$${c.reset} agentwallet keygen
`)
    process.exit(1)
  }

  const results: any = {}
  const errors: string[] = []

  if (agentBase) {
    try {
      results.base = flags.unmanaged ? await aw.createUnmanaged(agentBase, 'base') : await aw.create(agentBase, 'base')
    } catch (e: any) { errors.push(`Base: ${e.message}`) }
  }
  if (agentSol) {
    try {
      results.solana = flags.unmanaged ? await aw.createUnmanaged(agentSol, 'solana') : await aw.create(agentSol, 'solana')
    } catch (e: any) { errors.push(`Solana: ${e.message}`) }
  }

  if (!results.base && !results.solana) error(errors.join('\n'))

  if (flags.json) return console.log(JSON.stringify(results, null, 2))

  header(flags.unmanaged ? 'Wallets created (unmanaged)' : 'Wallets created')
  if (results.base) printWallet(results.base, 'BASE (EVM)')
  if (results.solana) printWallet(results.solana, 'SOLANA')
  if (errors.length) { console.log(); errors.forEach(e => console.log(`  ${c.red}✗${c.reset} ${e}`)) }

  console.log(`\n  ${c.dim}Send the setup URLs to your human to register passkeys.${c.reset}\n`)
}

async function cmdStatus(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  if (!positional[0]) error('Wallet address required: agentwallet status <address>')
  const data = await aw.status(positional[0])

  if (flags.json) return console.log(JSON.stringify(data, null, 2))

  const w = data.wallet
  const isPasskey = w.owner === '0x0000000000000000000000000000000000000000'
  const pct = Number(w.policy.dailyLimit) > 0
    ? Math.round((Number(w.spentToday) / Number(w.policy.dailyLimit)) * 100)
    : 0
  const remaining = Number(w.remainingDaily) / 1e6
  const spent = Number(w.spentToday) / 1e6
  const daily = Number(w.policy.dailyLimit) / 1e6

  header('Wallet')
  row('Address', w.address, c.bold + c.white)
  row('Owner', isPasskey ? 'Passkey (FaceID/YubiKey)' : w.owner, isPasskey ? c.green : c.white)
  row('Agent', w.agent)
  row('Chain', w.chain)
  row('Paused', w.policy.paused ? 'YES' : 'No', w.policy.paused ? c.red : c.green)
  console.log()

  // Spending bar
  const barWidth = 30
  const filled = Math.round((pct / 100) * barWidth)
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
  const barColor = pct > 90 ? c.red : pct > 70 ? c.yellow : c.green
  console.log(`  ${c.gray}Spending${c.reset}        ${barColor}${bar}${c.reset} ${c.dim}${pct}%${c.reset}`)
  row('Spent today', `$${spent} / $${daily}`, spent > 0 ? c.yellow : c.green)
  row('Remaining', `$${remaining}`, remaining < daily * 0.1 ? c.red : c.green)
  row('Per-tx limit', `$${Number(w.policy.perTxLimit) / 1e6}`)
  const gasUnit = w.chain === 'solana' ? 'SOL' : 'ETH'
  const gasDivisor = w.chain === 'solana' ? 1e9 : 1e18
  row('Gas balance', `${Number(w.gasBalance) / gasDivisor} ${gasUnit}`, Number(w.gasBalance) < 5000000000000 ? c.yellow : c.green)
  console.log()
}

async function cmdLimits(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  if (!positional[0]) error('Wallet address required: agentwallet limits <address> --daily 200 --pertx 100')
  if (!flags.daily && !flags.pertx) error('--daily and/or --pertx required')

  const data = await aw.requestLimitIncrease(positional[0], {
    dailyLimit: flags.daily ? Number(flags.daily) : undefined,
    perTxLimit: flags.pertx ? Number(flags.pertx) : undefined,
    reason: flags.reason as string | undefined,
  })

  if (flags.json) return console.log(JSON.stringify(data, null, 2))

  success('Approval request created')
  link(data.approvalUrl)
}

async function cmdTokenLimit(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  if (!positional[0]) error('Wallet address required')
  if (!flags.token) error('--token <address> required')
  if (!flags['token-daily'] || !flags['token-pertx']) error('--token-daily and --token-pertx required')

  const data = await aw.requestTokenLimit(positional[0], {
    token: flags.token as string,
    dailyLimit: Number(flags['token-daily']),
    perTxLimit: Number(flags['token-pertx']),
    decimals: flags.decimals ? Number(flags.decimals) : 18,
    reason: flags.reason as string | undefined,
  })

  if (flags.json) return console.log(JSON.stringify(data, null, 2))

  success('Token limit request created')
  link(data.approvalUrl)
}

async function cmdRmToken(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  if (!positional[0]) error('Wallet address required')
  if (!flags.token) error('--token <address> required')

  const data = await aw.requestRemoveTokenLimit(positional[0], {
    token: flags.token as string,
    reason: flags.reason as string | undefined,
  })

  if (flags.json) return console.log(JSON.stringify(data, null, 2))

  success('Token limit removal request created')
  link(data.approvalUrl)
}

async function cmdPause(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  if (!positional[0]) error('Wallet address required')
  const data = await aw.requestPause(positional[0], flags.reason as string | undefined)
  if (flags.json) return console.log(JSON.stringify(data, null, 2))
  success('Pause request created')
  link(data.approvalUrl)
}

async function cmdUnpause(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  if (!positional[0]) error('Wallet address required')
  const data = await aw.requestUnpause(positional[0], flags.reason as string | undefined)
  if (flags.json) return console.log(JSON.stringify(data, null, 2))
  success('Unpause request created')
  link(data.approvalUrl)
}

async function genEvmKey() {
  const cryptoMod = await import('crypto')
  const privBytes = cryptoMod.randomBytes(32)
  const privKey = '0x' + privBytes.toString('hex')
  const ecdh = cryptoMod.createECDH('secp256k1')
  ecdh.setPrivateKey(privBytes)
  const pubBytes = ecdh.getPublicKey().subarray(1)
  const hash = keccak256(pubBytes)
  const address = '0x' + toChecksumAddress(hash.subarray(12))
  return { address, privateKey: privKey, chain: 'base' as const }
}

async function genSolKey() {
  const cryptoMod = await import('crypto')
  const { publicKey: pubKeyObj, privateKey: privKeyObj } = cryptoMod.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  })
  const pubBytes = (pubKeyObj as Buffer).subarray(-32)
  const privBytes = (privKeyObj as Buffer).subarray(-32)
  const fullSecret = Buffer.concat([privBytes, pubBytes])
  return { address: base58Encode(pubBytes), privateKey: base58Encode(fullSecret), chain: 'solana' as const }
}

async function cmdKeygen(flags: Record<string, string | boolean>) {
  const chain = flags.chain as string | undefined

  if (chain === 'base') {
    const k = await genEvmKey()
    if (flags.json) { console.log(JSON.stringify(k)); return }
    header('New Base Agent Keypair')
    row('Address', k.address, c.bold + c.white)
    row('Private key', k.privateKey, c.yellow)
    row('Chain', 'base', c.cyan)
    console.log(`\n  ${c.dim}Create a wallet:${c.reset}\n  ${c.green}$${c.reset} agentwallet create --chain base --agent ${k.address}\n`)
    return
  }

  if (chain === 'solana') {
    const k = await genSolKey()
    if (flags.json) { console.log(JSON.stringify(k)); return }
    header('New Solana Agent Keypair')
    row('Address', k.address, c.bold + c.white)
    row('Private key', k.privateKey, c.yellow)
    row('Chain', 'solana', c.cyan)
    console.log(`\n  ${c.dim}Create a wallet:${c.reset}\n  ${c.green}$${c.reset} agentwallet create --chain solana --agent ${k.address}\n`)
    return
  }

  // Default: generate BOTH keypairs
  const base = await genEvmKey()
  const sol = await genSolKey()

  if (flags.json) { console.log(JSON.stringify({ base, solana: sol })); return }

  header('New Agent Keypairs')
  console.log()
  console.log(`  ${c.cyan}BASE (EVM)${c.reset}`)
  row('Address', base.address, c.bold + c.white)
  row('Private key', base.privateKey, c.yellow)
  console.log()
  console.log(`  ${c.cyan}SOLANA${c.reset}`)
  row('Address', sol.address, c.bold + c.white)
  row('Private key', sol.privateKey, c.yellow)
  console.log()
  console.log(`  ${c.dim}Save both private keys securely. Never share them.${c.reset}`)
  console.log()
  console.log(`  ${c.dim}Create wallets on both chains:${c.reset}`)
  console.log(`  ${c.green}$${c.reset} agentwallet create --agent ${base.address} --agent-sol ${sol.address}`)
  console.log()
}

// Minimal base58 encoder
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits: number[] = [0]
  for (const byte of bytes) {
    for (let i = 0; i < digits.length; i++) digits[i] *= 256
    digits[0] += byte
    let carry = 0
    for (let i = 0; i < digits.length; i++) {
      digits[i] += carry
      carry = (digits[i] / 58) | 0
      digits[i] %= 58
    }
    while (carry) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let str = ''
  for (const byte of bytes) {
    if (byte !== 0) break
    str += '1'
  }
  for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]]
  return str
}

function toChecksumAddress(addrBytes: Uint8Array): string {
  const hex = Buffer.from(addrBytes).toString('hex')
  const hash = keccak256(Buffer.from(hex)).toString('hex')
  let out = ''
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i]
  }
  return out
}

// ─── Keccak-256 (@noble/hashes — audited, tiny) ───
import { keccak_256 } from '@noble/hashes/sha3.js'
function keccak256(data: Uint8Array): Buffer {
  return Buffer.from(keccak_256(data))
}

async function cmdExecute(aw: AgentWallet, positional: string[], flags: Record<string, string | boolean>) {
  const wallet = flags.wallet as string || positional[0]
  const program = flags.program as string || flags.target as string
  const key = flags.key as string || process.env.AGENTWALLET_KEY as string
  const chain = flags.chain as string || 'base'
  const data = flags.data as string || ''
  const value = flags.value as string || '0'
  const accounts = flags.accounts as string
  const amountUsdc = parseInt(flags['amount-usdc'] as string || '0')

  if (!wallet || !program || !key) {
    console.error(`
${c.bold}Usage:${c.reset} agentwallet execute --wallet <ADDR> --program <TARGET> --key <KEY>

${c.dim}Execute an arbitrary contract call / CPI from your wallet.${c.reset}

  --wallet       Smart wallet address
  --program      Target contract (Base) or program (Solana)
  --key          Agent private key (or AGENTWALLET_KEY env)
  --chain        base or solana (default: base)
  --data         Calldata: hex 0x... (Base) or base64 (Solana)
  --value        Native value: wei (Base) or lamports (Solana)

${c.dim}Solana-specific:${c.reset}
  --accounts     JSON array: [{"pubkey":"...","isSigner":false,"isWritable":true}]
  --amount-usdc  USD value for spending limit tracking

${c.dim}Examples:${c.reset}
  agentwallet execute --wallet 0xW --program 0xC --data 0xabcd --key 0xK
  agentwallet execute --wallet SolW --program Prog --data <b64> --accounts '[...]' --key <b58> --chain solana
`)
    process.exit(1)
  }

  if (chain === 'solana') {
    if (!accounts) { error('--accounts required for Solana execute'); process.exit(1) }
    let parsed: any[]
    try { parsed = JSON.parse(accounts) } catch { error('--accounts must be valid JSON'); process.exit(1) }

    const result = await aw.execute(wallet, {
      agentPrivateKey: key,
      programId: program,
      instructionData: data,
      accounts: parsed,
      amountUsdc,
    })
    if (flags.json) return console.log(JSON.stringify(result, null, 2))
    header('Execute (Solana)')
    row('Tx', result.txHash, c.green)
    row('Program', program, c.dim)
    console.log()
  } else {
    // Base: direct contract call (ethers must be installed by the user)
    let ethers: any
    try { ethers = (await import('ethers' as any)).ethers || (await import('ethers' as any)) } catch { error('ethers package required for Base execute: npm i ethers'); process.exit(1) }
    const RPC = process.env.AGENTWALLET_RPC || 'https://mainnet.base.org'
    const provider = new ethers.JsonRpcProvider(RPC)
    const signer = new ethers.Wallet(key, provider)

    const contract = new ethers.Contract(wallet, [
      'function execute(address to, uint256 value, bytes calldata data) external'
    ], signer)

    const calldata = data || '0x'
    const val = BigInt(value)

    const tx = await contract.execute(program, val, calldata)
    const receipt = await tx.wait()

    if (flags.json) return console.log(JSON.stringify({ tx: receipt.hash, target: program, value, data: calldata }, null, 2))
    header('Execute (Base)')
    row('Tx', receipt.hash, c.green)
    row('Target', program, c.dim)
    if (val > 0n) row('Value', value + ' wei', c.yellow)
    console.log()
  }
}

async function cmdStats(aw: AgentWallet, flags: Record<string, string | boolean>) {
  const data = await aw.stats()
  if (flags.json) return console.log(JSON.stringify(data, null, 2))
  header('Stats')
  row('Total wallets', String(data.totalWallets), c.bold + c.white)
  console.log()
}

// ─── Main ───
async function main() {
  const { command, positional, flags } = parse(process.argv)

  if (flags.version) { console.log(VERSION); return }
  if (!command || flags.help) { help(); return }

  const url = flags.url as string | undefined
  const aw = new AgentWallet(url)

  try {
    switch (command) {
      case 'keygen': case 'generate-key':
        await cmdKeygen(flags); return
      case 'create': case 'new':
        await cmdCreate(aw, flags); break
      case 'status': case 'info': case 'get':
        await cmdStatus(aw, positional, flags); break
      case 'limits': case 'limit': case 'request-increase':
        await cmdLimits(aw, positional, flags); break
      case 'token-limit': case 'set-token-limit':
        await cmdTokenLimit(aw, positional, flags); break
      case 'rm-token': case 'remove-token-limit': case 'rm-token-limit':
        await cmdRmToken(aw, positional, flags); break
      case 'pause':
        await cmdPause(aw, positional, flags); break
      case 'unpause': case 'resume':
        await cmdUnpause(aw, positional, flags); break
      case 'execute': case 'exec': case 'call':
        await cmdExecute(aw, positional, flags); break
      case 'stats':
        await cmdStats(aw, flags); break
      default:
        console.error(`${c.red}Unknown command: ${command}${c.reset}`)
        console.error(`${c.dim}Run 'agentwallet --help' for usage${c.reset}`)
        process.exit(1)
    }
  } catch (err: any) {
    error(err.message)
  }
}

main()
