import { formatUnits, parseUnits } from "viem";
import {
  cancelGrant,
  config,
  connectAccount,
  createGrant,
  getConnectedAddress,
  getGrant,
  getMilestone,
  getWithdrawable,
  initializeContract,
  isWalletAvailable,
  restoreWalletConnection,
  reviewMilestone,
  submitMilestone,
  withdraw,
  type GrantState,
  type MilestoneState,
} from "./lib/genlayer";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
};

const STATUS = ["LOCKED", "SUBMITTED", "RELEASED", "REJECTED"] as const;
const GSTATUS = ["OPEN", "COMPLETE", "CANCELLED"] as const;
const GEN_DECIMALS = 18;

let activeGrantId: number | null = null;
let activeGrant: GrantState | null = null;
let activeMilestones: MilestoneState[] = [];
let currentWithdrawable = 0n;
let busy = false;

function normalizeAddress(address: string | null | undefined): string {
  return (address ?? "").toLowerCase();
}

function short(address: string | null | undefined): string {
  if (!address) {
    return "not connected";
  }
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : hash;
}

function formatGen(amountWei: bigint): string {
  const raw = formatUnits(amountWei, GEN_DECIMALS);
  const trimmed = raw
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")
    .replace(/^\./, "0.");
  return `${trimmed} GEN`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return map[char] ?? char;
  });
}

function setStatus(message: string, tone: "neutral" | "ok" | "warn" = "neutral"): void {
  const flag = $("demoFlag");
  flag.textContent = message;
  flag.classList.remove("is-ok", "is-warn");
  if (tone === "ok") {
    flag.classList.add("is-ok");
  }
  if (tone === "warn") {
    flag.classList.add("is-warn");
  }
}

function setLedgerNotice(message: string): void {
  $("ledgerNotice").textContent = message;
}

function updateWalletUi(address: string | null): void {
  $("connectBtn").textContent = address ? `Wallet ${short(address)}` : "Connect wallet";
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  $("createBtn").toggleAttribute("disabled", nextBusy);
  $("loadBtn").toggleAttribute("disabled", nextBusy);
  $("connectBtn").toggleAttribute("disabled", nextBusy);
  $("cancelBtn").toggleAttribute("disabled", nextBusy);
  $("withdrawBtn").toggleAttribute("disabled", nextBusy || currentWithdrawable === 0n);
}

function getIsConnectedFunder(): boolean {
  return Boolean(activeGrant && normalizeAddress(activeGrant.funder) === normalizeAddress(getConnectedAddress()));
}

function getIsConnectedGrantee(): boolean {
  return Boolean(activeGrant && normalizeAddress(activeGrant.grantee) === normalizeAddress(getConnectedAddress()));
}

function canCancelGrant(grant: GrantState, milestones: MilestoneState[]): boolean {
  return grant.status === 0 && milestones.every((milestone) => milestone.status === 0);
}

async function refreshWithdrawable(): Promise<void> {
  const address = getConnectedAddress();
  currentWithdrawable = address ? await getWithdrawable(address) : 0n;
  const withdrawBtn = $("withdrawBtn");
  withdrawBtn.textContent =
    currentWithdrawable > 0n ? `Withdraw ${formatGen(currentWithdrawable)}` : "Withdraw";
  withdrawBtn.toggleAttribute("disabled", busy || currentWithdrawable === 0n);
}

async function loadGrantFromChain(grantId: number): Promise<void> {
  const grant = await getGrant(grantId);
  if (!grant) {
    throw new Error(`Grant ${grantId} does not exist on ${config.network}.`);
  }

  const milestones = (
    await Promise.all(
      Array.from({ length: grant.milestone_count }, (_, index) => getMilestone(grantId, index))
    )
  ).filter((milestone): milestone is MilestoneState => milestone !== null);

  activeGrantId = grantId;
  activeGrant = grant;
  activeMilestones = milestones;
  $("loadId").value = String(grantId);
  await refreshWithdrawable();
  renderLedger();
}

function renderLedger(): void {
  const empty = $("ledgerEmpty");
  const gates = $("gates");
  const meta = $("ledgerMeta");
  const actions = $("grantActions");

  if (!activeGrant || activeGrantId === null) {
    empty.style.display = "block";
    gates.innerHTML = "";
    meta.textContent = "— no grant loaded —";
    actions.style.display = "none";
    setLedgerNotice("");
    return;
  }

  empty.style.display = "none";
  actions.style.display = "flex";
  const released = activeMilestones
    .filter((milestone) => milestone.status === 2)
    .reduce((sum, milestone) => sum + milestone.payout, 0n);

  meta.textContent = `#${activeGrant.id} · ${GSTATUS[activeGrant.status]} · locked ${formatGen(activeGrant.locked_balance)} · released ${formatGen(released)} · grantee ${short(activeGrant.grantee)}`;

  const cancelBtn = $("cancelBtn");
  cancelBtn.style.display = getIsConnectedFunder() ? "inline-flex" : "none";
  cancelBtn.toggleAttribute(
    "disabled",
    busy || !getIsConnectedFunder() || !canCancelGrant(activeGrant, activeMilestones)
  );

  const withdrawBtn = $("withdrawBtn");
  withdrawBtn.style.display = getConnectedAddress() ? "inline-flex" : "none";
  withdrawBtn.toggleAttribute("disabled", busy || currentWithdrawable === 0n);

  gates.innerHTML = "";
  for (const milestone of activeMilestones) {
    gates.appendChild(renderGate(activeGrant, milestone));
  }
}

function renderGate(grant: GrantState, milestone: MilestoneState): HTMLElement {
  const el = document.createElement("div");
  el.className = `gate ${STATUS[milestone.status].toLowerCase()}`;
  const connectedAddress = getConnectedAddress();
  const isConnectedGrantee = normalizeAddress(grant.grantee) === normalizeAddress(connectedAddress);
  const canSubmit = isConnectedGrantee && (milestone.status === 0 || milestone.status === 3) && grant.status === 0;
  const canReview = milestone.status === 1 && grant.status === 0;

  el.innerHTML = `
    <div class="rail"><div class="dot"></div></div>
    <div class="gate-body">
      <div class="gate-top">
        <p class="gate-desc">${escapeHtml(milestone.description)}</p>
        <span class="gate-pay">${formatGen(milestone.payout)} · <span class="badge">${STATUS[milestone.status]}</span></span>
      </div>
      ${milestone.evidence_url ? `<div class="gate-reason"><span class="conf">evidence:</span> ${escapeHtml(milestone.evidence_url)}</div>` : ""}
      ${
        canSubmit
          ? `
        <div class="gate-actions">
          <input placeholder="https://... proof for this milestone" data-url="${milestone.index}" value="${escapeHtml(
            milestone.evidence_url
          )}" />
          <button data-submit="${milestone.index}">Submit evidence</button>
        </div>`
          : ""
      }
      ${
        canReview
          ? `
        <div class="gate-actions">
          <button data-review="${milestone.index}">Request AI review</button>
        </div>
        <div class="reviewing" data-rev="${milestone.index}"><span class="spin"></span><span>Reviewer reading the page and deliberating on-chain...</span></div>`
          : ""
      }
      ${
        milestone.reason
          ? `<div class="gate-reason">${escapeHtml(milestone.reason)} <span class="conf">(confidence ${milestone.confidence}/100)</span></div>`
          : ""
      }
    </div>`;

  const submitButton = el.querySelector<HTMLButtonElement>("[data-submit]");
  if (submitButton) {
    submitButton.addEventListener("click", async () => {
      const input = el.querySelector<HTMLInputElement>(`[data-url="${milestone.index}"]`);
      const evidenceUrl = input?.value.trim() ?? "";
      if (!evidenceUrl) {
        window.alert("Add an evidence URL first.");
        return;
      }

      await runAction(`Submitting evidence for milestone ${milestone.index + 1}...`, async () => {
        await ensureWalletReady();
        const result = await submitMilestone(grant.id, milestone.index, evidenceUrl);
        setLedgerNotice(`Evidence submitted in ${shortHash(result.txHash)}.`);
        await loadGrantFromChain(grant.id);
        setStatus(`Evidence submitted on ${config.network}.`, "ok");
      });
    });
  }

  const reviewButton = el.querySelector<HTMLButtonElement>("[data-review]");
  if (reviewButton) {
    reviewButton.addEventListener("click", async () => {
      const reviewing = el.querySelector<HTMLElement>(`[data-rev="${milestone.index}"]`);
      reviewing?.classList.add("show");
      await runAction(`Requesting AI review for milestone ${milestone.index + 1}...`, async () => {
        await ensureWalletReady();
        const result = await reviewMilestone(grant.id, milestone.index);
        setLedgerNotice(`Review finalized in ${shortHash(result.txHash)}.`);
        await loadGrantFromChain(grant.id);
        setStatus(`Milestone ${milestone.index + 1} reviewed on-chain.`, "ok");
      }).finally(() => {
        reviewing?.classList.remove("show");
      });
    });
  }

  return el;
}

async function ensureWalletReady(): Promise<string> {
  const existing = getConnectedAddress();
  if (existing) {
    return existing;
  }

  return connectWallet();
}

async function connectWallet(): Promise<string> {
  const address = await connectAccount();
  updateWalletUi(address);
  await refreshWithdrawable();
  renderLedger();
  setStatus(`Wallet connected on ${config.network}: ${short(address)}.`, "ok");
  return address;
}

async function runAction(message: string, fn: () => Promise<void>): Promise<void> {
  try {
    setBusy(true);
    setStatus(message);
    await fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus(detail, "warn");
    setLedgerNotice(detail);
    window.alert(detail);
  } finally {
    setBusy(false);
    renderLedger();
  }
}

function collectCreateForm(): {
  title: string;
  grantee: string;
  descriptions: string[];
  payouts: bigint[];
  total: bigint;
} {
  const title = $("gTitle").value.trim();
  const grantee = $("gGrantee").value.trim();
  const descriptions = [...document.querySelectorAll<HTMLInputElement>(".ms-desc")].map((input) => input.value.trim());
  const payoutInputs = [...document.querySelectorAll<HTMLInputElement>(".ms-pay")].map((input) => input.value.trim());

  if (!title) {
    throw new Error("Grant title required.");
  }
  if (!grantee) {
    throw new Error("Grantee address required.");
  }
  if (descriptions.some((description) => !description)) {
    throw new Error("Every milestone needs a deliverable.");
  }
  if (payoutInputs.some((value) => !value)) {
    throw new Error("Every milestone needs a payout in GEN.");
  }

  const payouts = payoutInputs.map((value) => parseUnits(value, GEN_DECIMALS));
  if (payouts.some((payout) => payout <= 0n)) {
    throw new Error("Every milestone needs a payout greater than zero.");
  }

  const total = payouts.reduce((sum, payout) => sum + payout, 0n);
  return { title, grantee, descriptions, payouts, total };
}

function addMilestoneRow(): void {
  const row = document.createElement("div");
  row.className = "ms-row";
  row.innerHTML =
    '<input class="ms-desc" placeholder="Deliverable"/>' +
    '<input class="ms-pay" type="number" min="0" step="0.01" placeholder="GEN" value="50"/>';
  $("msList").appendChild(row);
}

async function boot(): Promise<void> {
  $("net").textContent = `Network: ${config.network}`;
  $("contractMeta").textContent = `Contract: ${short(config.contractAddress)}`;
  $("rpcMeta").textContent = config.rpcUrl;
  updateWalletUi(null);
  setLedgerNotice("");

  $("addMs").addEventListener("click", addMilestoneRow);

  $("connectBtn").addEventListener("click", () => {
    runAction(`Connecting wallet to ${config.network}...`, async () => {
      await connectWallet();
    });
  });

  $("createBtn").addEventListener("click", () => {
    runAction("Creating grant on-chain...", async () => {
      await ensureWalletReady();
      const { title, grantee, descriptions, payouts, total } = collectCreateForm();
      const result = await createGrant(title, grantee, descriptions, payouts, total);
      setLedgerNotice(`Grant created in ${shortHash(result.txHash)}.`);
      await loadGrantFromChain(result.grantId);
      setStatus(`Grant #${result.grantId} created on ${config.network}.`, "ok");
    });
  });

  $("loadBtn").addEventListener("click", () => {
    runAction("Loading live grant state...", async () => {
      const value = $("loadId").value.trim();
      if (!value) {
        throw new Error("Enter a grant ID to load.");
      }
      await loadGrantFromChain(Number(value));
      setStatus(`Loaded grant #${value} from ${config.network}.`, "ok");
    });
  });

  $("cancelBtn").addEventListener("click", () => {
    if (!activeGrantId) {
      return;
    }

    runAction(`Canceling grant #${activeGrantId}...`, async () => {
      await ensureWalletReady();
      const result = await cancelGrant(activeGrantId);
      setLedgerNotice(`Grant canceled in ${shortHash(result.txHash)}.`);
      await loadGrantFromChain(activeGrantId);
      setStatus(`Grant #${activeGrantId} canceled on-chain.`, "ok");
    });
  });

  $("withdrawBtn").addEventListener("click", () => {
    runAction("Withdrawing available balance...", async () => {
      await ensureWalletReady();
      const result = await withdraw();
      setLedgerNotice(`Withdrawal submitted in ${shortHash(result.txHash)}.`);
      await refreshWithdrawable();
      if (activeGrantId !== null) {
        await loadGrantFromChain(activeGrantId);
      }
      setStatus("Withdrawal finalized on-chain.", "ok");
    });
  });

  await initializeContract();
  const restored = await restoreWalletConnection();
  updateWalletUi(restored);
  await refreshWithdrawable();
  renderLedger();

  if (!isWalletAvailable()) {
    setStatus(`Live contract ready on ${config.network}. Reads work now; writes need MetaMask.`, "warn");
    return;
  }

  if (restored) {
    setStatus(`Live contract ready on ${config.network}. Wallet ${short(restored)} restored.`, "ok");
    return;
  }

  setStatus(`Live contract ready on ${config.network}. Connect your wallet to create or update grants.`, "ok");
}

boot().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  setStatus(detail, "warn");
  setLedgerNotice(detail);
});
