import { describe, expect, it } from "vitest";
import {
  createApprovalState,
  createWalletProposal,
  transitionApproval,
  type WalletPolicy,
  type WalletRequest,
} from "../src/vault-guard";

const request: WalletRequest = {
  proposalId: "proposal-7",
  chainId: "chain-1",
  assetId: "TOKEN",
  amount: "1.25",
  destination: "wallet:recipient",
  requestedBy: "cosmo-ai",
};

const policy: WalletPolicy = {
  assetDecimals: 2,
  maximumAmount: "10.00",
  allowedDestinations: ["wallet:recipient"],
  requiredApprovals: 2,
  allowedApprovers: ["human-b", "human-a"],
};

describe("createWalletProposal", () => {
  it("creates the same unsigned proposal for the same evidence", () => {
    const first = createWalletProposal(request, policy, { availableBalance: "4.00" });
    const second = createWalletProposal(request, policy, { availableBalance: "4.00" });

    expect(first).toEqual(second);
    expect(first.outcome).toBe("verified");
    expect(first.proposal?.amountInBaseUnits).toBe("125");
    expect(first.proposal?.allowedApprovers).toEqual(["human-a", "human-b"]);
  });

  it("blocks when required external evidence is unavailable", () => {
    expect(createWalletProposal(request, undefined, undefined)).toEqual({
      outcome: "blocked",
      reasons: ["wallet_policy_unavailable"],
    });
  });

  it("rejects a policy violation without producing a proposal", () => {
    const result = createWalletProposal(
      { ...request, amount: "11.00" },
      policy,
      { availableBalance: "20.00" },
    );

    expect(result.outcome).toBe("rejected");
    expect(result.proposal).toBeUndefined();
    expect(result.reasons).toContain("amount_exceeds_policy_limit");
  });
});

describe("transitionApproval", () => {
  it("rejects AI approval and self-approval", () => {
    const proposal = createWalletProposal(request, policy, {
      availableBalance: "4.00",
    }).proposal!;
    const state = createApprovalState(proposal);

    expect(
      transitionApproval(state, {
        type: "approve",
        actorId: "human-a",
        actorKind: "ai",
      }).reasons,
    ).toEqual(["only_humans_may_approve_or_reject"]);

    expect(
      transitionApproval(
        { ...state, requestedBy: "human-a" },
        { type: "approve", actorId: "human-a", actorKind: "human" },
      ).reasons,
    ).toEqual(["requester_cannot_approve_own_proposal"]);
  });

  it("reaches quorum without mutating prior states", () => {
    const proposal = createWalletProposal(request, policy, {
      availableBalance: "4.00",
    }).proposal!;
    const initial = createApprovalState(proposal);
    const first = transitionApproval(initial, {
      type: "approve",
      actorId: "human-b",
      actorKind: "human",
    });
    const second = transitionApproval(first.state!, {
      type: "approve",
      actorId: "human-a",
      actorKind: "human",
    });

    expect(initial.approvals).toEqual([]);
    expect(first.state?.status).toBe("pending");
    expect(second.state?.status).toBe("approved");
    expect(second.state?.approvals).toEqual(["human-a", "human-b"]);
  });
});
