import type { PetStateEnvelope } from "@petlink/protocol";
import { petStateEnvelopeSchema } from "@petlink/protocol";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { ClaimResult, Device, PairingCode, PetRepository } from "./model.js";

export class PgPetRepository implements PetRepository {
  constructor(private readonly pool: Pool) {}

  async createDevice(device: Device): Promise<void> {
    await this.pool.query(
      `INSERT INTO devices (id, token_hash, created_at, last_seen_at, pairing_attempts, pairing_attempt_window_started)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [device.id, device.tokenHash, device.createdAt, device.lastSeenAt, device.pairingAttempts, device.pairingAttemptWindowStarted],
    );
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    const result = await this.pool.query(
      `SELECT id, token_hash, created_at, last_seen_at, pairing_attempts, pairing_attempt_window_started FROM devices WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          tokenHash: row.token_hash,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          pairingAttempts: row.pairing_attempts,
          pairingAttemptWindowStarted: row.pairing_attempt_window_started,
        }
      : null;
  }

  async touchDevice(deviceId: string, now: Date): Promise<void> {
    await this.pool.query(`UPDATE devices SET last_seen_at = $2 WHERE id = $1`, [deviceId, now]);
  }

  async consumePairingAttempt(deviceId: string, now: Date): Promise<boolean> {
    const cutoff = new Date(now.getTime() - 10 * 60_000);
    const result = await this.pool.query(
      `UPDATE devices
       SET pairing_attempts = CASE
         WHEN pairing_attempt_window_started IS NULL OR pairing_attempt_window_started <= $3 THEN 1
         ELSE pairing_attempts + 1
       END,
       pairing_attempt_window_started = CASE
         WHEN pairing_attempt_window_started IS NULL OR pairing_attempt_window_started <= $3 THEN $2
         ELSE pairing_attempt_window_started
       END
       WHERE id = $1
       RETURNING pairing_attempts`,
      [deviceId, now, cutoff],
    );
    return (result.rows[0]?.pairing_attempts ?? 6) <= 5;
  }

  async isPaired(deviceId: string): Promise<boolean> {
    return (await this.getFriendDeviceId(deviceId)) !== null;
  }

  async createPairingCode(code: PairingCode): Promise<void> {
    await this.pool.query(
      `INSERT INTO pairing_codes (id, creator_device_id, code_hash, expires_at, failed_attempts, claimed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [code.id, code.creatorDeviceId, code.codeHash, code.expiresAt, code.failedAttempts, code.claimedBy, code.createdAt],
    );
  }

  async claimPairingCode(codeHash: string, claimantDeviceId: string, now: Date): Promise<ClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id, creator_device_id, expires_at, failed_attempts, claimed_by
         FROM pairing_codes WHERE code_hash = $1 FOR UPDATE`,
        [codeHash],
      );
      const row = result.rows[0];
      if (!row) return await rollback(client, { ok: false, reason: "not_found" });
      if (row.claimed_by) return await rollback(client, { ok: false, reason: "already_claimed" });
      if (row.failed_attempts >= 5) return await rollback(client, { ok: false, reason: "attempts_exceeded" });
      if (new Date(row.expires_at).getTime() <= now.getTime()) return await rollback(client, { ok: false, reason: "expired" });
      if (row.creator_device_id === claimantDeviceId) return await rollback(client, { ok: false, reason: "self_pair" });

      await client.query(
        `SELECT id FROM devices WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [[row.creator_device_id, claimantDeviceId]],
      );
      const paired = await client.query(
        `SELECT 1 FROM pairings WHERE device_a = ANY($1::uuid[]) OR device_b = ANY($1::uuid[]) LIMIT 1`,
        [[row.creator_device_id, claimantDeviceId]],
      );
      if (paired.rowCount) return await rollback(client, { ok: false, reason: "already_paired" });

      const pairing = {
        id: randomUUID(),
        deviceA: row.creator_device_id,
        deviceB: claimantDeviceId,
        createdAt: now,
      };
      await client.query(
        `INSERT INTO pairings (id, device_a, device_b, created_at) VALUES ($1, $2, $3, $4)`,
        [pairing.id, pairing.deviceA, pairing.deviceB, pairing.createdAt],
      );
      await client.query(`UPDATE pairing_codes SET claimed_by = $2 WHERE id = $1`, [row.id, claimantDeviceId]);
      await client.query("COMMIT");
      return { ok: true, pairing };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getFriendDeviceId(deviceId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT CASE WHEN device_a = $1 THEN device_b ELSE device_a END AS friend
       FROM pairings WHERE device_a = $1 OR device_b = $1 LIMIT 1`,
      [deviceId],
    );
    return result.rows[0]?.friend ?? null;
  }

  async removePairing(deviceId: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pairing = await client.query(
        `DELETE FROM pairings WHERE device_a = $1 OR device_b = $1
         RETURNING CASE WHEN device_a = $1 THEN device_b ELSE device_a END AS friend`,
        [deviceId],
      );
      const friend: string | undefined = pairing.rows[0]?.friend;
      if (friend) {
        await client.query(`DELETE FROM pet_state_snapshots WHERE owner_device_id = ANY($1::uuid[])`, [[deviceId, friend]]);
      }
      await client.query("COMMIT");
      return friend ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listPairState(deviceId: string): Promise<PetStateEnvelope[]> {
    const friend = await this.getFriendDeviceId(deviceId);
    const result = await this.pool.query(
      `SELECT state FROM pet_state_snapshots WHERE owner_device_id = ANY($1::uuid[])`,
      [friend ? [deviceId, friend] : [deviceId]],
    );
    return result.rows.map((row) => petStateEnvelopeSchema.parse(row.state));
  }

  async saveState(state: PetStateEnvelope): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO pet_state_snapshots (owner_device_id, sequence, state, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (owner_device_id) DO UPDATE
       SET sequence = EXCLUDED.sequence, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
       WHERE pet_state_snapshots.sequence < EXCLUDED.sequence`,
      [state.ownerDeviceId, state.sequence, JSON.stringify(state), new Date(state.updatedAt)],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

async function rollback<T extends ClaimResult>(client: PoolClient, result: T): Promise<T> {
  await client.query("ROLLBACK");
  return result;
}
