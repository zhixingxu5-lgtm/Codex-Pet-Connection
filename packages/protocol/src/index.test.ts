import { describe, expect, it } from "vitest";
import { petStateEnvelopeSchema } from "./index.js";

describe("pet state protocol", () => {
  it("accepts the privacy-preserving wire shape", () => {
    const value = petStateEnvelopeSchema.parse({
      schemaVersion: 1,
      ownerDeviceId: "6b31fd25-8a22-43bc-82c4-e0850a1a8c21",
      sequence: 4,
      presence: "online",
      taskState: "running",
      energyState: "focused",
      eventId: null,
      updatedAt: "2026-07-29T12:00:00.000Z",
      expiresAt: "2026-07-29T12:01:00.000Z"
    });
    expect(value.taskState).toBe("running");
  });

  it("rejects accidental prompt or project fields", () => {
    expect(() =>
      petStateEnvelopeSchema.parse({
        schemaVersion: 1,
        ownerDeviceId: "6b31fd25-8a22-43bc-82c4-e0850a1a8c21",
        sequence: 4,
        presence: "online",
        taskState: "running",
        energyState: "focused",
        eventId: null,
        updatedAt: "2026-07-29T12:00:00.000Z",
        expiresAt: "2026-07-29T12:01:00.000Z",
        prompt: "secret"
      }),
    ).toThrow();
  });
});
