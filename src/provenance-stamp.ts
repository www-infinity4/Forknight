import type { Outcome } from "./types";

export type WorkerRole = "author" | "generator" | "reviewer" | "validator" | "publisher";
export type ReviewDecision = "approved" | "rejected";

export interface SourceReference {
  readonly reference: string;
  readonly digest: string;
  readonly evidenceAvailable: boolean;
}

export interface Contributor {
  readonly id: string;
  readonly kind: "human" | "model" | "worker";
}

export interface RoleAssignment {
  readonly actorId: string;
  readonly role: WorkerRole;
}

export interface ReviewEvidence {
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly evidenceDigest: string;
  readonly evidenceAvailable: boolean;
}

export interface LicenseEvidence {
  readonly identifier: string;
  readonly approved: boolean;
  readonly evidenceAvailable: boolean;
}

export interface ParentManifestReference {
  readonly manifestId: string;
  readonly digest: string;
  readonly evidenceAvailable: boolean;
}

export interface ProvenanceStampInput {
  readonly artifactDigest: string;
  readonly sourceReferences: readonly SourceReference[];
  readonly contributors: readonly Contributor[];
  readonly roles: readonly RoleAssignment[];
  readonly reviews: readonly ReviewEvidence[];
  readonly licenses: readonly LicenseEvidence[];
  readonly parentManifests?: readonly ParentManifestReference[];
  readonly manifestId?: string;
  readonly timestamp?: string;
}

export interface ProvenanceManifest {
  readonly kind: "structurally_validated_provenance_manifest";
  readonly artifactDigest: string;
  readonly sourceReferences: readonly SourceReference[];
  readonly contributors: readonly Contributor[];
  readonly roles: readonly RoleAssignment[];
  readonly reviews: readonly ReviewEvidence[];
  readonly licenses: readonly LicenseEvidence[];
  readonly parentManifests: readonly ParentManifestReference[];
  readonly manifestId?: string;
  readonly timestamp?: string;
}

export interface ProvenanceStampResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly manifest?: ProvenanceManifest;
}

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SOURCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/?#&=%+@~-]{0,511}$/;
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*)/i;

function privateValue(value: string): boolean {
  return EMAIL.test(value) || SECRET.test(value);
}

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value) && !privateValue(value);
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) byKey.set(key(value), value);
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => ({ ...value }));
}

function hasConflictingIdentity<T>(
  values: readonly T[],
  identity: (value: T) => string,
  evidence: (value: T) => string,
): boolean {
  const observed = new Map<string, string>();
  for (const value of values) {
    const id = identity(value);
    const fingerprint = evidence(value);
    const prior = observed.get(id);
    if (prior !== undefined && prior !== fingerprint) return true;
    observed.set(id, fingerprint);
  }
  return false;
}

function invalidTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP.test(value)) return true;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  const canonical = parsed.toISOString();
  return value.includes(".") ? canonical !== value : canonical.replace(".000Z", "Z") !== value;
}

/**
 * Pure structural validation of caller-supplied lineage evidence. This function
 * does not hash content and does not cryptographically verify any supplied digest.
 */
export function buildProvenanceStamp(input: ProvenanceStampInput): ProvenanceStampResult {
  const rejected: string[] = [];
  const blocked: string[] = [];

  if (!SHA256.test(input.artifactDigest)) rejected.push("invalid_artifact_digest");
  if (input.manifestId !== undefined && !validIdentifier(input.manifestId)) rejected.push("invalid_manifest_id");
  if (input.timestamp !== undefined && invalidTimestamp(input.timestamp)) rejected.push("invalid_timestamp");

  if (hasConflictingIdentity(input.contributors, (value) => value.id, (value) => value.kind)) {
    rejected.push("conflicting_contributor_identity");
  }
  if (hasConflictingIdentity(input.sourceReferences, (value) => value.reference, (value) => `${value.digest}\u0000${value.evidenceAvailable}`)) {
    rejected.push("conflicting_source_reference");
  }
  if (hasConflictingIdentity(input.reviews, (value) => value.reviewerId, (value) => `${value.decision}\u0000${value.evidenceDigest}\u0000${value.evidenceAvailable}`)) {
    rejected.push("conflicting_reviewer_evidence");
  }
  if (hasConflictingIdentity(input.licenses, (value) => value.identifier, (value) => `${value.approved}\u0000${value.evidenceAvailable}`)) {
    rejected.push("conflicting_license_evidence");
  }
  if (hasConflictingIdentity(input.parentManifests ?? [], (value) => value.manifestId, (value) => `${value.digest}\u0000${value.evidenceAvailable}`)) {
    rejected.push("conflicting_parent_manifest");
  }

  const sources = uniqueSorted(input.sourceReferences, (value) => `${value.reference}\u0000${value.digest}\u0000${value.evidenceAvailable}`);
  const contributors = uniqueSorted(input.contributors, (value) => `${value.id}\u0000${value.kind}`);
  const roles = uniqueSorted(input.roles, (value) => `${value.actorId}\u0000${value.role}`);
  const reviews = uniqueSorted(input.reviews, (value) => `${value.reviewerId}\u0000${value.decision}\u0000${value.evidenceDigest}\u0000${value.evidenceAvailable}`);
  const licenses = uniqueSorted(input.licenses, (value) => `${value.identifier}\u0000${value.approved}\u0000${value.evidenceAvailable}`);
  const parents = uniqueSorted(input.parentManifests ?? [], (value) => `${value.manifestId}\u0000${value.digest}\u0000${value.evidenceAvailable}`);

  if (sources.length === 0) blocked.push("source_evidence_unavailable");
  if (contributors.length === 0 || roles.length === 0) blocked.push("contributor_evidence_unavailable");
  if (reviews.length === 0) blocked.push("review_evidence_unavailable");
  if (licenses.length === 0) blocked.push("license_evidence_unavailable");

  if (sources.some((value) => !SOURCE_REFERENCE.test(value.reference) || privateValue(value.reference))) rejected.push("invalid_or_private_source_reference");
  if (sources.some((value) => !SHA256.test(value.digest))) rejected.push("invalid_source_digest");
  if (contributors.some((value) => !validIdentifier(value.id))) rejected.push("invalid_or_private_contributor");
  if (roles.some((value) => !validIdentifier(value.actorId))) rejected.push("invalid_or_private_role_assignment");
  if (roles.some((value) => !contributors.some((contributor) => contributor.id === value.actorId))) rejected.push("role_actor_not_contributor");
  if (reviews.some((value) => !validIdentifier(value.reviewerId) || !SHA256.test(value.evidenceDigest))) rejected.push("invalid_review_evidence");
  if (reviews.some((value) => value.decision !== "approved")) rejected.push("lineage_review_rejected");
  if (licenses.some((value) => !LICENSE.test(value.identifier) || privateValue(value.identifier))) rejected.push("invalid_license_identifier");
  if (licenses.some((value) => !value.approved)) rejected.push("lineage_license_unapproved");
  if (parents.some((value) => !validIdentifier(value.manifestId) || !SHA256.test(value.digest))) rejected.push("invalid_parent_manifest");

  if (sources.some((value) => !value.evidenceAvailable)) blocked.push("source_evidence_unavailable");
  if (reviews.some((value) => !value.evidenceAvailable)) blocked.push("review_evidence_unavailable");
  if (licenses.some((value) => !value.evidenceAvailable)) blocked.push("license_evidence_unavailable");
  if (parents.some((value) => !value.evidenceAvailable)) blocked.push("parent_manifest_evidence_unavailable");

  if (rejected.length > 0) return { outcome: "rejected", reasons: [...new Set(rejected)].sort() };
  if (blocked.length > 0) return { outcome: "blocked", reasons: [...new Set(blocked)].sort() };

  return {
    outcome: "verified",
    reasons: ["supplied_lineage_is_structurally_valid"],
    manifest: {
      kind: "structurally_validated_provenance_manifest",
      artifactDigest: input.artifactDigest,
      sourceReferences: sources,
      contributors,
      roles,
      reviews,
      licenses,
      parentManifests: parents,
      ...(input.manifestId === undefined ? {} : { manifestId: input.manifestId }),
      ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
    },
  };
}
