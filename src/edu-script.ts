import type { Outcome } from "./types";

export type LessonLevel = "foundation" | "guided" | "independent";
export type Hazard = "stored-energy" | "heat" | "mains-voltage" | "moving-parts" | "none";

export interface ComponentExperimentInput {
  readonly title: string;
  readonly components: readonly string[];
  readonly procedure: readonly string[];
  readonly expectedObservation: string;
  readonly hazard?: Hazard;
  readonly safetyNotes?: readonly string[];
}

export interface ConceptInput {
  readonly title: string;
  readonly explanation: string;
  readonly experiments?: readonly ComponentExperimentInput[];
  readonly checks?: readonly string[];
}

export interface EngineeringLessonInput {
  readonly title: string;
  readonly objective: string;
  readonly concepts: readonly ConceptInput[];
  readonly safetyNotes?: readonly string[];
}

export interface LessonExperiment {
  readonly id: string;
  readonly title: string;
  readonly components: readonly string[];
  readonly procedure: readonly string[];
  readonly expectedObservation: string;
  readonly safetyNotes: readonly string[];
}

export interface LessonStep {
  readonly id: string;
  readonly level: LessonLevel;
  readonly title: string;
  readonly explanation: string;
  readonly experiments: readonly LessonExperiment[];
  readonly comprehensionChecks: readonly string[];
}

export interface EngineeringLesson {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly safetyNotes: readonly string[];
  readonly steps: readonly LessonStep[];
}

export interface EduScriptResult {
  readonly outcome: Outcome;
  readonly reasons: string[];
  readonly lesson?: EngineeringLesson;
}

const HAZARD_NOTES: Readonly<Record<Hazard, readonly string[]>> = {
  none: [],
  "stored-energy": ["Discharge energy-storage components before touching the circuit."],
  heat: ["Allow hot components to cool before handling them."],
  "mains-voltage": ["Do not use mains voltage; use an isolated low-voltage substitute under qualified supervision."],
  "moving-parts": ["Keep hands, hair, and loose clothing clear of moving parts."],
};

function required(value: string, path: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new TypeError(`${path} must not be blank`);
  return normalized;
}

function list(values: readonly string[] | undefined, path: string): readonly string[] {
  return (values ?? []).map((value, index) => required(value, `${path}[${index}]`));
}

function unique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return values.filter((value) => !seen.has(value) && Boolean(seen.add(value)));
}

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return result || "lesson";
}

function levelFor(index: number, count: number): LessonLevel {
  if (count === 1 || index === 0) return "foundation";
  if (index === count - 1) return "independent";
  return "guided";
}

function buildExperiment(
  lessonNotes: readonly string[],
  input: ComponentExperimentInput,
  path: string,
  id: string,
): LessonExperiment {
  const components = unique(list(input.components, `${path}.components`));
  const procedure = list(input.procedure, `${path}.procedure`);
  if (components.length === 0) throw new TypeError(`${path}.components must not be empty`);
  if (procedure.length === 0) throw new TypeError(`${path}.procedure must not be empty`);
  const hazard = input.hazard ?? "none";
  if (hazard === "mains-voltage") {
    throw new TypeError(`${path} requires mains voltage; only isolated low-voltage experiments are allowed`);
  }
  return {
    id,
    title: required(input.title, `${path}.title`),
    components,
    procedure,
    expectedObservation: required(input.expectedObservation, `${path}.expectedObservation`),
    safetyNotes: unique([...lessonNotes, ...HAZARD_NOTES[hazard], ...list(input.safetyNotes, `${path}.safetyNotes`)]),
  };
}

/** Pure compiler: output depends only on input; it performs no I/O and mutates no input. */
export function compileEngineeringLesson(input: EngineeringLessonInput): EduScriptResult {
  try {
    const title = required(input.title, "title");
    const objective = required(input.objective, "objective");
    if (input.concepts.length === 0) throw new TypeError("concepts must not be empty");
    const lessonId = slug(title);
    const safetyNotes = unique(list(input.safetyNotes, "safetyNotes"));
    const steps = input.concepts.map((concept, conceptIndex): LessonStep => {
      const path = `concepts[${conceptIndex}]`;
      const conceptTitle = required(concept.title, `${path}.title`);
      const checks = list(concept.checks, `${path}.checks`);
      return {
        id: `${lessonId}-step-${conceptIndex + 1}`,
        level: levelFor(conceptIndex, input.concepts.length),
        title: conceptTitle,
        explanation: required(concept.explanation, `${path}.explanation`),
        experiments: (concept.experiments ?? []).map((experiment, experimentIndex) =>
          buildExperiment(safetyNotes, experiment, `${path}.experiments[${experimentIndex}]`, `${lessonId}-step-${conceptIndex + 1}-experiment-${experimentIndex + 1}`),
        ),
        comprehensionChecks: checks.length > 0
          ? unique(checks)
          : [`Explain how ${conceptTitle} supports this objective: ${objective}`],
      };
    });
    return {
      outcome: "verified",
      reasons: ["Lesson input is complete, deterministic, and limited to permitted experiments."],
      lesson: { id: lessonId, title, objective, safetyNotes, steps },
    };
  } catch (error: unknown) {
    return {
      outcome: "rejected",
      reasons: [error instanceof Error ? error.message : "Lesson input is invalid."],
    };
  }
}
