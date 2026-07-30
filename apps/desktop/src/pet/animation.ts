import type { EnergyState, Presence, TaskState } from "@petlink/protocol";

export const SPRITE_FRAME_WIDTH = 192;
export const SPRITE_FRAME_HEIGHT = 208;
export const SPRITE_FRAME_COUNT = 8;
export const DEFAULT_PET_ID = "pingu";

export type AnimationKey =
  | `idle_${EnergyState}`
  | `running_${EnergyState}`
  | "needs_input"
  | "ready"
  | "blocked"
  | "offline";

export interface ResolvedAnimation {
  key: AnimationKey;
  url: string;
  loop: boolean;
}

export function resolveAnimation(
  presence: Presence,
  taskState: TaskState | null,
  energyState: EnergyState | null,
): ResolvedAnimation {
  let key: AnimationKey;
  if (presence === "offline" || presence === "reconnecting" || presence === "privacy_hidden") {
    key = "offline";
  } else if (taskState === "needs_input" || taskState === "ready" || taskState === "blocked") {
    key = taskState;
  } else {
    const energy = energyState ?? "focused";
    key = `${taskState === "running" ? "running" : "idle"}_${energy}`;
  }
  return {
    key,
    url: `/pets/${DEFAULT_PET_ID}/sprites/${key}.webp`,
    loop: key !== "ready",
  };
}
