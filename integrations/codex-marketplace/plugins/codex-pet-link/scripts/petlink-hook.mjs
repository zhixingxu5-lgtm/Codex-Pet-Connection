import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createConnection } from "node:net";

const ALLOWED_EVENTS = new Set([
  "UserPromptSubmit",
  "PermissionRequest",
  "PostToolUse",
  "Stop",
  "SessionEnd",
]);

export function sanitizeHookInput(input, occurredAt = new Date().toISOString()) {
  if (!input || typeof input !== "object") throw new Error("hook input must be an object");
  if (!ALLOWED_EVENTS.has(input.hook_event_name)) throw new Error("unsupported hook event");
  if (typeof input.session_id !== "string" || input.session_id.length === 0) throw new Error("missing session id");
  return {
    sessionId: input.session_id,
    turnId: typeof input.turn_id === "string" ? input.turn_id : null,
    eventName: input.hook_event_name,
    occurredAt,
  };
}

export function defaultSecretPath(platform = process.platform, env = process.env) {
  if (env.PETLINK_HOOK_SECRET_FILE) return env.PETLINK_HOOK_SECRET_FILE;
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "com.codexpetlink.app", "hook-secret");
  if (platform === "darwin") return join(env.HOME ?? homedir(), "Library", "Application Support", "com.codexpetlink.app", "hook-secret");
  return join(env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), ".local", "share"), "com.codexpetlink.app", "hook-secret");
}

export function defaultPipePath(platform = process.platform, env = process.env) {
  if (env.PETLINK_HOOK_PIPE) return env.PETLINK_HOOK_PIPE;
  if (platform === "win32") return String.raw`\\.\pipe\codex-pet-link`;
  return join(dirname(defaultSecretPath(platform, env)), "hook.sock");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function send(message) {
  const secret = (await readFile(defaultSecretPath(), "utf8")).trim();
  await new Promise((resolve, reject) => {
    const socket = createConnection(defaultPipePath(), () => {
      socket.end(`${JSON.stringify({ authToken: secret, event: message })}\n`);
    });
    socket.setTimeout(2000, () => socket.destroy(new Error("desktop app hook listener timed out")));
    socket.on("error", reject);
    socket.on("close", (hadError) => (hadError ? undefined : resolve()));
  });
}

export async function main() {
  try {
    const raw = JSON.parse(await readStdin());
    await send(sanitizeHookInput(raw));
  } catch {
    // Hooks are advisory. Codex work must continue when the desktop app is closed.
  }
  process.stdout.write("{}\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
