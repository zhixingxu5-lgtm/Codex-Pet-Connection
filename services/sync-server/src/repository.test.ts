import { describe, expect, it } from "vitest";
import { MemoryPetRepository } from "./memory-repository.js";

describe("state snapshots", () => {
  it("rejects stale sequence numbers", async () => {
    const repository = new MemoryPetRepository();
    const state = {
      schemaVersion: 1 as const,
      ownerDeviceId: "6b31fd25-8a22-43bc-82c4-e0850a1a8c21",
      sequence: 2,
      presence: "online" as const,
      taskState: "running" as const,
      energyState: "focused" as const,
      eventId: null,
      updatedAt: "2026-07-29T12:00:00.000Z",
      expiresAt: "2026-07-29T12:01:00.000Z",
    };
    expect(await repository.saveState(state)).toBe(true);
    expect(await repository.saveState({ ...state, sequence: 1 })).toBe(false);
    expect(await repository.saveState({ ...state, sequence: 3 })).toBe(true);
  });
});
