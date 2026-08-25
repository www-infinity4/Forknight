import { describe, expect, it } from "vitest";

import { simulateOhmCircuit } from "../src/ohm-simulator";

describe("simulateOhmCircuit", () => {
  it("solves a bounded resistive DC circuit", () => {
    const result = simulateOhmCircuit({
      source: { kind: "dc", voltageVolts: 12 },
      circuit: { kind: "resistive", resistanceOhms: 120 },
    });

    expect(result.outcome).toBe("verified");
    expect(result.reasons).toEqual([]);
    expect(result.output?.currentAmps).toBeCloseTo(0.1, 12);
    expect(result.output?.resistorPowerWatts).toBeCloseTo(1.2, 12);
  });

  it("models an RC circuit at one time constant", () => {
    const result = simulateOhmCircuit({
      source: { kind: "dc", voltageVolts: 10 },
      circuit: {
        kind: "rc",
        resistanceOhms: 1_000,
        capacitanceFarads: 0.001,
        elapsedSeconds: 1,
        initialCapacitorVoltageVolts: 0,
      },
    });

    expect(result.outcome).toBe("verified");
    expect(result.output?.timeConstantSeconds).toBe(1);
    expect(result.output?.capacitorVoltageVolts).toBeCloseTo(6.321205588, 9);
    expect(result.output?.currentAmps).toBeCloseTo(0.0036787944, 9);
  });

  it("accepts the voltage and power boundary", () => {
    const result = simulateOhmCircuit({
      source: { kind: "dc", voltageVolts: 24 },
      circuit: { kind: "resistive", resistanceOhms: 24 },
    });

    expect(result.outcome).toBe("verified");
    expect(result.output?.currentAmps).toBe(1);
    expect(result.output?.resistorPowerWatts).toBe(24);
  });

  it.each([
    [
      {
        source: { kind: "dc", voltageVolts: 24.01 },
        circuit: { kind: "resistive", resistanceOhms: 100 },
      },
      "source.voltage-out-of-safe-range",
    ],
    [
      {
        source: { kind: "ac", voltageVolts: 12 },
        circuit: { kind: "resistive", resistanceOhms: 100 },
      },
      "source.dc-only",
    ],
    [
      {
        source: { kind: "mains", voltageVolts: 12 },
        circuit: { kind: "resistive", resistanceOhms: 100 },
      },
      "source.dc-only",
    ],
    [
      {
        source: { kind: "dc", voltageVolts: Number.NaN },
        circuit: { kind: "resistive", resistanceOhms: 100 },
      },
      "source.voltage-out-of-safe-range",
    ],
    [
      {
        source: { kind: "dc", voltageVolts: 24 },
        circuit: { kind: "resistive", resistanceOhms: 1 },
      },
      "circuit.current-out-of-safe-range",
    ],
  ])("rejects hazardous or invalid input", (input, reason) => {
    expect(simulateOhmCircuit(input)).toEqual({
      outcome: "rejected",
      reasons: [reason],
    });
  });

  it("rejects an RC circuit whose initial transient exceeds the current bound", () => {
    expect(
      simulateOhmCircuit({
        source: { kind: "dc", voltageVolts: 24 },
        circuit: {
          kind: "rc",
          resistanceOhms: 1,
          capacitanceFarads: 0.001,
          elapsedSeconds: 10,
          initialCapacitorVoltageVolts: 0,
        },
      }),
    ).toEqual({
      outcome: "rejected",
      reasons: ["circuit.current-out-of-safe-range"],
    });
  });

  it("rejects RC initial power above the resistor power bound", () => {
    expect(
      simulateOhmCircuit({
        source: { kind: "dc", voltageVolts: 24 },
        circuit: {
          kind: "rc",
          resistanceOhms: 12,
          capacitanceFarads: 0.001,
          elapsedSeconds: 10,
          initialCapacitorVoltageVolts: 0,
        },
      }),
    ).toEqual({
      outcome: "rejected",
      reasons: ["circuit.power-out-of-safe-range"],
    });
  });
});
