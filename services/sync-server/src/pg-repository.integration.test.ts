import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgPetRepository } from "./pg-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

integration("PostgreSQL repository", () => {
  const repository = new PgPetRepository(pool!);

  beforeAll(async () => {
    const migration = await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8");
    await pool!.query(migration);
    await pool!.query("TRUNCATE pet_state_snapshots, pairings, pairing_codes, devices CASCADE");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("pairs two devices, rejects stale state, and revokes snapshot access", async () => {
    const now = new Date("2026-07-30T08:00:00.000Z");
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    for (const [id, tokenHash] of [[deviceA, "token-a"], [deviceB, "token-b"]] as const) {
      await repository.createDevice({
        id,
        tokenHash,
        createdAt: now,
        lastSeenAt: now,
        pairingAttempts: 0,
        pairingAttemptWindowStarted: null,
      });
    }
    await repository.createPairingCode({
      id: randomUUID(),
      creatorDeviceId: deviceA,
      codeHash: "pair-code-hash",
      expiresAt: new Date(now.getTime() + 600_000),
      failedAttempts: 0,
      claimedBy: null,
      createdAt: now,
    });
    const claimed = await repository.claimPairingCode("pair-code-hash", deviceB, now);
    expect(claimed.ok).toBe(true);
    expect(await repository.getFriendDeviceId(deviceA)).toBe(deviceB);

    const state = {
      schemaVersion: 1 as const,
      ownerDeviceId: deviceB,
      sequence: 2,
      presence: "online" as const,
      taskState: "running" as const,
      energyState: "focused" as const,
      eventId: null,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    };
    expect(await repository.saveState(state)).toBe(true);
    expect(await repository.saveState({ ...state, sequence: 1 })).toBe(false);
    expect(await repository.listPairState(deviceA)).toHaveLength(1);

    expect(await repository.removePairing(deviceA)).toBe(deviceB);
    expect(await repository.listPairState(deviceA)).toEqual([]);
  });
});
