import type { Outcome } from "./types";

export type TargetEnvironment = "preview" | "production";
export type EvidenceStatus = "verified" | "failed";

export interface ImmutableRelease {
  readonly releaseId: string;
  readonly digest: string;
}

export interface ArtifactEvidence {
  readonly status: EvidenceStatus;
  readonly artifactId: string;
  readonly digest: string;
  readonly verifier: string;
}

export interface GateEvidence {
  readonly gateId: string;
  readonly status: EvidenceStatus;
  readonly verifier: string;
}

export interface PreviewUrlEvidence {
  readonly status: EvidenceStatus;
  readonly url: string;
  readonly verifier: string;
}

export interface HumanApprovalEvidence {
  readonly status: EvidenceStatus;
  readonly approverId: string;
  readonly actorKind: "human" | "ai" | "automation";
  readonly releaseId: string;
}

export interface HyperDeployInput {
  readonly planId: string;
  readonly targetEnvironment: TargetEnvironment;
  readonly release: ImmutableRelease;
  readonly artifactEvidence?: ArtifactEvidence;
  readonly gateEvidence?: readonly GateEvidence[];
  readonly previewUrlEvidence?: PreviewUrlEvidence;
  readonly humanApproval?: HumanApprovalEvidence;
  readonly priorRelease?: ImmutableRelease;
}

export interface RollbackManifest {
  readonly kind: "rollback_manifest";
  readonly targetEnvironment: TargetEnvironment;
  readonly fromReleaseId: string;
  readonly fromDigest: string;
  readonly toReleaseId: string;
  readonly toDigest: string;
}

export interface DeploymentPlan {
  readonly kind: "deployment_plan";
  readonly planId: string;
  readonly targetEnvironment: TargetEnvironment;
  readonly releaseId: string;
  readonly digest: string;
  readonly artifactId: string;
  readonly previewUrl: string;
  readonly verifiedGates: readonly string[];
  readonly approvedBy?: string;
  readonly rollback?: RollbackManifest;
}

export interface HyperDeployResult {
  readonly outcome: Outcome;
  readonly reasons: readonly string[];
  readonly plan?: DeploymentPlan;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CREDENTIAL_KEY = /(?:^|[_-])(authorization|cookie|credential|password|private[_-]?key|secret|token)(?:$|[_-])/i;
const CREDENTIAL_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:gh[opusr]|github_pat|sk_(?:live|test))_[A-Za-z0-9_-]{8,})/i;

function hasCredentialLikeData(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return CREDENTIAL_VALUE.test(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key) || hasCredentialLikeData(child, seen)) return true;
  }
  return false;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validRelease(value: ImmutableRelease | undefined): value is ImmutableRelease {
  return value !== undefined && validIdentifier(value.releaseId) && SHA256.test(value.digest);
}

function validVerifier(value: unknown): value is string {
  return validIdentifier(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function result(value: HyperDeployResult): HyperDeployResult {
  return deepFreeze(value);
}

/**
 * Pure evidence evaluator. It creates a manifest only; it cannot deploy, execute
 * commands, read files, use credentials, or contact any service.
 */
export function evaluateDeployment(input: HyperDeployInput): HyperDeployResult {
  if (hasCredentialLikeData(input)) {
    return result({ outcome: "rejected", reasons: ["credential_like_data_forbidden"] });
  }
  if (!validIdentifier(input.planId)) {
    return result({ outcome: "rejected", reasons: ["invalid_plan_id"] });
  }
  if (input.targetEnvironment !== "preview" && input.targetEnvironment !== "production") {
    return result({ outcome: "rejected", reasons: ["invalid_target_environment"] });
  }
  if (!validRelease(input.release)) {
    return result({ outcome: "rejected", reasons: ["invalid_immutable_release"] });
  }

  const missing: string[] = [];
  if (input.artifactEvidence === undefined) missing.push("artifact_evidence_missing");
  if (input.gateEvidence === undefined || input.gateEvidence.length === 0) missing.push("gate_evidence_missing");
  if (input.previewUrlEvidence === undefined) missing.push("preview_url_evidence_missing");
  if (input.targetEnvironment === "production" && input.humanApproval === undefined) {
    missing.push("human_approval_missing");
  }
  if (missing.length > 0) return result({ outcome: "blocked", reasons: missing });

  const artifact = input.artifactEvidence!;
  const gates = input.gateEvidence!;
  const preview = input.previewUrlEvidence!;
  const approval = input.humanApproval;
  const invalid: string[] = [];

  if (
    !validIdentifier(artifact.artifactId) ||
    !validVerifier(artifact.verifier) ||
    !SHA256.test(artifact.digest) ||
    artifact.digest !== input.release.digest
  ) invalid.push("artifact_evidence_invalid");
  else if (artifact.status !== "verified") invalid.push("artifact_evidence_failed");

  const gateIds = gates.map((gate) => gate.gateId);
  if (
    gates.some((gate) => !validIdentifier(gate.gateId) || !validVerifier(gate.verifier)) ||
    new Set(gateIds).size !== gateIds.length
  ) invalid.push("gate_evidence_invalid");
  else if (gates.some((gate) => gate.status !== "verified")) invalid.push("gate_evidence_failed");

  let previewUrl: URL | undefined;
  try {
    previewUrl = new URL(preview.url);
  } catch {
    // Reported below without reflecting caller-controlled data.
  }
  if (
    !previewUrl ||
    previewUrl.protocol !== "https:" ||
    !previewUrl.hostname ||
    previewUrl.username !== "" ||
    previewUrl.password !== "" ||
    previewUrl.search !== "" ||
    previewUrl.hash !== "" ||
    !validVerifier(preview.verifier)
  ) {
    invalid.push("preview_url_evidence_invalid");
  } else if (preview.status !== "verified") invalid.push("preview_url_evidence_failed");

  if (input.targetEnvironment === "production") {
    if (
      approval?.actorKind !== "human" ||
      !validIdentifier(approval.approverId) ||
      approval.releaseId !== input.release.releaseId
    ) invalid.push("human_approval_invalid");
    else if (approval.status !== "verified") invalid.push("human_approval_failed");
  }
  if (input.priorRelease !== undefined && !validRelease(input.priorRelease)) {
    invalid.push("prior_release_invalid");
  }
  if (input.priorRelease?.releaseId === input.release.releaseId || input.priorRelease?.digest === input.release.digest) {
    invalid.push("prior_release_not_distinct");
  }
  if (invalid.length > 0) return result({ outcome: "rejected", reasons: invalid });

  const rollback: RollbackManifest | undefined = input.priorRelease === undefined
    ? undefined
    : {
        kind: "rollback_manifest",
        targetEnvironment: input.targetEnvironment,
        fromReleaseId: input.release.releaseId,
        fromDigest: input.release.digest,
        toReleaseId: input.priorRelease.releaseId,
        toDigest: input.priorRelease.digest,
      };
  const plan: DeploymentPlan = {
    kind: "deployment_plan",
    planId: input.planId,
    targetEnvironment: input.targetEnvironment,
    releaseId: input.release.releaseId,
    digest: input.release.digest,
    artifactId: artifact.artifactId,
    previewUrl: preview.url,
    verifiedGates: [...gateIds].sort(),
    ...(input.targetEnvironment === "production" ? { approvedBy: approval!.approverId } : {}),
    ...(rollback === undefined ? {} : { rollback }),
  };
  return result({ outcome: "verified", reasons: ["deployment_evidence_verified"], plan });
}
