import { createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import type { Address } from "viem";

export type MilestoneStatus = 0 | 1 | 2 | 3;
export type GrantStatus = 0 | 1 | 2;
export type SupportedNetwork = "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";

export interface GrantState {
  id: number;
  title: string;
  status: GrantStatus;
  funder: string;
  grantee: string;
  locked_balance: bigint;
  milestone_count: number;
}

export interface MilestoneState {
  grant_id: number;
  index: number;
  description: string;
  payout: bigint;
  status: MilestoneStatus;
  evidence_url: string;
  reason: string;
  confidence: number;
}

interface WriteResult {
  txHash: string;
}

interface CreateGrantResult extends WriteResult {
  grantId: number;
}

interface GenLayerReceiptPayload {
  readable?: string;
}

interface GenLayerReceiptResult {
  status?: string;
  payload?: GenLayerReceiptPayload | string | null;
}

interface GenLayerReceipt {
  txExecutionResultName?: string;
  consensus_data?: {
    leader_receipt?: Array<{
      error?: string | null;
      result?: GenLayerReceiptResult | string;
    }>;
  };
}

interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: WalletProvider;
  }
}

const CONTRACT_ADDRESS = import.meta.env.VITE_GRANTGUARD_CONTRACT_ADDRESS as Address;
const NETWORK = (import.meta.env.VITE_GENLAYER_NETWORK ?? "studionet") as SupportedNetwork;
const RPC_URL = import.meta.env.VITE_GENLAYER_RPC as string | undefined;

const REQUIRED_METHODS = [
  "cancel_grant",
  "create_grant",
  "get_grant",
  "get_milestone",
  "get_withdrawable",
  "review_milestone",
  "submit_milestone",
  "total_grants",
  "withdraw",
];

const CHAIN_BY_NETWORK = {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} as const;

const chain = CHAIN_BY_NETWORK[NETWORK];
const endpoint = RPC_URL || chain.rpcUrls.default.http[0];

const readClient = createClient({
  chain,
  endpoint,
});

let writeClient: ReturnType<typeof createClient> | null = null;
let connectedAddress: Address | null = null;

function quoteNumericField(rawJson: string, field: string): string {
  return rawJson.replace(new RegExp(`("${field}"\\s*:\\s*)(-?\\d+)`, "g"), '$1"$2"');
}

function parseGrantState(rawJson: string): GrantState {
  const jsonSafe = quoteNumericField(rawJson, "locked_balance");
  const parsed = JSON.parse(jsonSafe) as Omit<GrantState, "locked_balance"> & {
    locked_balance: string;
  };

  return {
    ...parsed,
    locked_balance: BigInt(parsed.locked_balance),
  };
}

function parseMilestoneState(rawJson: string): MilestoneState {
  const jsonSafe = quoteNumericField(rawJson, "payout");
  const parsed = JSON.parse(jsonSafe) as Omit<MilestoneState, "payout"> & {
    payout: string;
  };

  return {
    ...parsed,
    payout: BigInt(parsed.payout),
  };
}

function getWalletProvider(): WalletProvider {
  if (!window.ethereum) {
    throw new Error("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
  }
  return window.ethereum;
}

function getReadableReturnValue(receipt: GenLayerReceipt): string | null {
  const result = receipt.consensus_data?.leader_receipt?.[0]?.result;
  if (!result) {
    return null;
  }

  if (typeof result === "string") {
    return result;
  }

  const payload = result.payload;
  if (typeof payload === "string") {
    return payload;
  }

  return payload?.readable ?? null;
}

function getExecutionError(receipt: GenLayerReceipt): string | null {
  const leaderReceipt = receipt.consensus_data?.leader_receipt?.[0];
  if (leaderReceipt?.error) {
    return leaderReceipt.error;
  }

  const result = leaderReceipt?.result;
  if (typeof result === "object" && result?.status && result.status !== "return") {
    const payload = result.payload;
    if (typeof payload === "string") {
      return payload;
    }
  }

  return null;
}

function ensureExecutionSucceeded(receipt: GenLayerReceipt, txHash: string): void {
  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN) {
    return;
  }

  const details = getExecutionError(receipt);
  const suffix = details ? ` ${details}` : "";
  throw new Error(`Transaction ${txHash} did not finish successfully.${suffix}`);
}

async function waitForFinalizedReceipt(txHash: string): Promise<GenLayerReceipt> {
  const receipt = (await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 5_000,
    retries: 60,
  })) as GenLayerReceipt;

  ensureExecutionSucceeded(receipt, txHash);
  return receipt;
}

function requireWriteClient() {
  if (!writeClient || !connectedAddress) {
    throw new Error("Connect your wallet before sending transactions.");
  }
  return writeClient;
}

export function isWalletAvailable(): boolean {
  return Boolean(window.ethereum);
}

export function getConnectedAddress(): string | null {
  return connectedAddress;
}

export async function initializeContract(): Promise<{
  contractAddress: string;
  network: SupportedNetwork;
  rpcUrl: string;
}> {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Missing VITE_GRANTGUARD_CONTRACT_ADDRESS.");
  }

  const schema = await readClient.getContractSchema(CONTRACT_ADDRESS);
  const methods = Object.keys(schema.methods ?? {});
  for (const method of REQUIRED_METHODS) {
    if (!methods.includes(method)) {
      throw new Error(`Live contract is missing required method "${method}".`);
    }
  }

  return {
    contractAddress: CONTRACT_ADDRESS,
    network: NETWORK,
    rpcUrl: endpoint,
  };
}

export async function restoreWalletConnection(): Promise<string | null> {
  if (!window.ethereum) {
    return null;
  }

  const provider = getWalletProvider();
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const first = accounts[0] as Address | undefined;

  if (!first) {
    return null;
  }

  connectedAddress = first;
  writeClient = createClient({
    chain,
    endpoint,
    account: first,
    provider,
  });

  return first;
}

export async function connectAccount(): Promise<string> {
  const provider = getWalletProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const first = accounts[0] as Address | undefined;

  if (!first) {
    throw new Error("Wallet did not return an account.");
  }

  connectedAddress = first;
  writeClient = createClient({
    chain,
    endpoint,
    account: first,
    provider,
  });

  await writeClient.connect(NETWORK);
  return first;
}

export async function createGrant(
  title: string,
  granteeAddress: string,
  milestoneDescriptions: string[],
  milestonePayouts: bigint[],
  totalDeposit: bigint
): Promise<CreateGrantResult> {
  const client = requireWriteClient();
  const grantCountBefore = await totalGrants();
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "create_grant",
    args: [title, granteeAddress, milestoneDescriptions, milestonePayouts],
    value: totalDeposit,
  });

  const receipt = await waitForFinalizedReceipt(txHash);
  const readable = getReadableReturnValue(receipt);
  const grantId =
    readable && /^-?\d+$/.test(readable.trim())
      ? Number(readable.trim())
      : grantCountBefore;

  return { grantId, txHash };
}

export async function submitMilestone(
  grantId: number,
  milestoneIndex: number,
  evidenceUrl: string
): Promise<WriteResult> {
  const client = requireWriteClient();
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "submit_milestone",
    args: [grantId, milestoneIndex, evidenceUrl],
    value: 0n,
  });

  await waitForFinalizedReceipt(txHash);
  return { txHash };
}

export async function reviewMilestone(grantId: number, milestoneIndex: number): Promise<WriteResult> {
  const client = requireWriteClient();
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "review_milestone",
    args: [grantId, milestoneIndex],
    value: 0n,
  });

  await waitForFinalizedReceipt(txHash);
  return { txHash };
}

export async function cancelGrant(grantId: number): Promise<WriteResult> {
  const client = requireWriteClient();
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "cancel_grant",
    args: [grantId],
    value: 0n,
  });

  await waitForFinalizedReceipt(txHash);
  return { txHash };
}

export async function getGrant(grantId: number): Promise<GrantState | null> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_grant",
    args: [grantId],
  });

  if (typeof raw !== "string" || raw === "{}") {
    return null;
  }

  return parseGrantState(raw);
}

export async function getMilestone(grantId: number, milestoneIndex: number): Promise<MilestoneState | null> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_milestone",
    args: [grantId, milestoneIndex],
  });

  if (typeof raw !== "string" || raw === "{}") {
    return null;
  }

  return parseMilestoneState(raw);
}

export async function getWithdrawable(address: string): Promise<bigint> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_withdrawable",
    args: [address],
    jsonSafeReturn: false,
  });

  return BigInt(raw as bigint | number | string);
}

export async function totalGrants(): Promise<number> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "total_grants",
    args: [],
    jsonSafeReturn: false,
  });

  return Number(raw);
}

export async function withdraw(): Promise<WriteResult> {
  const client = requireWriteClient();
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "withdraw",
    args: [],
    value: 0n,
  });

  await waitForFinalizedReceipt(txHash);
  return { txHash };
}

export const config = {
  contractAddress: CONTRACT_ADDRESS,
  network: NETWORK,
  rpcUrl: endpoint,
};
