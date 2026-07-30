import { describe, expect, it } from "vitest";
import {
  StateAggregator,
  aggregateTaskState,
  energyForSeconds,
  settleWorkload,
  workloadSeconds,
} from "./state-machine.js";

describe("energy thresholds", () => {
  it.each([
    [0, "relaxed"],
    [1_199, "relaxed"],
    [1_200, "focused"],
    [3_599, "focused"],
    [3_600, "tired"],
    [7_199, "tired"],
    [7_200, "exhausted"],
  ] as const)("maps %i seconds to %s", (seconds, expected) => {
    expect(energyForSeconds(seconds)).toBe(expected);
  });
});

describe("session aggregation", () => {
  it("uses the defined priority and expires transient results", () => {
    const now = 1_000_000;
    expect(
      aggregateTaskState(
        [
          { state: "running", updatedAtMs: now, source: "hook" },
          { state: "needs_input", updatedAtMs: now, source: "app_server" },
          { state: "blocked", updatedAtMs: now, source: "manual" },
        ],
        now,
      ),
    ).toBe("needs_input");
    expect(
      aggregateTaskState(
        [{ state: "ready", updatedAtMs: now - 30_000, source: "hook" }],
        now,
      ),
    ).toBe("idle");
  });

  it("lets app-server suppress a duplicate hook for five seconds", () => {
    const aggregator = new StateAggregator();
    expect(
      aggregator.apply({
        sessionId: "thread-1",
        state: "running",
        source: "app_server",
        receivedAtMs: 1_000,
      }),
    ).toBe(true);
    expect(
      aggregator.apply({
        sessionId: "thread-1",
        state: "ready",
        source: "hook",
        receivedAtMs: 5_999,
      }),
    ).toBe(false);
    expect(aggregator.taskState(5_999)).toBe("running");
  });
});

describe("daily workload", () => {
  it("counts only global running wall-clock time", () => {
    const base = new Date(2026, 6, 29, 9, 0, 0);
    let workload = settleWorkload(
      { localDate: "2026-07-29", accumulatedSeconds: 0, runningSinceMs: null },
      "running",
      base,
    );
    expect(workloadSeconds(workload, base.getTime() + 90_000)).toBe(90);
    workload = settleWorkload(workload, "needs_input", new Date(base.getTime() + 90_000));
    expect(workload.accumulatedSeconds).toBe(90);
  });

  it("resets when the local date changes", () => {
    const workload = settleWorkload(
      { localDate: "2026-07-28", accumulatedSeconds: 5_000, runningSinceMs: null },
      "idle",
      new Date(2026, 6, 29, 0, 0, 1),
    );
    expect(workload.accumulatedSeconds).toBe(0);
    expect(workload.localDate).toBe("2026-07-29");
  });
});
