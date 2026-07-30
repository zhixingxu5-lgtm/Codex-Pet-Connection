import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MemoryPetRepository } from "./memory-repository.js";

async function register(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: "POST", url: "/v1/devices/register" });
  expect(response.statusCode).toBe(201);
  return response.json<{ deviceId: string; deviceToken: string }>();
}

describe("pairing API", () => {
  it("registers, pairs, snapshots, and revokes two devices", async () => {
    const repository = new MemoryPetRepository();
    const app = await buildApp({ repository });
    const a = await register(app);
    const b = await register(app);

    const create = await app.inject({
      method: "POST",
      url: "/v1/pairings",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    expect(create.statusCode).toBe(201);
    const { code } = create.json<{ code: string }>();

    const claim = await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: { authorization: `Bearer ${b.deviceToken}` },
      payload: { code },
    });
    expect(claim.statusCode).toBe(200);
    expect(await repository.getFriendDeviceId(a.deviceId)).toBe(b.deviceId);

    const snapshot = await app.inject({
      method: "GET",
      url: "/v1/state/snapshot",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toEqual({ states: [] });

    const revoke = await app.inject({
      method: "DELETE",
      url: "/v1/pairing",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    expect(revoke.statusCode).toBe(204);
    expect(await repository.getFriendDeviceId(b.deviceId)).toBeNull();
    await app.close();
  });

  it("rejects a reused code and a second pairing", async () => {
    const repository = new MemoryPetRepository();
    const app = await buildApp({ repository });
    const a = await register(app);
    const b = await register(app);
    const c = await register(app);
    const create = await app.inject({
      method: "POST",
      url: "/v1/pairings",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    const { code } = create.json<{ code: string }>();
    await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: { authorization: `Bearer ${b.deviceToken}` },
      payload: { code },
    });
    const reused = await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: { authorization: `Bearer ${c.deviceToken}` },
      payload: { code },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({ error: "already_claimed" });
    await app.close();
  });

  it("limits one device to five pairing claims per ten-minute window", async () => {
    const repository = new MemoryPetRepository();
    const app = await buildApp({ repository });
    const device = await register(app);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/pairings/claim",
        headers: { authorization: `Bearer ${device.deviceToken}` },
        payload: { code: "00000000" },
      });
      expect(response.statusCode).toBe(404);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: { authorization: `Bearer ${device.deviceToken}` },
      payload: { code: "00000000" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "too_many_attempts" });
    await app.close();
  });

  it("expires a pairing code after ten minutes", async () => {
    const repository = new MemoryPetRepository();
    let currentTime = new Date("2026-07-29T12:00:00.000Z");
    const app = await buildApp({ repository, now: () => currentTime });
    const a = await register(app);
    const b = await register(app);
    const create = await app.inject({
      method: "POST",
      url: "/v1/pairings",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    const { code } = create.json<{ code: string }>();
    currentTime = new Date("2026-07-29T12:10:00.001Z");
    const claim = await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: { authorization: `Bearer ${b.deviceToken}` },
      payload: { code },
    });
    expect(claim.statusCode).toBe(409);
    expect(claim.json()).toEqual({ error: "expired" });
    await app.close();
  });

  it("removes friendship snapshot access immediately after unpairing", async () => {
    const repository = new MemoryPetRepository();
    const app = await buildApp({ repository });
    const a = await register(app);
    const b = await register(app);
    const create = await app.inject({
      method: "POST",
      url: "/v1/pairings",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    const { code } = create.json<{ code: string }>();
    await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: { authorization: `Bearer ${b.deviceToken}` },
      payload: { code },
    });
    await repository.saveState({
      schemaVersion: 1,
      ownerDeviceId: b.deviceId,
      sequence: 1,
      presence: "online",
      taskState: "running",
      energyState: "focused",
      eventId: null,
      updatedAt: "2026-07-29T12:00:00.000Z",
      expiresAt: "2026-07-29T12:01:00.000Z",
    });
    await app.inject({
      method: "DELETE",
      url: "/v1/pairing",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    await repository.saveState({
      schemaVersion: 1,
      ownerDeviceId: b.deviceId,
      sequence: 2,
      presence: "online",
      taskState: "ready",
      energyState: "focused",
      eventId: null,
      updatedAt: "2026-07-29T12:00:30.000Z",
      expiresAt: "2026-07-29T12:01:30.000Z",
    });
    const snapshot = await app.inject({
      method: "GET",
      url: "/v1/state/snapshot",
      headers: { authorization: `Bearer ${a.deviceToken}` },
    });
    expect(snapshot.json()).toEqual({ states: [] });
    await app.close();
  });
});
