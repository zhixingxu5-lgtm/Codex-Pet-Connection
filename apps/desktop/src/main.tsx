import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PetWindow } from "./pet/PetWindow";
import { SettingsApp } from "./settings/SettingsApp";
import "./styles.css";

const label = getCurrentWindow().label;
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {label === "self-pet" || label === "friend-pet" ? (
      <PetWindow owner={label === "self-pet" ? "self" : "friend"} />
    ) : (
      <SettingsApp />
    )}
  </StrictMode>,
);
