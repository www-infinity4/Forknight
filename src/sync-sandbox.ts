import type { Outcome } from "./types";

export interface SandboxState {
  readonly revisionDigest: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface ActorAuthorization {
  readonly actorId: string;
  readonly authorized: boolean;
  readonly evidence: string;
}

export interface SyncOperation {
  readonly operationId: string;
  readonly actorId: string;
  readonly sequence: number;
  readonly key: string;
  /** Value observed in the shared base; null means the key was absent. */
  readonly baseValue: string | null;
  /** null requests deletion. */
  readonly value: string | null;
}

export interface SyncSandboxInput {
  readonly base: SandboxState;
  readonly authorizations: readonly ActorAuthorization[];
  readonly operations: readonly SyncOperation[];
}

export interface SyncConflict {
  readonly key: string;
  readonly operationIds: readonly string[];
  readonly reason: "base_value_mismatch" | "competing_edits";
}

export interface SyncSandboxResult {
  readonly outcome: Outcome;
  readonly status?: "merged" | "conflicted";
  readonly candidateState?: Readonly<Record<string, string>>;
  readonly conflicts?: readonly SyncConflict[];
  readonly reasons: readonly string[];
}

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PRIVATE_TEXT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*)/i;
const MAX_OPERATIONS = 1_000;
const MAX_AUTHORIZATIONS = 1_000;
const MAX_FIELDS = 2_000;
const MAX_TEXT = 16_384;
const MAX_TOTAL_TEXT = 1_000_000;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function containsPrivateText(value: string): boolean {
  return EMAIL.test(value) || PRIVATE_TEXT.test(value);
}

/**
 * Plans a merge from caller-supplied data. It never hashes, persists, applies,
 * authorizes, or otherwise communicates outside this function.
 */
export function planSandboxSync(input: SyncSandboxInput): SyncSandboxResult {
  const reasons: string[] = [];
  const baseEvidenceMissing = input.base.revisionDigest.trim().length === 0;
  if (!baseEvidenceMissing && !DIGEST.test(input.base.revisionDigest)) reasons.push("invalid_base_revision_digest");
  if (input.operations.length > MAX_OPERATIONS) reasons.push("too_many_operations");
  if (input.authorizations.length > MAX_AUTHORIZATIONS) reasons.push("too_many_authorizations");

  const baseEntries = Object.entries(input.base.values);
  if (baseEntries.length > MAX_FIELDS) reasons.push("too_many_state_fields");
  let totalText = 0;
  for (const [key, value] of baseEntries) {
    totalText += key.length + value.length;
    if (!KEY.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") reasons.push("invalid_state_key");
    if (value.length > MAX_TEXT) reasons.push("state_value_too_long");
    if (containsPrivateText(key) || containsPrivateText(value)) reasons.push("private_state_text");
  }

  const auth = new Map<string, ActorAuthorization>();
  for (const item of input.authorizations) {
    if (!ID.test(item.actorId)) reasons.push("invalid_actor_id");
    totalText += item.actorId.length + item.evidence.length;
    if (item.evidence.length > MAX_TEXT) reasons.push("authorization_evidence_too_long");
    if (containsPrivateText(item.evidence)) reasons.push("private_authorization_evidence");
    const prior = auth.get(item.actorId);
    if (prior !== undefined) reasons.push(
      prior.authorized === item.authorized && prior.evidence === item.evidence
        ? "duplicate_authorization" : "conflicting_authorization",
    );
    auth.set(item.actorId, item);
  }

  const operationIds = new Map<string, SyncOperation>();
  const sorted = [...input.operations];
  for (const operation of sorted) {
    totalText += operation.operationId.length + operation.actorId.length + operation.key.length
      + (operation.baseValue?.length ?? 0) + (operation.value?.length ?? 0);
    if (!ID.test(operation.operationId)) reasons.push("invalid_operation_id");
    if (!ID.test(operation.actorId)) reasons.push("invalid_actor_id");
    if (!KEY.test(operation.key) || operation.key === "__proto__" || operation.key === "constructor" || operation.key === "prototype") reasons.push("invalid_operation_key");
    if (!Number.isSafeInteger(operation.sequence) || operation.sequence < 1) reasons.push("invalid_sequence");
    if ((operation.baseValue?.length ?? 0) > MAX_TEXT || (operation.value?.length ?? 0) > MAX_TEXT) reasons.push("operation_text_too_long");
    if (containsPrivateText(operation.key)
      || (operation.baseValue !== null && containsPrivateText(operation.baseValue))
      || (operation.value !== null && containsPrivateText(operation.value))) reasons.push("private_operation_text");
    const priorOperation = operationIds.get(operation.operationId);
    if (priorOperation !== undefined) reasons.push(
      priorOperation.actorId === operation.actorId && priorOperation.sequence === operation.sequence
        && priorOperation.key === operation.key && priorOperation.baseValue === operation.baseValue
        && priorOperation.value === operation.value ? "duplicate_operation_id" : "conflicting_operation_id",
    );
    operationIds.set(operation.operationId, operation);
  }
  if (totalText > MAX_TOTAL_TEXT) reasons.push("total_text_too_large");
  for (let index = 0; index < sorted.length; index += 1) {
    const operation = sorted[index];
    if (operation === undefined || operation.sequence !== index + 1) reasons.push("out_of_order_sequence");
  }
  if (reasons.length > 0) return { outcome: "rejected", reasons: uniqueSorted(reasons) };

  const blocked: string[] = [];
  if (baseEvidenceMissing) blocked.push("base_revision_evidence_missing");
  for (const operation of sorted) {
    const evidence = auth.get(operation.actorId);
    if (evidence === undefined || evidence.evidence.trim().length === 0) blocked.push("authorization_evidence_missing");
    else if (!evidence.authorized) reasons.push("unauthorized_actor");
  }
  if (reasons.length > 0) return { outcome: "rejected", reasons: uniqueSorted(reasons) };
  if (sorted.length === 0) blocked.push("operations_missing");
  if (blocked.length > 0) return { outcome: "blocked", reasons: uniqueSorted(blocked) };

  const conflicts: SyncConflict[] = [];
  const byKey = new Map<string, SyncOperation[]>();
  const baseValues = new Map(baseEntries);
  for (const operation of sorted) {
    const storedValue = baseValues.get(operation.key);
    const actual = storedValue === undefined ? null : storedValue;
    if (actual !== operation.baseValue) {
      conflicts.push({ key: operation.key, operationIds: [operation.operationId], reason: "base_value_mismatch" });
      continue;
    }
    const group = byKey.get(operation.key) ?? [];
    group.push(operation);
    byKey.set(operation.key, group);
  }

  const candidate: Record<string, string> = Object.fromEntries(
    baseEntries.sort(([a], [b]) => a.localeCompare(b)),
  );
  for (const key of [...byKey.keys()].sort()) {
    const group = byKey.get(key);
    if (group === undefined || group.length === 0) continue;
    const distinctValues = new Set(group.map((operation) => operation.value));
    if (distinctValues.size > 1) {
      conflicts.push({ key, operationIds: group.map((operation) => operation.operationId).sort(), reason: "competing_edits" });
      continue;
    }
    const first = group[0];
    if (first === undefined) continue;
    const value = first.value;
    if (value === null) delete candidate[key];
    else candidate[key] = value;
  }
  conflicts.sort((a, b) => a.key.localeCompare(b.key) || a.reason.localeCompare(b.reason)
    || (a.operationIds[0] ?? "").localeCompare(b.operationIds[0] ?? ""));
  if (conflicts.length > 0) {
    return { outcome: "verified", status: "conflicted", conflicts, reasons: ["conflicts_require_resolution"] };
  }
  const orderedCandidate = Object.fromEntries(Object.entries(candidate).sort(([a], [b]) => a.localeCompare(b)));
  return { outcome: "verified", status: "merged", candidateState: orderedCandidate, reasons: [] };
}
