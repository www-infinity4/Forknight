import type { ResearchJob, ResearchStatus } from "./types";

const transitions: Readonly<Record<ResearchStatus, readonly ResearchStatus[]>> = {
  queued: ["dispatched", "rejected"],
  dispatched: ["synthesizing", "failed", "rejected"],
  synthesizing: ["completed", "failed", "rejected"],
  completed: [],
  failed: [],
  rejected: []
};

export function transitionResearchJob(job: ResearchJob, next: ResearchStatus): ResearchJob {
  if (!transitions[job.status].includes(next)) {
    throw new Error("invalid-transition:" + job.status + ":" + next);
  }
  return { ...job, status: next };
}

export function planResearchJob(job: ResearchJob): ResearchJob {
  if (job.status !== "queued") throw new Error("new-job-must-be-queued");
  return structuredClone(job);
}
