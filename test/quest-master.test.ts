import { describe, expect, it } from "vitest";
import { evaluateQuest, type QuestMasterInput, type ScenarioStep } from "../src/quest-master";

const digest = "a".repeat(64);
const step = (stepId: string, stage: ScenarioStep["stage"], dependsOn: readonly string[]): ScenarioStep => ({
  stepId, stage, dependsOn, moduleEvidence: { moduleId: `${stage}-bot`, status: "verified", digest },
  expectedOutput: `${stage}-result`, observedOutput: `${stage}-result`, externalEvidence: `${stage}-evidence`,
  ...(stage === "publish" ? { humanApproval: { approved: true, evidence: "approval-record" }, rollbackEvidence: "rollback-plan" } : {}),
});
const flow: QuestMasterInput = { scenarioId: "quest-20", steps: [
  step("s1", "research", []), step("s2", "extraction", ["s1"]), step("s3", "review", ["s2"]),
  step("s4", "publish", ["s3"]), step("s5", "verify", ["s4"]),
] };

describe("evaluateQuest", () => {
  it("verifies a complete end-to-end flow without mutating input", () => {
    const before = JSON.stringify(flow); const result = evaluateQuest(flow);
    expect(result.verdict).toBe("verified"); expect(result.readiness).toBe("green");
    expect(result.steps.every((item) => item.readiness === "green")).toBe(true);
    expect(result).toEqual(evaluateQuest(flow)); expect(JSON.stringify(flow)).toBe(before);
    expect(Object.isFrozen(result.steps)).toBe(true);
  });
  it("blocks unavailable external or module evidence", () => {
    const missing = { ...flow, steps: [{ ...flow.steps[0]!, externalEvidence: undefined,
      moduleEvidence: { moduleId: "research-bot", status: "unavailable" as const } }, ...flow.steps.slice(1)] };
    const result = evaluateQuest(missing); expect(result.verdict).toBe("blocked");
    expect(result.steps[0]).toMatchObject({ readiness: "yellow", verdict: "blocked" });
  });
  it("rejects failed evidence and propagates red dependencies", () => {
    const failed = { ...flow, steps: [{ ...flow.steps[0]!, moduleEvidence: { ...flow.steps[0]!.moduleEvidence, status: "failed" as const } }, ...flow.steps.slice(1)] };
    const result = evaluateQuest(failed); expect(result.verdict).toBe("rejected");
    expect(result.steps[0]!.reasons).toContain("module_evidence_failed"); expect(result.steps[1]!.reasons).toContain("dependency_rejected");
  });
  it("requires exact observed output", () => {
    const result = evaluateQuest({ ...flow, steps: [{ ...flow.steps[0]!, observedOutput: "different" }, ...flow.steps.slice(1)] });
    expect(result.steps[0]).toMatchObject({ readiness: "red", reasons: ["output_mismatch"] });
  });
  it("rejects publish without human approval or rollback evidence", () => {
    const publish = { ...flow.steps[3]!, humanApproval: { approved: false, evidence: "denial-record" }, rollbackEvidence: undefined };
    const result = evaluateQuest({ ...flow, steps: [...flow.steps.slice(0, 3), publish, flow.steps[4]!] });
    expect(result.steps[3]!.reasons).toEqual(["publish_not_approved", "rollback_evidence_missing"]);
  });
  it("rejects duplicate IDs, cycles, and stage order violations", () => {
    expect(evaluateQuest({ scenarioId: "q", steps: [step("same", "research", []), step("same", "review", [])] }).reasons).toContain("duplicate_step_id");
    const cyclic = [step("a", "research", ["b"]), step("b", "research", ["a"])];
    expect(evaluateQuest({ scenarioId: "q", steps: cyclic }).reasons).toContain("dependency_cycle");
    expect(evaluateQuest({ scenarioId: "q", steps: [step("p", "publish", []), step("r", "research", [])] }).reasons).toContain("out_of_order_stage");
  });
  it("rejects secrets and bounded-input violations", () => {
    expect(evaluateQuest({ scenarioId: "q", steps: [{ ...step("a", "research", []), externalEvidence: "token=secret-value" }] }).reasons).toContain("secret_or_pii_detected");
    expect(evaluateQuest({ scenarioId: "q", steps: Array.from({ length: 501 }, (_, i) => step(`s${i}`, "research", [])) }).reasons).toContain("invalid_step_count");
  });
  it("allows identical module evidence across steps", () => {
    const shared = { moduleId: "shared-bot", status: "verified" as const, digest };
    const steps = flow.steps.map((item) => ({ ...item, moduleEvidence: shared }));
    expect(evaluateQuest({ ...flow, steps }).verdict).toBe("verified");
  });
  it("rejects conflicting status or digest claims for one module", () => {
    const shared = { moduleId: "shared-bot", status: "verified" as const, digest };
    const changedStatus = flow.steps.map((item, index) => ({ ...item,
      moduleEvidence: index === 1 ? { ...shared, status: "failed" as const } : shared }));
    expect(evaluateQuest({ ...flow, steps: changedStatus }).reasons).toContain("conflicting_module_evidence");
    const changedDigest = flow.steps.map((item, index) => ({ ...item,
      moduleEvidence: index === 2 ? { ...shared, digest: "b".repeat(64) } : shared }));
    expect(evaluateQuest({ ...flow, steps: changedDigest }).reasons).toContain("conflicting_module_evidence");
  });
});
