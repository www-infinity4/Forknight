import type { Outcome } from "./types";

export interface WalletRequest {
  proposalId: string;
  chainId: string;
  assetId: string;
  amount: string;
  destination: string;
  requestedBy: string;
  memo?: string;
}

export interface WalletPolicy {
  assetDecimals: number;
  maximumAmount: string;
  allowedDestinations: readonly string[];
  requiredApprovals: number;
  allowedApprovers: readonly string[];
}

export interface WalletObservation {
  availableBalance: string;
}

export interface WalletProposal {
  proposalId: string;
  chainId: string;
  assetId: string;
  amount: string;
  amountInBaseUnits: string;
  destination: string;
  requestedBy: string;
  memo?: string;
  requiredApprovals: number;
  allowedApprovers: readonly string[];
  kind: "unsigned_transaction_proposal";
}

export interface ProposalResult {
  outcome: Outcome;
  reasons: string[];
  proposal?: WalletProposal;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalState {
  proposalId: string;
  status: ApprovalStatus;
  requiredApprovals: number;
  approvals: readonly string[];
  allowedApprovers: readonly string[];
  requestedBy: string;
  rejectedBy?: string;
  rejectionReason?: string;
}

export type ApprovalAction =
  | {
      type: "approve";
      actorId: string;
      actorKind: "human" | "ai" | "automation";
    }
  | {
      type: "reject";
      actorId: string;
      actorKind: "human" | "ai" | "automation";
      reason: string;
    };

export interface ApprovalResult {
  outcome: Outcome;
  reasons: string[];
  state?: ApprovalState;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

function toBaseUnits(value: string, decimals: number): bigint | undefined {
  if (!DECIMAL_AMOUNT.test(value) || decimals < 0 || decimals > 30) {
    return undefined;
  }

  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    return undefined;
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  const digits = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "");

  try {
    return BigInt(digits);
  } catch {
    return undefined;
  }
}

export function createWalletProposal(
  request: WalletRequest,
  policy: WalletPolicy | undefined,
  observation: WalletObservation | undefined,
): ProposalResult {
  const malformed: string[] = [];

  if (!validIdentifier(request.proposalId)) malformed.push("invalid_proposal_id");
  if (!validIdentifier(request.chainId)) malformed.push("invalid_chain_id");
  if (!validIdentifier(request.assetId)) malformed.push("invalid_asset_id");
  if (!validIdentifier(request.requestedBy)) malformed.push("invalid_requester");
  if (
    request.destination.length === 0 ||
    request.destination.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(request.destination)
  ) {
    malformed.push("invalid_destination");
  }
  if (request.memo !== undefined && request.memo.length > 280) {
    malformed.push("memo_too_long");
  }
  if (!DECIMAL_AMOUNT.test(request.amount)) malformed.push("invalid_amount");

  if (malformed.length > 0) return { outcome: "rejected", reasons: malformed };
  if (policy === undefined) {
    return { outcome: "blocked", reasons: ["wallet_policy_unavailable"] };
  }
  if (observation === undefined) {
    return { outcome: "blocked", reasons: ["balance_observation_unavailable"] };
  }

  if (
    !Number.isInteger(policy.assetDecimals) ||
    policy.assetDecimals < 0 ||
    policy.assetDecimals > 30 ||
    !Number.isInteger(policy.requiredApprovals) ||
    policy.requiredApprovals < 1
  ) {
    return { outcome: "blocked", reasons: ["wallet_policy_invalid"] };
  }

  const amount = toBaseUnits(request.amount, policy.assetDecimals);
  const maximum = toBaseUnits(policy.maximumAmount, policy.assetDecimals);
  const balance = toBaseUnits(observation.availableBalance, policy.assetDecimals);

  if (maximum === undefined || maximum <= 0n) {
    return { outcome: "blocked", reasons: ["wallet_policy_invalid"] };
  }
  if (balance === undefined || balance < 0n) {
    return { outcome: "blocked", reasons: ["balance_observation_invalid"] };
  }
  if (amount === undefined || amount <= 0n) {
    return { outcome: "rejected", reasons: ["amount_must_be_positive"] };
  }

  const violations: string[] = [];
  if (!policy.allowedDestinations.includes(request.destination)) {
    violations.push("destination_not_allowed");
  }
  if (amount > maximum) violations.push("amount_exceeds_policy_limit");
  if (amount > balance) violations.push("insufficient_observed_balance");

  const approvers = [...new Set(policy.allowedApprovers)].sort();
  if (
    approvers.some((approver) => !validIdentifier(approver)) ||
    policy.requiredApprovals > approvers.length
  ) {
    return { outcome: "blocked", reasons: ["approval_policy_not_satisfiable"] };
  }

  if (violations.length > 0) return { outcome: "rejected", reasons: violations };

  const proposal: WalletProposal = {
    proposalId: request.proposalId,
    chainId: request.chainId,
    assetId: request.assetId,
    amount: request.amount,
    amountInBaseUnits: amount.toString(),
    destination: request.destination,
    requestedBy: request.requestedBy,
    requiredApprovals: policy.requiredApprovals,
    allowedApprovers: approvers,
    kind: "unsigned_transaction_proposal",
    ...(request.memo === undefined ? {} : { memo: request.memo }),
  };

  return {
    outcome: "verified",
    reasons: ["unsigned_proposal_validated"],
    proposal,
  };
}

export function createApprovalState(proposal: WalletProposal): ApprovalState {
  return {
    proposalId: proposal.proposalId,
    status: "pending",
    requiredApprovals: proposal.requiredApprovals,
    approvals: [],
    allowedApprovers: [...proposal.allowedApprovers],
    requestedBy: proposal.requestedBy,
  };
}

export function transitionApproval(
  current: ApprovalState,
  action: ApprovalAction,
): ApprovalResult {
  if (current.status !== "pending") {
    return { outcome: "rejected", reasons: ["approval_state_is_terminal"] };
  }
  if (action.actorKind !== "human") {
    return {
      outcome: "rejected",
      reasons: ["only_humans_may_approve_or_reject"],
    };
  }
  if (!current.allowedApprovers.includes(action.actorId)) {
    return { outcome: "rejected", reasons: ["actor_not_authorized"] };
  }
  if (action.actorId === current.requestedBy) {
    return {
      outcome: "rejected",
      reasons: ["requester_cannot_approve_own_proposal"],
    };
  }

  if (action.type === "reject") {
    const reason = action.reason.trim();
    if (reason.length === 0 || reason.length > 280) {
      return { outcome: "rejected", reasons: ["invalid_rejection_reason"] };
    }
    return {
      outcome: "verified",
      reasons: ["proposal_rejected_by_human"],
      state: {
        ...current,
        status: "rejected",
        rejectedBy: action.actorId,
        rejectionReason: reason,
      },
    };
  }

  if (current.approvals.includes(action.actorId)) {
    return { outcome: "rejected", reasons: ["duplicate_approval"] };
  }

  const approvals = [...current.approvals, action.actorId].sort();
  const status: ApprovalStatus =
    approvals.length >= current.requiredApprovals ? "approved" : "pending";

  return {
    outcome: "verified",
    reasons: [status === "approved" ? "approval_quorum_reached" : "approval_recorded"],
    state: { ...current, status, approvals },
  };
}
