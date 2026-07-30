import type { PetStateEnvelope } from "@petlink/protocol";

export interface Device {
  id: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  pairingAttempts: number;
  pairingAttemptWindowStarted: Date | null;
}

export interface PairingCode {
  id: string;
  creatorDeviceId: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  claimedBy: string | null;
  createdAt: Date;
}

export interface Pairing {
  id: string;
  deviceA: string;
  deviceB: string;
  createdAt: Date;
}

export type ClaimResult =
  | { ok: true; pairing: Pairing }
  | { ok: false; reason: "not_found" | "expired" | "attempts_exceeded" | "already_claimed" | "self_pair" | "already_paired" };

export interface PetRepository {
  createDevice(device: Device): Promise<void>;
  findDeviceByTokenHash(tokenHash: string): Promise<Device | null>;
  touchDevice(deviceId: string, now: Date): Promise<void>;
  consumePairingAttempt(deviceId: string, now: Date): Promise<boolean>;
  isPaired(deviceId: string): Promise<boolean>;
  createPairingCode(code: PairingCode): Promise<void>;
  claimPairingCode(codeHash: string, claimantDeviceId: string, now: Date): Promise<ClaimResult>;
  getFriendDeviceId(deviceId: string): Promise<string | null>;
  removePairing(deviceId: string): Promise<string | null>;
  listPairState(deviceId: string): Promise<PetStateEnvelope[]>;
  saveState(state: PetStateEnvelope): Promise<boolean>;
}
