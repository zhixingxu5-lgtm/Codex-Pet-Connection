import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TaskState } from "@petlink/protocol";
import type { DesktopSnapshot, PetViewState } from "./types";

export const desktopApi = {
  snapshot: () => invoke<DesktopSnapshot>("get_snapshot"),
  createPairing: () => invoke<DesktopSnapshot>("create_pairing"),
  claimPairing: (code: string) => invoke<DesktopSnapshot>("claim_pairing", { code }),
  unpair: () => invoke<DesktopSnapshot>("unpair"),
  updateSettings: (settings: { shareEnergy?: boolean; privacyPaused?: boolean; reduceMotion?: boolean }) =>
    invoke<DesktopSnapshot>("update_settings", { settings }),
  simulate: (state: TaskState) => invoke<DesktopSnapshot>("simulate_state", { taskState: state }),
  installPlugin: () => invoke<string>("install_codex_plugin"),
  uninstallPlugin: () => invoke<string>("uninstall_codex_plugin"),
  showPetWindows: (visible: boolean) => invoke<void>("set_pet_windows_visible", { visible }),
  onPetState: (handler: (state: PetViewState) => void) =>
    listen<PetViewState>("pet-state", (event) => handler(event.payload)),
  onSnapshot: (handler: (state: DesktopSnapshot) => void) =>
    listen<DesktopSnapshot>("desktop-snapshot", (event) => handler(event.payload)),
};
