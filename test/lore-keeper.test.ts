import { describe, expect, it } from "vitest";
import { reviewLore, type LoreStatement } from "../src/lore-keeper";

const digest = (value: string): string => value.repeat(64);
const fact = (id: string, object: string, extra: Partial<LoreStatement> = {}): LoreStatement => ({
  id, projectId: "project-a", predicate: { subject: "hero", relation: "home", object },
  sourceDigest: digest("a"), evidenceAvailable: true, ...extra,
});

describe("reviewLore", () => {
  it("accepts exact structured facts and preserves input immutability", () => {
    const input = { projectId: "project-a", canon: [fact("canon-1", "north")], candidates: [fact("new-1", "north")] };
    const snapshot = structuredClone(input);
    expect(reviewLore(input).outcome).toBe("verified");
    expect(input).toEqual(snapshot);
  });

  it("reports contradictions without rewriting canon", () => {
    const canon = [fact("canon-1", "north")];
    const result = reviewLore({ projectId: "project-a", canon, candidates: [fact("new-1", "south")] });
    expect(result).toMatchObject({ outcome: "rejected", reasons: ["candidate_contradiction"], canon });
    expect(result.contradictions).toEqual([{ candidateId: "new-1", conflictsWithId: "canon-1", subject: "hero", relation: "home" }]);
  });

  it("allows explicit supersession while retaining the canonical record", () => {
    const result = reviewLore({ projectId: "project-a", canon: [fact("canon-1", "north")], candidates: [fact("new-1", "south", { supersedes: ["canon-1"] })] });
    expect(result.outcome).toBe("verified");
    expect(result.canon?.map((item) => item.id)).toEqual(["canon-1"]);
    expect(result.acceptedFacts?.[0]?.supersedes).toEqual(["canon-1"]);
  });

  it("rejects self references and cycles in candidate supersession", () => {
    expect(reviewLore({
      projectId: "project-a", canon: [],
      candidates: [fact("a", "north", { supersedes: ["a"] })],
    })).toEqual({ outcome: "rejected", reasons: ["invalid_supersedes_reference"] });

    expect(reviewLore({
      projectId: "project-a", canon: [],
      candidates: [
        fact("a", "north", { supersedes: ["b"] }),
        fact("b", "south", { supersedes: ["a"] }),
      ],
    })).toEqual({ outcome: "rejected", reasons: ["supersedes_cycle"] });

    expect(reviewLore({
      projectId: "project-a", canon: [],
      candidates: [
        fact("a", "north", { supersedes: ["b"] }),
        fact("b", "south", { supersedes: ["c"] }),
        fact("c", "west", { supersedes: ["a"] }),
      ],
    })).toEqual({ outcome: "rejected", reasons: ["supersedes_cycle"] });
  });

  it("keeps projects isolated by rejecting scope mixing", () => {
    expect(reviewLore({ projectId: "project-a", canon: [], candidates: [fact("new-1", "north", { projectId: "project-b" })] })).toEqual({ outcome: "rejected", reasons: ["project_scope_mismatch"] });
  });

  it("blocks missing canon and unavailable source evidence", () => {
    expect(reviewLore({ projectId: "project-a", canon: undefined, candidates: [] })).toEqual({ outcome: "blocked", reasons: ["canon_unavailable"] });
    expect(reviewLore({ projectId: "project-a", canon: [], candidates: [fact("new-1", "north", { evidenceAvailable: false })] })).toEqual({ outcome: "blocked", reasons: ["candidate_source_evidence_unavailable"] });
  });

  it("is deterministic, sorted, deduplicated, and bounded", () => {
    const a = fact("a", "north"); const b = fact("b", "north");
    expect(reviewLore({ projectId: "project-a", canon: [], candidates: [b, a, a] }))
      .toEqual(reviewLore({ projectId: "project-a", canon: [], candidates: [a, b] }));
    expect(reviewLore({ projectId: "project-a", canon: [], candidates: Array.from({ length: 101 }, (_, index) => fact(`f-${index}`, "north")) }))
      .toEqual({ outcome: "rejected", reasons: ["statement_limit_exceeded"] });
    expect(reviewLore({ projectId: "project-a", canon: [], candidates: [fact("long", "x".repeat(513))] }))
      .toEqual({ outcome: "rejected", reasons: ["malformed_statement"] });
  });
});
