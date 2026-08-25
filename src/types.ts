export type Outcome = "verified" | "rejected" | "blocked";
export type Visibility = "public" | "internal" | "restricted";

export interface EventMaterial {
  eventId: string;
  streamId: string;
  projectId: string;
  visibility: Visibility;
  vectorTimestamp: Record<string, number>;
  payload: Record<string, unknown>;
}

export interface AppendEventRequest extends EventMaterial {
  provenanceDigest: string;
}

export interface ConversationEvent extends AppendEventRequest {
  sequence: number;
  createdAt: string;
}

export type ResearchStatus =
  | "queued" | "dispatched" | "synthesizing"
  | "completed" | "failed" | "rejected";

export interface ResearchJob {
  jobId: string;
  inquiry: string;
  allowedOrigins: string[];
  maxSources: number;
  maxDepth: number;
  status: ResearchStatus;
}

export interface ResearchFinding {
  findingId: string;
  jobId: string;
  sourceUrl: string;
  sourceTitle: string;
  summary: string;
  retrievedAt: string;
  licenseSpdx: string | null;
  commitSha: string | null;
  risks: string[];
}

export type ExtractionMethod = "reuse" | "adapt" | "clean-room";
export type ExtractionDecision = "allowed" | "review-required" | "rejected";

export interface ExtractionManifest {
  manifestId: string;
  upstreamRepository: string;
  exactCommit: string;
  filesExamined: string[];
  feature: string;
  detectedLicense: string;
  method: ExtractionMethod;
  attributionRequirements: string[];
  policyFlags: string[];
}

export interface ExtractionEvaluation {
  decision: ExtractionDecision;
  reasons: string[];
  manifest: ExtractionManifest;
}
