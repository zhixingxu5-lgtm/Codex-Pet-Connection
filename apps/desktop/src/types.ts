import type { EnergyState, Presence, TaskState } from "@petlink/protocol";

export interface PetViewState {
  owner: "self" | "friend";
  presence: Presence;
  taskState: TaskState | null;
  energyState: EnergyState | null;
  limitedDetection: boolean;
  updatedAt: string;
}

export interface DesktopSnapshot {
  selfPet: PetViewState;
  friendPet: PetViewState;
  paired: boolean;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  shareEnergy: boolean;
  privacyPaused: boolean;
  reduceMotion: boolean;
  serverUrl: string;
  appServerConnected: boolean;
  hookConnected: boolean;
}
