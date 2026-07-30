import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "deploy/tencent-cloud/Caddyfile",
  "deploy/tencent-cloud/docker-compose.prod.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/package-preview-builds.yml",
  ".github/workflows/release.yml",
  ".github/workflows/generate-cargo-lock.yml",
];
for (const file of requiredFiles) await access(resolve(file));

const catalog = JSON.parse(await readFile("apps/desktop/public/pets/catalog.json", "utf8"));
const manifest = JSON.parse(await readFile("apps/desktop/public/pets/pingu/manifest.json", "utf8"));
const expectedAnimations = [
  "idle_relaxed", "idle_focused", "idle_tired", "idle_exhausted",
  "running_relaxed", "running_focused", "running_tired", "running_exhausted",
  "needs_input", "ready", "blocked", "offline",
];
assert(catalog.defaultPetId === "pingu", "Pingu must remain the MVP default pet");
assert(catalog.pets?.length === 1 && catalog.pets[0].id === "pingu", "MVP catalog must contain only Pingu");
assert(manifest.sprite?.frameWidth === 192 && manifest.sprite?.frameHeight === 208, "invalid Pingu frame size");
assert(manifest.sprite?.frameCount === 8, "invalid Pingu frame count");
assert(Object.keys(manifest.animations ?? {}).sort().join() === expectedAnimations.sort().join(), "Pingu animation slots are incomplete");
const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const desktopPackage = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
const tauriConfig = JSON.parse(await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
const pluginManifest = JSON.parse(await readFile("integrations/codex-marketplace/plugins/codex-pet-link/.codex-plugin/plugin.json", "utf8"));
assert(
  new Set([rootPackage.version, desktopPackage.version, tauriConfig.version, pluginManifest.version]).size === 1,
  "root, desktop, Tauri, and plugin versions must match",
);
console.log("Repository release contract validation passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
