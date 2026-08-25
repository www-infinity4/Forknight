import type { Outcome } from "./types";

export interface LorePredicate {
  readonly subject: string;
  readonly relation: string;
  readonly object: string;
}

export interface LoreStatement {
  readonly id: string;
  readonly projectId: string;
  readonly predicate: LorePredicate;
  readonly sourceDigest: string;
  readonly evidenceAvailable: boolean;
  readonly supersedes?: readonly string[];
}

export interface LoreKeeperInput {
  readonly projectId: string;
  /** Undefined means that the canonical record was not supplied. */
  readonly canon: readonly LoreStatement[] | undefined;
  readonly candidates: readonly LoreStatement[];
}

export interface LoreContradiction {
  readonly candidateId: string;
  readonly conflictsWithId: string;
  readonly subject: string;
  readonly relation: string;
}

export interface LoreKeeperResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly acceptedFacts?: readonly LoreStatement[];
  readonly contradictions?: readonly LoreContradiction[];
  readonly canon?: readonly LoreStatement[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_STATEMENTS = 100;
const MAX_OBJECT = 512;

function invalid(statement: LoreStatement): boolean {
  return !ID.test(statement.id) || !ID.test(statement.projectId) ||
    !ID.test(statement.predicate.subject) || !ID.test(statement.predicate.relation) ||
    statement.predicate.object.length === 0 || statement.predicate.object.length > MAX_OBJECT ||
    /[\u0000-\u001f\u007f]/.test(statement.predicate.object) || !DIGEST.test(statement.sourceDigest) ||
    (statement.supersedes ?? []).some((id) => !ID.test(id));
}

function fingerprint(statement: LoreStatement): string {
  return `${statement.projectId}\u0000${statement.predicate.subject}\u0000${statement.predicate.relation}\u0000${statement.predicate.object}\u0000${statement.sourceDigest}\u0000${statement.evidenceAvailable}\u0000${[...(statement.supersedes ?? [])].sort().join("\u0001")}`;
}

function clone(statement: LoreStatement): LoreStatement {
  return {
    id: statement.id,
    projectId: statement.projectId,
    predicate: { ...statement.predicate },
    sourceDigest: statement.sourceDigest,
    evidenceAvailable: statement.evidenceAvailable,
    ...(statement.supersedes === undefined ? {} : { supersedes: [...new Set(statement.supersedes)].sort() }),
  };
}

function uniqueById(values: readonly LoreStatement[]): { values: LoreStatement[]; conflict: boolean } {
  const found = new Map<string, LoreStatement>();
  let conflict = false;
  for (const value of values) {
    const prior = found.get(value.id);
    if (prior !== undefined && fingerprint(prior) !== fingerprint(value)) conflict = true;
    else if (prior === undefined) found.set(value.id, clone(value));
  }
  return { values: [...found.values()].sort((a, b) => a.id.localeCompare(b.id)), conflict };
}

function sameSlot(a: LoreStatement, b: LoreStatement): boolean {
  return a.projectId === b.projectId && a.predicate.subject === b.predicate.subject &&
    a.predicate.relation === b.predicate.relation && a.predicate.object !== b.predicate.object;
}

/**
 * Compares exact caller-supplied predicates. It performs no semantic inference,
 * source retrieval, model calls, or rewriting of canonical facts.
 */
export function reviewLore(input: LoreKeeperInput): LoreKeeperResult {
  if (!ID.test(input.projectId)) return { outcome: "rejected", reasons: ["invalid_project_id"] };
  if (input.canon === undefined) return { outcome: "blocked", reasons: ["canon_unavailable"] };
  if (input.canon.length > MAX_STATEMENTS || input.candidates.length > MAX_STATEMENTS) {
    return { outcome: "rejected", reasons: ["statement_limit_exceeded"] };
  }
  if ([...input.canon, ...input.candidates].some(invalid)) {
    return { outcome: "rejected", reasons: ["malformed_statement"] };
  }
  if ([...input.canon, ...input.candidates].some((item) => item.projectId !== input.projectId)) {
    return { outcome: "rejected", reasons: ["project_scope_mismatch"] };
  }

  const canon = uniqueById(input.canon);
  const candidates = uniqueById(input.candidates);
  if (canon.conflict) return { outcome: "rejected", reasons: ["conflicting_canon_id"] };
  if (candidates.conflict) return { outcome: "rejected", reasons: ["conflicting_candidate_id"] };
  const canonById = new Map(canon.values.map((item) => [item.id, item]));
  if (candidates.values.some((item) => canonById.has(item.id))) {
    return { outcome: "rejected", reasons: ["candidate_id_already_in_canon"] };
  }
  if (canon.values.some((item) => !item.evidenceAvailable)) {
    return { outcome: "blocked", reasons: ["canon_evidence_unavailable"] };
  }
  if (candidates.values.some((item) => !item.evidenceAvailable)) {
    return { outcome: "blocked", reasons: ["candidate_source_evidence_unavailable"] };
  }

  const knownIds = new Set([...canon.values, ...candidates.values].map((item) => item.id));
  if (candidates.values.some((item) => (item.supersedes ?? []).some((id) => !knownIds.has(id) || id === item.id))) {
    return { outcome: "rejected", reasons: ["invalid_supersedes_reference"] };
  }

  const candidateIds = new Set(candidates.values.map((item) => item.id));
  const edges = new Map(candidates.values.map((item) => [
    item.id,
    (item.supersedes ?? []).filter((id) => candidateIds.has(id)),
  ]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) {
      if (cyclic(target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (candidates.values.some((item) => cyclic(item.id))) {
    return { outcome: "rejected", reasons: ["supersedes_cycle"] };
  }

  const contradictions: LoreContradiction[] = [];
  for (const candidate of candidates.values) {
    for (const existing of [...canon.values, ...candidates.values]) {
      if (candidate.id === existing.id || !sameSlot(candidate, existing)) continue;
      if ((candidate.supersedes ?? []).includes(existing.id) || (existing.supersedes ?? []).includes(candidate.id)) continue;
      contradictions.push({
        candidateId: candidate.id,
        conflictsWithId: existing.id,
        subject: candidate.predicate.subject,
        relation: candidate.predicate.relation,
      });
    }
  }
  const report = contradictions.sort((a, b) =>
    a.candidateId.localeCompare(b.candidateId) || a.conflictsWithId.localeCompare(b.conflictsWithId));
  if (report.length > 0) {
    return { outcome: "rejected", reasons: ["candidate_contradiction"], contradictions: report, canon: canon.values };
  }
  return {
    outcome: "verified",
    reasons: ["exact_predicates_validated"],
    acceptedFacts: candidates.values,
    contradictions: [],
    canon: canon.values,
  };
}
