import type { PetStateEnvelope } from "@petlink/protocol";
import { randomUUID } from "node:crypto";
import type { ClaimResult, Device, Pairing, PairingCode, PetRepository } from "./model.js";

export class MemoryPetRepository implements PetRepository {
  readonly devices = new Map<string, Device>();
  readonly codes = new Map<string, PairingCode>();
  readonly pairings = new Map<string, Pairing>();
  readonly states = new Map<string, PetStateEnvelope>();

  async createDevice(device: Device): Promise<void> {
    this.devices.set(device.id, device);
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    return [...this.devices.values()].find((device) => device.tokenHash === tokenHash) ?? null;
  }

  async touchDevice(deviceId: string, now: Date): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) device.lastSeenAt = now;
  }

  async consumePairingAttempt(deviceId: string, now: Date): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    const windowExpired =
      device.pairingAttemptWindowStarted === null ||
      now.getTime() - device.pairingAttemptWindowStarted.getTime() >= 10 * 60_000;
    if (windowExpired) {
      device.pairingAttempts = 1;
      device.pairingAttemptWindowStarted = now;
    } else {
      device.pairingAttempts += 1;
    }
    return device.pairingAttempts <= 5;
  }

  async isPaired(deviceId: string): Promise<boolean> {
    return (await this.getFriendDeviceId(deviceId)) !== null;
  }

  async createPairingCode(code: PairingCode): Promise<void> {
    this.codes.set(code.codeHash, code);
  }

  async claimPairingCode(codeHash: string, claimantDeviceId: string, now: Date): Promise<ClaimResult> {
    const code = this.codes.get(codeHash);
    if (!code) return { ok: false, reason: "not_found" };
    if (code.claimedBy) return { ok: false, reason: "already_claimed" };
    if (code.failedAttempts >= 5) return { ok: false, reason: "attempts_exceeded" };
    if (code.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
    if (code.creatorDeviceId === claimantDeviceId) return { ok: false, reason: "self_pair" };
    if ((await this.isPaired(code.creatorDeviceId)) || (await this.isPaired(claimantDeviceId))) {
      return { ok: false, reason: "already_paired" };
    }

    code.claimedBy = claimantDeviceId;
    const pairing: Pairing = {
      id: randomUUID(),
      deviceA: code.creatorDeviceId,
      deviceB: claimantDeviceId,
      createdAt: now,
    };
    this.pairings.set(pairing.id, pairing);
    return { ok: true, pairing };
  }

  async getFriendDeviceId(deviceId: string): Promise<string | null> {
    for (const pairing of this.pairings.values()) {
      if (pairing.deviceA === deviceId) return pairing.deviceB;
      if (pairing.deviceB === deviceId) return pairing.deviceA;
    }
    return null;
  }

  async removePairing(deviceId: string): Promise<string | null> {
    for (const [id, pairing] of this.pairings) {
      if (pairing.deviceA !== deviceId && pairing.deviceB !== deviceId) continue;
      const friend = pairing.deviceA === deviceId ? pairing.deviceB : pairing.deviceA;
      this.pairings.delete(id);
      this.states.delete(deviceId);
      this.states.delete(friend);
      return friend;
    }
    return null;
  }

  async listPairState(deviceId: string): Promise<PetStateEnvelope[]> {
    const friend = await this.getFriendDeviceId(deviceId);
    const ids = friend ? [deviceId, friend] : [deviceId];
    return ids.flatMap((id) => {
      const state = this.states.get(id);
      return state ? [state] : [];
    });
  }

  async saveState(state: PetStateEnvelope): Promise<boolean> {
    const previous = this.states.get(state.ownerDeviceId);
    if (previous && previous.sequence >= state.sequence) return false;
    this.states.set(state.ownerDeviceId, state);
    return true;
  }
}
