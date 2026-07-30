import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const marketplacePath = resolve("integrations/codex-marketplace/marketplace.json");
const pluginRoot = resolve("integrations/codex-marketplace/plugins/codex-pet-link");
const manifestPath = resolve(pluginRoot, ".codex-plugin/plugin.json");
const hooksPath = resolve(pluginRoot, "hooks/hooks.json");

const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const hooks = JSON.parse(await readFile(hooksPath, "utf8"));

assert(manifest.name === "codex-pet-link", "plugin name must match its folder");
assert(typeof manifest.version === "string" && manifest.version.length > 0, "plugin version is required");
assert(!("hooks" in manifest), "hooks is not a supported plugin manifest field");
assert(!JSON.stringify(manifest).includes("[TODO:"), "plugin manifest contains TODO placeholders");

const entry = marketplace.plugins?.find((plugin) => plugin.name === manifest.name);
assert(entry, "marketplace entry is missing");
assert(entry.source?.source === "local", "marketplace source must be local");
assert(entry.source?.path === "./plugins/codex-pet-link", "marketplace source path is invalid");
assert(entry.policy?.installation === "AVAILABLE", "installation policy must be AVAILABLE");
assert(entry.policy?.authentication === "ON_INSTALL", "authentication policy must be ON_INSTALL");
assert(typeof entry.category === "string", "marketplace category is required");

const expectedEvents = ["UserPromptSubmit", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd"];
assert(Object.keys(hooks.hooks ?? {}).sort().join() === expectedEvents.sort().join(), "hook event set changed");
for (const eventName of expectedEvents) {
  const commands = hooks.hooks[eventName]?.flatMap((group) => group.hooks ?? []) ?? [];
  assert(commands.length > 0, `${eventName} has no hook command`);
  for (const command of commands) {
    assert(command.type === "command", `${eventName} must use a command hook`);
    assert(command.timeout <= 3, `${eventName} timeout must not block Codex`);
  }
}
await access(resolve(pluginRoot, "scripts/petlink-hook.sh"));
await access(resolve(pluginRoot, "scripts/petlink-hook.cmd"));
await access(resolve(pluginRoot, "scripts/petlink-hook.mjs"));
console.log("Codex plugin and marketplace validation passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
