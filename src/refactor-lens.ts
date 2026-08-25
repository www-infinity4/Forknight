import type { Outcome } from "./types";

export type DebtSeverity = "critical" | "high" | "medium" | "low";
export type EvidenceConfidence = "confirmed" | "suggested";
export type SourceScope = "repository" | "declared-dependency";

export interface StaticCodeObservation {
  readonly filePath: string;
  readonly fileDigest: string;
  readonly rule: string;
  readonly evidence: string;
  readonly confidence: EvidenceConfidence;
  readonly severity: DebtSeverity;
  readonly instruction: string;
  readonly sourceScope: SourceScope;
  readonly license: string;
  readonly analyzerEvidence: boolean;
}

export interface RefactorLensInput {
  readonly observations: readonly StaticCodeObservation[];
}

export interface TechnicalDebtFinding {
  readonly rank: number;
  readonly filePath: string;
  readonly fileDigest: string;
  readonly rule: string;
  readonly severity: DebtSeverity;
  readonly confidence: EvidenceConfidence;
  readonly evidence: string;
  /** Human-reviewable instruction only. RefactorLens never rewrites or applies code. */
  readonly candidatePatchInstruction: string;
  readonly sourceScope: SourceScope;
  readonly license: string;
}

export interface RefactorLensResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly findings?: readonly TechnicalDebtFinding[];
}

const MAX_OBSERVATIONS = 500;
const MAX_TEXT = 1_000;
const MAX_PATH = 240;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RULE = /^[a-z][a-z0-9._-]{0,79}$/;
const LICENSE = /^(?:[A-Za-z0-9][A-Za-z0-9.+-]{0,63}|LicenseRef-[A-Za-z0-9.-]{1,52})$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._@+-]*)*$/;
const PRIVATE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
const SEVERITY: Readonly<Record<DebtSeverity, number>> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONFIDENCE: Readonly<Record<EvidenceConfidence, number>> = { confirmed: 0, suggested: 1 };

function validText(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TEXT && value.trim() === value && !PRIVATE.test(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function compare(a: StaticCodeObservation, b: StaticCodeObservation): number {
  return SEVERITY[a.severity] - SEVERITY[b.severity] ||
    CONFIDENCE[a.confidence] - CONFIDENCE[b.confidence] ||
    a.filePath.localeCompare(b.filePath) || a.rule.localeCompare(b.rule) ||
    a.fileDigest.localeCompare(b.fileDigest) || a.evidence.localeCompare(b.evidence) ||
    a.instruction.localeCompare(b.instruction);
}

/**
 * Ranks caller-supplied static evidence. It performs no parsing, I/O, model call,
 * clock access, randomness, code generation, rewrite, or patch application.
 */
export function evaluateRefactors(input: RefactorLensInput): RefactorLensResult {
  if (!Array.isArray(input.observations)) return { outcome: "rejected", reasons: ["invalid_observations"] };
  if (input.observations.length > MAX_OBSERVATIONS) return { outcome: "rejected", reasons: ["too_many_observations"] };

  const invalid: string[] = [];
  for (const item of input.observations) {
    if (typeof item !== "object" || item === null) { invalid.push("invalid_observation"); continue; }
    if (typeof item.filePath !== "string" || item.filePath.length > MAX_PATH || !SAFE_PATH.test(item.filePath) || PRIVATE.test(item.filePath)) invalid.push("invalid_or_private_file_path");
    if (typeof item.fileDigest !== "string" || !DIGEST.test(item.fileDigest)) invalid.push("invalid_file_digest");
    if (typeof item.rule !== "string" || !RULE.test(item.rule)) invalid.push("invalid_rule");
    if (typeof item.evidence !== "string" || !validText(item.evidence)) invalid.push("invalid_or_private_evidence");
    if (typeof item.instruction !== "string" || !validText(item.instruction)) invalid.push("invalid_or_private_instruction");
    if (!(item.confidence in CONFIDENCE)) invalid.push("invalid_confidence");
    if (!(item.severity in SEVERITY)) invalid.push("invalid_severity");
    if (item.sourceScope !== "repository" && item.sourceScope !== "declared-dependency") invalid.push("unsupported_source_scope");
    if (typeof item.license !== "string" || !LICENSE.test(item.license)) invalid.push("invalid_license");
    if (typeof item.analyzerEvidence !== "boolean") invalid.push("invalid_analyzer_evidence_flag");
  }
  if (invalid.length > 0) return { outcome: "rejected", reasons: uniqueSorted(invalid) };

  const identities = new Map<string, string>();
  for (const item of input.observations) {
    const identity = [item.filePath, item.fileDigest, item.rule].join("\u0000");
    const assessment = [item.severity, item.confidence, item.evidence, item.instruction,
      item.sourceScope, item.license, String(item.analyzerEvidence)].join("\u0000");
    const prior = identities.get(identity);
    if (prior !== undefined && prior !== assessment) {
      return { outcome: "rejected", reasons: ["conflicting_duplicate_finding"] };
    }
    identities.set(identity, assessment);
  }
  if (input.observations.length === 0 || input.observations.some((item) => !item.analyzerEvidence)) {
    return { outcome: "blocked", reasons: ["analyzer_evidence_unavailable"] };
  }

  const ordered = [...input.observations].sort(compare);
  const seen = new Set<string>();
  const deduped: StaticCodeObservation[] = [];
  for (const item of ordered) {
    const key = [item.filePath, item.fileDigest, item.rule].join("\u0000");
    if (!seen.has(key)) { seen.add(key); deduped.push(item); }
  }
  const findings = deduped.map((item, index): TechnicalDebtFinding => ({
    rank: index + 1, filePath: item.filePath, fileDigest: item.fileDigest, rule: item.rule,
    severity: item.severity, confidence: item.confidence, evidence: item.evidence,
    candidatePatchInstruction: item.instruction, sourceScope: item.sourceScope, license: item.license,
  }));
  return { outcome: "verified", reasons: [], findings };
}
