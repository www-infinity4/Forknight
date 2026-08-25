import type { Outcome } from "./types";

export type QuestStage = "research" | "extraction" | "review" | "publish" | "verify";
export type EvidenceStatus = "verified" | "unavailable" | "failed";
export type Readiness = "red" | "yellow" | "green";

export interface ModuleEvidence {
  readonly moduleId: string;
  readonly status: EvidenceStatus;
  /** Caller-computed SHA-256 digest. QuestMaster never hashes or fetches evidence. */
  readonly digest?: string;
}

export interface ScenarioStep {
  readonly stepId: string;
  readonly stage: QuestStage;
  readonly dependsOn: readonly string[];
  readonly moduleEvidence: ModuleEvidence;
  readonly expectedOutput: string;
  readonly observedOutput?: string;
  readonly externalEvidence?: string;
  readonly humanApproval?: { readonly approved: boolean; readonly evidence: string };
  readonly rollbackEvidence?: string;
}

export interface QuestMasterInput {
  readonly scenarioId: string;
  readonly steps: readonly ScenarioStep[];
}

export interface StepVerdict {
  readonly stepId: string;
  readonly stage: QuestStage;
  readonly readiness: Readiness;
  readonly verdict: "verified" | "blocked" | "rejected";
  readonly reasons: readonly string[];
}

export interface QuestMasterResult {
  readonly outcome: Outcome;
  readonly verdict: "verified" | "blocked" | "rejected";
  readonly readiness: Readiness;
  readonly reasons: readonly string[];
  readonly steps: readonly StepVerdict[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const STAGES: readonly QuestStage[] = ["research", "extraction", "review", "publish", "verify"];
const MAX_STEPS = 500;
const MAX_DEPENDENCIES = 100;
const MAX_TEXT = 65_536;
const MAX_TOTAL_TEXT = 2_000_000;

function privateText(value: string | undefined): boolean {
  return value !== undefined && (SECRET.test(value) || EMAIL.test(value));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Evaluates supplied evidence only. It never runs steps, modules, publishing, or rollback. */
export function evaluateQuest(input: QuestMasterInput): QuestMasterResult {
  const invalid: string[] = [];
  let totalText = input.scenarioId.length;
  if (!ID.test(input.scenarioId)) invalid.push("invalid_scenario_id");
  if (input.steps.length === 0 || input.steps.length > MAX_STEPS) invalid.push("invalid_step_count");
  const ids = new Set<string>();
  const moduleEvidence = new Map<string, ModuleEvidence>();
  for (const step of input.steps) {
    const texts = [step.stepId, step.moduleEvidence.moduleId, step.expectedOutput,
      step.observedOutput, step.externalEvidence, step.humanApproval?.evidence, step.rollbackEvidence];
    totalText += texts.reduce((sum, text) => sum + (text?.length ?? 0), 0);
    if (!ID.test(step.stepId)) invalid.push("invalid_step_id");
    if (ids.has(step.stepId)) invalid.push("duplicate_step_id");
    ids.add(step.stepId);
    if (!STAGES.includes(step.stage)) invalid.push("invalid_stage");
    if (!ID.test(step.moduleEvidence.moduleId)) invalid.push("invalid_module_id");
    if (!(["verified", "unavailable", "failed"] as const).includes(step.moduleEvidence.status)) invalid.push("invalid_evidence_status");
    if (step.moduleEvidence.digest !== undefined && !DIGEST.test(step.moduleEvidence.digest)) invalid.push("invalid_evidence_digest");
    const priorEvidence = moduleEvidence.get(step.moduleEvidence.moduleId);
    if (priorEvidence !== undefined && (priorEvidence.status !== step.moduleEvidence.status
      || priorEvidence.digest !== step.moduleEvidence.digest)) invalid.push("conflicting_module_evidence");
    else if (priorEvidence === undefined) moduleEvidence.set(step.moduleEvidence.moduleId, step.moduleEvidence);
    if (step.dependsOn.length > MAX_DEPENDENCIES || new Set(step.dependsOn).size !== step.dependsOn.length || !step.dependsOn.every((id) => ID.test(id))) invalid.push("invalid_dependencies");
    if (texts.some((text) => (text?.length ?? 0) > MAX_TEXT)) invalid.push("text_too_long");
    if (texts.some(privateText)) invalid.push("secret_or_pii_detected");
  }
  if (totalText > MAX_TOTAL_TEXT) invalid.push("total_text_too_large");

  const byId = new Map(input.steps.map((step) => [step.stepId, step]));
  for (const stage of STAGES) {
    if (!input.steps.some((step) => step.stage === stage)) invalid.push(`missing_${stage}_stage`);
  }
  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    if (step === undefined) continue;
    const stageIndex = STAGES.indexOf(step.stage);
    if (index > 0) {
      const previous = input.steps[index - 1];
      if (previous !== undefined && STAGES.indexOf(previous.stage) > stageIndex) invalid.push("out_of_order_stage");
    }
    for (const dependencyId of step.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined) invalid.push("unknown_dependency");
      else if (STAGES.indexOf(dependency.stage) > stageIndex) invalid.push("out_of_order_dependency");
      if (input.steps.findIndex((item) => item.stepId === dependencyId) >= index) invalid.push("dependency_not_preceding_step");
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const found = byId.get(id)?.dependsOn.some((dependency) => byId.has(dependency) && cycle(dependency)) ?? false;
    visiting.delete(id); visited.add(id);
    return found;
  };
  if (input.steps.some((step) => cycle(step.stepId))) invalid.push("dependency_cycle");

  if (invalid.length > 0) return freeze({ outcome: "rejected", verdict: "rejected", readiness: "red", reasons: sorted(invalid), steps: [] });

  const verdicts: StepVerdict[] = [];
  const states = new Map<string, StepVerdict>();
  for (const step of input.steps) {
    const reasons: string[] = [];
    let verdict: StepVerdict["verdict"] = "verified";
    if (step.dependsOn.some((id) => states.get(id)?.verdict === "rejected")) {
      verdict = "rejected"; reasons.push("dependency_rejected");
    } else if (step.dependsOn.some((id) => states.get(id)?.verdict === "blocked")) {
      verdict = "blocked"; reasons.push("dependency_blocked");
    }
    if (step.moduleEvidence.status === "failed") { verdict = "rejected"; reasons.push("module_evidence_failed"); }
    else if (step.moduleEvidence.status === "unavailable" || step.moduleEvidence.digest === undefined) {
      if (verdict !== "rejected") verdict = "blocked";
      reasons.push("module_evidence_missing");
    }
    if (step.externalEvidence === undefined || step.externalEvidence.trim() === "") {
      if (verdict !== "rejected") verdict = "blocked";
      reasons.push("external_evidence_missing");
    }
    if (step.observedOutput === undefined) {
      if (verdict !== "rejected") verdict = "blocked";
      reasons.push("observed_output_missing");
    } else if (step.observedOutput !== step.expectedOutput) {
      verdict = "rejected"; reasons.push("output_mismatch");
    }
    if (step.stage === "publish") {
      if (step.humanApproval === undefined || step.humanApproval.evidence.trim() === "") {
        verdict = "rejected"; reasons.push("publish_approval_missing");
      } else if (!step.humanApproval.approved) {
        verdict = "rejected"; reasons.push("publish_not_approved");
      }
      if (step.rollbackEvidence === undefined || step.rollbackEvidence.trim() === "") {
        verdict = "rejected"; reasons.push("rollback_evidence_missing");
      }
    }
    const item: StepVerdict = { stepId: step.stepId, stage: step.stage, verdict,
      readiness: verdict === "verified" ? "green" : verdict === "blocked" ? "yellow" : "red", reasons: sorted(reasons) };
    verdicts.push(item); states.set(step.stepId, item);
  }
  const verdict = verdicts.some((step) => step.verdict === "rejected") ? "rejected"
    : verdicts.some((step) => step.verdict === "blocked") ? "blocked" : "verified";
  return freeze({ outcome: verdict, verdict, readiness: verdict === "verified" ? "green" : verdict === "blocked" ? "yellow" : "red",
    reasons: sorted(verdicts.flatMap((step) => step.reasons)), steps: verdicts });
}
