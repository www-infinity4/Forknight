import { describe, expect, it } from "vitest";
import { compileEngineeringLesson, type EngineeringLessonInput } from "../src/edu-script";

const INPUT: EngineeringLessonInput = {
  title: "  RC Timing  ",
  objective: "Relate resistance and capacitance to charging time.",
  safetyNotes: ["Disconnect power before rewiring.", "Disconnect power before rewiring."],
  concepts: [
    { title: "Capacitance", explanation: "A capacitor stores charge." },
    {
      title: "Time constant",
      explanation: "The product R × C sets the time scale.",
      checks: ["What happens when resistance doubles?"],
      experiments: [{
        title: "Change resistance",
        components: ["resistor", "capacitor", "resistor"],
        procedure: ["Build the low-voltage circuit.", "Measure charging time."],
        expectedObservation: "More resistance increases charging time.",
        hazard: "stored-energy",
      }],
    },
    { title: "Design", explanation: "Choose values for a target delay." },
  ],
};

describe("compileEngineeringLesson", () => {
  it("is deterministic and does not mutate input", () => {
    const before = JSON.stringify(INPUT);
    expect(compileEngineeringLesson(INPUT)).toEqual(compileEngineeringLesson(INPUT));
    expect(JSON.stringify(INPUT)).toBe(before);
  });

  it("creates progressive steps, stable ids, experiments, safety, and checks", () => {
    const result = compileEngineeringLesson(INPUT);
    expect(result.outcome).toBe("verified");
    expect(result.lesson).toBeDefined();
    const lesson = result.lesson;
    if (!lesson) throw new Error("expected a compiled lesson");
    expect(lesson.id).toBe("rc-timing");
    expect(lesson.steps.map((step) => step.level)).toEqual(["foundation", "guided", "independent"]);
    expect(lesson.steps[1]?.experiments[0]).toMatchObject({
      id: "rc-timing-step-2-experiment-1",
      components: ["resistor", "capacitor"],
      safetyNotes: [
        "Disconnect power before rewiring.",
        "Discharge energy-storage components before touching the circuit.",
      ],
    });
    expect(lesson.steps[0]?.comprehensionChecks[0]).toContain("Capacitance");
    expect(lesson.steps[1]?.comprehensionChecks).toEqual(["What happens when resistance doubles?"]);
  });

  it("rejects blank text and incomplete experiments", () => {
    expect(compileEngineeringLesson({ ...INPUT, title: " " })).toMatchObject({ outcome: "rejected", reasons: ["title must not be blank"] });
    expect(compileEngineeringLesson({ ...INPUT, concepts: [] })).toMatchObject({ outcome: "rejected", reasons: ["concepts must not be empty"] });
    expect(compileEngineeringLesson({
      ...INPUT,
      concepts: [{
        title: "Test",
        explanation: "Test safely.",
        experiments: [{ title: "Broken", components: [], procedure: ["Observe."], expectedObservation: "Nothing." }],
      }],
    })).toMatchObject({ outcome: "rejected", reasons: ["concepts[0].experiments[0].components must not be empty"] });
  });

  it("rejects mains-voltage experiments", () => {
    const result = compileEngineeringLesson({
      ...INPUT,
      concepts: [{
        title: "Unsafe",
        explanation: "Unsafe test.",
        experiments: [{ title: "Mains", components: ["load"], procedure: ["Connect."], expectedObservation: "Current flows.", hazard: "mains-voltage" }],
      }],
    });
    expect(result).toMatchObject({ outcome: "rejected" });
    expect(result.lesson).toBeUndefined();
  });

  it("assigns a single concept to the foundation level", () => {
    expect(compileEngineeringLesson({ ...INPUT, concepts: [INPUT.concepts[0]!] }).lesson?.steps[0]?.level).toBe("foundation");
  });
});
