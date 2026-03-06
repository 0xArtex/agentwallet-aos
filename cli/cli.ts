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

const VERSION = '1.0.1'

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
Non-custodial smart wallets for AI agents on Base

${c.bold}Commands${c.reset}
  ${c.cyan}create${c.reset}              Create a new wallet
  ${c.cyan}status${c.reset} ${c.dim}<wallet>${c.reset}     Check wallet info & balances
  ${c.cyan}limits${c.reset} ${c.dim}<wallet>${c.reset}     Request a limit increase
  ${c.cyan}token-limit${c.reset} ${c.dim}<wallet>${c.reset} Set a per-token spending limit
  ${c.cyan}rm-token${c.reset} ${c.dim}<wallet>${c.reset}   Remove a token limit
  ${c.cyan}pause${c.reset} ${c.dim}<wallet>${c.reset}      Request emergency pause
  ${c.cyan}unpause${c.reset} ${c.dim}<wallet>${c.reset}    Request unpause
  ${c.cyan}keygen${c.reset}              Generate a new agent keypair
  ${c.cyan}stats${c.reset}               Total wallets deployed

${c.bold}Options${c.reset}
  ${c.yellow}--agent${c.reset} ${c.dim}<addr>${c.reset}      Agent's EVM public address (the key that signs transactions)
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
  ${c.dim}# Create a managed wallet (human sets up passkey)${c.reset}
  ${c.dim}# --agent is your EVM public address (the key your agent uses to sign txs)${c.reset}
  ${c.green}$${c.reset} agentwallet create --agent 0xYourAgentPublicAddress

  ${c.dim}# Create an autonomous wallet (no human)${c.reset}
  ${c.green}$${c.reset} agentwallet create --agent 0xYourAgentPublicAddress --unmanaged

  ${c.dim}# Check your wallet${c.reset}
  ${c.green}$${c.reset} agentwallet status 0xWallet...

  ${c.dim}# Need higher limits? Ask your human${c.reset}
  ${c.green}$${c.reset} agentwallet limits 0xWallet... --daily 200 --pertx 100

  ${c.dim}# Cap exposure on a specific token${c.reset}
  ${c.green}$${c.reset} agentwallet token-limit 0xWallet... --token 0xToken... --token-daily 1000 --token-pertx 300

${c.bold}Environment${c.reset}
  ${c.yellow}AGENTWALLET_URL${c.reset}    API endpoint (default: https://agntos.dev/wallet)
  ${c.yellow}AGENTWALLET_AGENT${c.reset}  Default agent address

${c.dim}Docs: https://github.com/0xArtex/agentwallet-aos${c.reset}
${c.dim}npm:  https://www.npmjs.com/package/@agntos/agentwallet${c.reset}
`)
}

// ─── Commands ───

async function cmdCreate(aw: AgentWallet, flags: Record<string, string | boolean>) {
  const agent = (flags.agent as string) || process.env.AGENTWALLET_AGENT || ''
  if (!agent) {
    console.error(`
  ${c.red}✗${c.reset} --agent <address> is required

  ${c.dim}This is your agent's EVM public address — the key it uses to sign transactions.${c.reset}

  ${c.dim}Don't have one? Generate a keypair:${c.reset}
  ${c.green}$${c.reset} agentwallet keygen

  ${c.dim}Or set it as an env var:${c.reset}
  ${c.green}$${c.reset} export AGENTWALLET_AGENT=0xYourAddress
`)
    process.exit(1)
  }

  const data = flags.unmanaged
    ? await aw.createUnmanaged(agent!)
    : await aw.create(agent!)

  if (flags.json) return console.log(JSON.stringify(data, null, 2))

  const w = data.wallet
  header(flags.unmanaged ? 'Wallet created (unmanaged)' : 'Wallet created')
  row('Address', w.address, c.bold + c.white)
  row('Agent', w.agent)
  row('Mode', data.mode, data.mode === 'managed' ? c.yellow : c.green)
  row('Daily limit', `$${Number(w.policy.dailyLimit) / 1e6}`)
  row('Per-tx limit', `$${Number(w.policy.perTxLimit) / 1e6}`)
  row('Gas funded', `${Number(w.gasBalance) / 1e18} ETH`, c.green)

  if (data.setupUrl) {
    console.log()
    console.log(`  ${c.bold}Setup URL${c.reset} ${c.dim}(send to your human to register passkey)${c.reset}`)
    console.log(`  ${c.cyan}${data.setupUrl}${c.reset}`)
  }
  console.log()
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
  row('Gas balance', `${Number(w.gasBalance) / 1e18} ETH`, Number(w.gasBalance) < 5000000000000 ? c.yellow : c.green)
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

async function cmdKeygen(flags: Record<string, string | boolean>) {
  const crypto = await import('crypto')
  const privBytes = crypto.randomBytes(32)
  const privKey = '0x' + privBytes.toString('hex')

  // Derive address: secp256k1 pubkey → keccak256 → last 20 bytes
  const ecdh = crypto.createECDH('secp256k1')
  ecdh.setPrivateKey(privBytes)
  const pubBytes = ecdh.getPublicKey().subarray(1) // remove 0x04 prefix
  const hash = keccak256(pubBytes)
  const address = '0x' + toChecksumAddress(hash.subarray(12))

  if (flags.json) {
    console.log(JSON.stringify({ address, privateKey: privKey }))
    return
  }

  header('New Agent Keypair')
  row('Address', address, c.bold + c.white)
  row('Private key', privKey, c.yellow)
  console.log()
  console.log(`  ${c.dim}Save the private key securely — your agent needs it to sign transactions.${c.reset}`)
  console.log(`  ${c.dim}Never share it. Never commit it to git.${c.reset}`)
  console.log()
  console.log(`  ${c.dim}Create a wallet with this key:${c.reset}`)
  console.log(`  ${c.green}$${c.reset} agentwallet create --agent ${address}`)
  console.log()
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

// ─── Keccak-256 (pure JS, zero deps) ───
function keccak256(data: Uint8Array): Buffer {
  const RATE = 136
  const state = new BigUint64Array(25)
  const buf = Buffer.from(data)

  let pos = 0
  while (pos + RATE <= buf.length) {
    for (let i = 0; i < RATE / 8; i++) state[i] ^= buf.readBigUInt64LE(pos + i * 8)
    keccakF1600(state)
    pos += RATE
  }

  const last = Buffer.alloc(RATE)
  buf.copy(last, 0, pos)
  last[buf.length - pos] ^= 0x01
  last[RATE - 1] ^= 0x80
  for (let i = 0; i < RATE / 8; i++) state[i] ^= last.readBigUInt64LE(i * 8)
  keccakF1600(state)

  const out = Buffer.alloc(32)
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(state[i], i * 8)
  return out
}

function keccakF1600(s: BigUint64Array) {
  const RC: bigint[] = [
    0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,
    0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
    0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
    0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
    0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,
    0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n,
  ]
  const m = 0xFFFFFFFFFFFFFFFFn
  const r = (x: bigint, n: bigint) => ((x << n) | (x >> (64n - n))) & m

  for (let round = 0; round < 24; round++) {
    // θ
    const c0 = s[0]^s[5]^s[10]^s[15]^s[20], c1 = s[1]^s[6]^s[11]^s[16]^s[21]
    const c2 = s[2]^s[7]^s[12]^s[17]^s[22], c3 = s[3]^s[8]^s[13]^s[18]^s[23]
    const c4 = s[4]^s[9]^s[14]^s[19]^s[24]
    const d0 = (c4 ^ r(c1,1n))&m, d1 = (c0 ^ r(c2,1n))&m
    const d2 = (c1 ^ r(c3,1n))&m, d3 = (c2 ^ r(c4,1n))&m, d4 = (c3 ^ r(c0,1n))&m
    for (let i = 0; i < 25; i += 5) { s[i]^=d0; s[i+1]^=d1; s[i+2]^=d2; s[i+3]^=d3; s[i+4]^=d4 }
    // ρ + π
    let t = s[1]
    const PI=[10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1]
    const RO=[1n,3n,6n,10n,15n,21n,28n,36n,45n,55n,2n,14n,27n,41n,56n,8n,25n,43n,62n,18n,39n,61n,20n,44n]
    for (let i = 0; i < 24; i++) { const j=PI[i]; const u=s[j]; s[j]=r(t,RO[i]); t=u }
    // χ
    for (let y = 0; y < 25; y += 5) {
      const a=s[y],b=s[y+1],c=s[y+2],d=s[y+3],e=s[y+4]
      s[y]=(a^(~b&c))&m; s[y+1]=(b^(~c&d))&m; s[y+2]=(c^(~d&e))&m; s[y+3]=(d^(~e&a))&m; s[y+4]=(e^(~a&b))&m
    }
    s[0] = (s[0] ^ RC[round]) & m
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
