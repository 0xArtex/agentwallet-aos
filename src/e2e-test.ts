import { ethers, Wallet, Contract, JsonRpcProvider, NonceManager } from "ethers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET_ABI = JSON.parse(readFileSync(join(__dirname, "base/abi/AgentWallet.json"), "utf-8"));
const FACTORY_ABI = JSON.parse(readFileSync(join(__dirname, "base/abi/AgentWalletFactory.json"), "utf-8"));

const RPC = "https://sepolia.base.org";
const FACTORY = "0x449bd8C8105f0584ab8437596D553cDf4a457aa4";
const DEPLOYER_KEY = "0x625af26c2ceff5344b0d697710eff5cbc0d08234b2f5a2f066de3430706351e9";

const provider = new JsonRpcProvider(RPC);
const deployerRaw = new Wallet(DEPLOYER_KEY, provider);
const deployer = new NonceManager(deployerRaw);

// Simple ERC20 we'll deploy for testing
const ERC20_BYTECODE = "0x608060405234801561001057600080fd5b506040516107c43803806107c4833981016040819052610030919061011c565b600361003c83826101ff565b50600461004983826101ff565b5050506102bd565b634e487b7160e01b600052604160045260246000fd5b600082601f83011261007857600080fd5b81516001600160401b038082111561009257610092610051565b604051601f8301601f19908116603f011681019082821181831017156100ba576100ba610051565b816040528381526020925086838588010111156100d657600080fd5b600091505b838210156100f857858201830151818301840152908201906100db565b600093810190920192909252949350505050565b805160ff8116811461011757600080fd5b919050565b60008060006060848603121561013157600080fd5b83516001600160401b038082111561014857600080fd5b61015487838801610067565b9450602086015191508082111561016a57600080fd5b5061017786828701610067565b92505061018660408501610105565b90509250925092565b600181811c908216806101a357607f821691505b6020821081036101c357634e487b7160e01b600052602260045260246000fd5b50919050565b601f82111561021457600081815260208120601f850160051c810160208610156101f05750805b601f850160051c820191505b8181101561020f578281556001016101fc565b505050505b505050565b81516001600160401b0381111561023257610232610051565b610246816102408454610190565b846101c9565b602080601f83116001811461027b57600084156102635750858301515b600019600386901b1c1916600185901b17855561020f565b600085815260208120601f198616915b828110156102aa5788860151825594840194600190910190840161028b565b50858210156102c85787850151600019600388901b60f8161c191681555b5050505050600190811b01905550565b6104f8806102cc6000396000f3fe608060405234801561001057600080fd5b50600436106100935760003560e01c8063313ce56711610066578063313ce5671461010357806370a082311461011257806395d89b411461013b578063a9059cbb14610143578063dd62ed3e1461015657600080fd5b806306fdde0314610098578063095ea7b3146100b657806318160ddd146100d957806323b872dd146100f0575b600080fd5b6100a061018f565b6040516100ad9190610372565b60405180910390f35b6100c96100c43660046103dc565b610221565b60405190151581526020016100ad565b6100e260025481565b6040519081526020016100ad565b6100c96100fe366004610406565b61023b565b604051601281526020016100ad565b6100e2610120366004610442565b6001600160a01b031660009081526020819052604090205490565b6100a0610294565b6100c96101513660046103dc565b6102a3565b6100e2610164366004610464565b6001600160a01b03918216600090815260016020908152604080832093909416825291909152205490565b60606003805461019e90610497565b80601f01602080910402602001604051908101604052809291908181526020018280546101ca90610497565b80156102175780601f106101ec57610100808354040283529160200191610217565b820191906000526020600020905b8154815290600101906020018083116101fa57829003601f168201915b5050505050905090565b6000336102308185856102b1565b5060015b9392505050565b6001600160a01b0383166000908152600160209081526040808320338452909152812054600019811461027e5761027e8533610279868561041d565b6102b1565b61028985858561031e565b506001949350505050565b60606004805461019e90610497565b60003361022f81858561031e565b6001600160a01b0383166103005760405162461bcd60e51b8152602060048201526012602482015271417070726f766520746f206164647265737360701b604482015260640160405180910390fd5b6001600160a01b03928316600090815260016020908152604080832094909516825292909252919020555050565b6001600160a01b03831660009081526020819052604081208054839190839061035890849061041d565b909155505060009182526020829052604090912080549091019055565b600060208083528351808285015260005b818110156103a157858101830151858201604001528201610385565b506000604082860101526040601f19601f8301168501019250505092915050565b80356001600160a01b03811681146103d757600080fd5b919050565b600080604083850312156103ef57600080fd5b6103f8836103c0565b946020939093013593505050565b60008060006060848603121561041b57600080fd5b610424846103c0565b9250610432602085016103c0565b9150604084013590509250925092565b60006020828403121561045457600080fd5b61023d826103c0565b6000806040838503121561047757600080fd5b610480836103c0565b915061048e602084016103c0565b90509250929050565b600181811c908216806104ab57607f821691505b6020821081036104cb57634e487b7160e01b600052602260045260246000fd5b5091905056fea264697066735822beefbeef64736f6c63430008210033";

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function mint(address,uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

let passed = 0;
let failed = 0;

function ok(name: string) { passed++; console.log(`  ✅ ${name}`); }
function fail(name: string, err: string) { failed++; console.log(`  ❌ ${name}: ${err}`); }

async function expectRevert(fn: () => Promise<any>, contains: string, name: string, signer?: NonceManager) {
  try {
    const tx = await fn();
    if (tx?.wait) await tx.wait();
    fail(name, "expected revert but succeeded");
  } catch (e: any) {
    const msg = e.message || e.toString();
    if (msg.includes(contains)) ok(name);
    else fail(name, `wrong revert: ${msg.slice(0, 200)}`);
    // Reset nonce manager after failed tx to prevent nonce drift
    if (signer) signer.reset();
  }
}

async function main() {
  console.log("\n🔐 AgentWallet E2E Test Suite — Base Sepolia\n");

  // Setup: create owner (deployer) + fresh agent wallet
  const agentSigner = new NonceManager(Wallet.createRandom().connect(provider));
  const randomRecipient = Wallet.createRandom().address;
  const scamAddress = "0x000000000000000000000000000000000000dEaD";

  const factory = new Contract(FACTORY, FACTORY_ABI, deployer);

  // ─── Deploy a test ERC20 ("SHITCOIN") ───
  console.log("Setting up test token...");
  // We'll use a simpler approach: deploy via factory a fresh wallet, fund it
  // Actually let's just test with ETH since we don't have a test ERC20 deployed.
  // The contract tests already verified ERC20 — here we test the real on-chain flow with ETH.

  // ─── Create wallet ───
  console.log("\n── Wallet Creation ──");
  const tx = await factory.createWallet(await deployer.getAddress(), await agentSigner.getAddress());
  const receipt = await tx.wait();
  const event = receipt.logs.find((log: any) => {
    try { return factory.interface.parseLog({ topics: log.topics, data: log.data })?.name === "WalletCreated"; }
    catch { return false; }
  });
  const walletAddr = factory.interface.parseLog({ topics: event.topics, data: event.data })!.args.wallet;
  console.log(`  Wallet: ${walletAddr}`);
  console.log(`  Agent:  ${await agentSigner.getAddress()}`);

  const wallet = new Contract(walletAddr, WALLET_ABI, agentSigner);
  const walletAsOwner = new Contract(walletAddr, WALLET_ABI, deployer);

  // Check gas was seeded
  const gasBalance = await provider.getBalance(walletAddr);
  if (gasBalance > 0n) ok("Gas auto-seeded on creation");
  else fail("Gas auto-seeded", `balance is ${gasBalance}`);

  // Fund agent signer + wallet
  console.log("\nFunding agent signer + wallet...");
  await (await deployer.sendTransaction({ to: await agentSigner.getAddress(), value: ethers.parseEther("0.001") })).wait();
  ok("Agent signer funded for gas");
  await (await deployer.sendTransaction({ to: walletAddr, value: ethers.parseEther("0.002") })).wait();
  ok("Wallet funded with ETH");

  // ─── Normal Operations ───
  console.log("\n── Normal Transfers ──");

  // Helper to avoid nonce collisions on testnet
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Agent sends ETH to random address
  // Note: amount param = value sent = what gets tracked against limits
  const sendTx = await wallet.execute(randomRecipient, 1000000n, "0x");
  const sendReceipt = await sendTx.wait();
  ok(`Agent sends ETH to random (tx: ${sendReceipt.hash.slice(0, 10)}...)`);

  await delay(500);
  // Check spent tracking
  const spent = await wallet.getSpentToday();
  if (spent === 1000000n) ok("Spent today tracked correctly");
  else fail("Spent tracking", `expected 1000000, got ${spent}`);

  const remaining = await wallet.getRemainingDaily();
  if (remaining === 49000000n) ok("Remaining daily correct (49M)");
  else fail("Remaining daily", `expected 49000000, got ${remaining}`);

  // Multiple transfers in a day
  await delay(500);
  const tx2 = await wallet.execute(randomRecipient, 5000000n, "0x");
  await tx2.wait();
  ok("Second transfer in same day");

  await delay(500);
  const tx3 = await wallet.execute(randomRecipient, 10000000n, "0x");
  await tx3.wait();
  ok("Third transfer in same day");

  // ─── Limit Enforcement ──
  console.log("\n── Limit Enforcement ──");

  // Per-tx limit (default 25 USDC = 25000000)
  await delay(500);
  await expectRevert(
    () => wallet.execute(randomRecipient, 26000000n, "0x"),
    "exceeds per-tx limit",
    "Rejects tx over per-tx limit (26M > 25M)",
    agentSigner
  );

  // Exactly at per-tx limit should work
  await delay(500);
  const tx4 = await wallet.execute(randomRecipient, 25000000n, "0x");
  await tx4.wait();
  ok("Tx at exactly per-tx limit (25M) succeeds");

  // Now we've spent 1M + 5M + 10M + 25M = 41M, remaining = 9M
  const remaining2 = await wallet.getRemainingDaily();
  console.log(`  (Spent so far: ${50000000n - remaining2} / 50000000)`);

  // Try to exceed daily limit
  await delay(500);
  await expectRevert(
    () => wallet.execute(randomRecipient, 10000000n, "0x"),
    "exceeds daily limit",
    "Rejects tx that would exceed daily limit",
    agentSigner
  );

  // Exact remaining should work
  await delay(500);
  const exactRemaining = await wallet.getRemainingDaily();
  const tx5 = await wallet.execute(randomRecipient, exactRemaining, "0x");
  await tx5.wait();
  ok(`Tx for exact remaining daily (${exactRemaining}) succeeds`);

  // Now fully spent — even 1 unit should fail
  await delay(500);
  await expectRevert(
    () => wallet.execute(randomRecipient, 1n, "0x"),
    "exceeds daily limit",
    "Rejects even 1 unit after daily limit exhausted",
    agentSigner
  );

  // ─── Blacklist ──
  console.log("\n── Blacklist ──");

  // Owner blacklists scam address
  const blTx = await walletAsOwner.setBlacklist(scamAddress, true);
  await blTx.wait();
  ok("Owner blacklists address");

  // Need to reset daily first — raise limits so we can test blacklist
  await delay(500);
  const policyTx = await walletAsOwner.setPolicy(500000000n, 200000000n);
  await policyTx.wait();

  // Agent tries to send to blacklisted address
  await delay(500);
  await expectRevert(
    () => wallet.execute(scamAddress, 1000000n, "0x"),
    "blacklisted",
    "Rejects transfer to blacklisted address",
    agentSigner
  );

  // Agent can still send to non-blacklisted
  await delay(500);
  const pol2 = await wallet.getPolicy();
  const rem3 = await wallet.getRemainingDaily();
  const sp3 = await wallet.getSpentToday();
  console.log(`  (Policy: daily=${pol2.dailyLimit} perTx=${pol2.perTxLimit} spent=${sp3} remaining=${rem3})`);
  const tx6 = await wallet.execute(randomRecipient, 1000000n, "0x");
  await tx6.wait();
  ok("Transfer to non-blacklisted address still works");

  // Remove from blacklist
  await delay(500);
  const unblTx = await walletAsOwner.setBlacklist(scamAddress, false);
  await unblTx.wait();

  // Now scam address works
  await delay(500);
  const tx7 = await wallet.execute(scamAddress, 1000000n, "0x");
  await tx7.wait();
  ok("Transfer to unblacklisted address works");

  // ─── Owner Controls ──
  console.log("\n── Owner Controls ──");

  // Owner raises limits
  await delay(500);
  const newPolicy = await walletAsOwner.setPolicy(1000000000n, 500000000n);
  await newPolicy.wait();
  const policy = await wallet.getPolicy();
  if (policy.dailyLimit === 1000000000n && policy.perTxLimit === 500000000n) ok("Owner raises limits instantly");
  else fail("Raise limits", `got ${policy.dailyLimit}/${policy.perTxLimit}`);

  // Owner lowers limits
  await delay(500);
  const lowerTx = await walletAsOwner.setPolicy(10000000n, 5000000n);
  await lowerTx.wait();

  await expectRevert(
    () => wallet.execute(randomRecipient, 6000000n, "0x"),
    "exceeds per-tx limit",
    "Lowered per-tx limit enforced immediately",
    agentSigner
  );

  // Owner pauses wallet
  await delay(500);
  const pauseTx = await walletAsOwner.pause();
  await pauseTx.wait();

  await expectRevert(
    () => wallet.execute(randomRecipient, 1000000n, "0x"),
    "paused",
    "Paused wallet rejects all transactions",
    agentSigner
  );

  // Owner unpauses
  await delay(500);
  const unpauseTx = await walletAsOwner.unpause();
  await unpauseTx.wait();

  // Raise limits back so we can test
  await delay(500);
  await (await walletAsOwner.setPolicy(500000000n, 200000000n)).wait();
  await delay(500);
  const tx8 = await wallet.execute(randomRecipient, 1000000n, "0x");
  await tx8.wait();
  ok("Unpaused wallet resumes transactions");

  // ─── Agent Key Rotation ──
  console.log("\n── Agent Key Management ──");

  const newAgent = new NonceManager(Wallet.createRandom().connect(provider));

  // Fund new agent for gas
  await (await deployer.sendTransaction({ to: await newAgent.getAddress(), value: ethers.parseEther("0.0005") })).wait();

  // Replace agent key
  await delay(500);
  const rotateTx = await walletAsOwner.setAgentKey(await newAgent.getAddress());
  await rotateTx.wait();
  ok("Owner rotates agent key");

  // Old agent can't transact
  await expectRevert(
    () => wallet.execute(randomRecipient, 1000000n, "0x"),
    "not agent",
    "Old agent key rejected",
    agentSigner
  );

  // New agent can
  await delay(500);
  const walletNewAgent = new Contract(walletAddr, WALLET_ABI, newAgent);
  const tx9 = await walletNewAgent.execute(randomRecipient, 1000000n, "0x");
  await tx9.wait();
  ok("New agent key works");

  // ─── Unauthorized Access ──
  console.log("\n── Unauthorized Access ──");

  const rando = Wallet.createRandom().connect(provider);

  await expectRevert(
    () => new Contract(walletAddr, WALLET_ABI, rando).execute(randomRecipient, 1n, "0x"),
    "not agent",
    "Random address can't execute"
  );

  await expectRevert(
    () => new Contract(walletAddr, WALLET_ABI, agentSigner).setPolicy(999n, 999n),
    "not owner",
    "Agent can't change policy"
  );

  await expectRevert(
    () => new Contract(walletAddr, WALLET_ABI, agentSigner).pause(),
    "not owner",
    "Agent can't pause wallet"
  );

  await expectRevert(
    () => new Contract(walletAddr, WALLET_ABI, agentSigner).setBlacklist(randomRecipient, true),
    "not owner",
    "Agent can't modify blacklist"
  );

  await expectRevert(
    () => new Contract(walletAddr, WALLET_ABI, rando).emergencyWithdraw(ethers.ZeroAddress, 1n),
    "not owner",
    "Random can't emergency withdraw"
  );

  // ─── Emergency Withdraw ──
  console.log("\n── Emergency Withdraw ──");

  const balBefore = await provider.getBalance(await deployer.getAddress());
  const walBal = await provider.getBalance(walletAddr);
  if (walBal > 0n) {
    const ewTx = await walletAsOwner.emergencyWithdraw(ethers.ZeroAddress, walBal / 2n);
    await ewTx.wait();
    ok("Owner emergency withdraws ETH");
  }

  // ─── Contract Calls (simulating swap-like interaction) ──
  console.log("\n── Contract Interaction ──");

  // Agent calls an arbitrary contract (the factory, just to test arbitrary calldata works)
  await delay(500);
  const calldata = factory.interface.encodeFunctionData("totalWallets");
  const walletAsNewAgent = new Contract(walletAddr, WALLET_ABI, newAgent);
  const callTx = await walletAsNewAgent.execute(FACTORY, 0n, calldata);
  await callTx.wait();
  ok("Agent executes arbitrary contract call (calldata)");

  // ─── Summary ──
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
