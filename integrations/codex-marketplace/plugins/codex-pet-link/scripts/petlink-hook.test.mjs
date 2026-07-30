import assert from "node:assert/strict";
import test from "node:test";
import { defaultPipePath, sanitizeHookInput } from "./petlink-hook.mjs";

test("sanitizer keeps only non-sensitive lifecycle fields", () => {
  const sanitized = sanitizeHookInput({
    session_id: "thr_123",
    turn_id: "turn_456",
    hook_event_name: "UserPromptSubmit",
    prompt: "top secret",
    cwd: "/secret/project",
    transcript_path: "/secret/transcript.jsonl",
    tool_input: { command: "print-secret" },
    last_assistant_message: "private answer"
  }, "2026-07-29T12:00:00.000Z");
  assert.deepEqual(sanitized, {
    sessionId: "thr_123",
    turnId: "turn_456",
    eventName: "UserPromptSubmit",
    occurredAt: "2026-07-29T12:00:00.000Z"
  });
  const wire = JSON.stringify(sanitized);
  for (const forbidden of ["top secret", "/secret/project", "print-secret", "private answer"]) {
    assert.equal(wire.includes(forbidden), false);
  }
});

test("sanitizer rejects events the desktop app does not consume", () => {
  assert.throws(() => sanitizeHookInput({ session_id: "thr_123", hook_event_name: "PreToolUse" }));
});

test("accepts every lifecycle event declared by the plugin", () => {
  for (const eventName of ["UserPromptSubmit", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd"]) {
    expectLifecycle(eventName);
  }
});

test("uses a user-scoped named pipe on both desktop platforms", () => {
  assert.equal(defaultPipePath("win32", {}), String.raw`\\.\pipe\codex-pet-link`);
  assert.equal(
    defaultPipePath("darwin", { HOME: "/Users/test" }),
    "/Users/test/Library/Application Support/com.codexpetlink.app/hook.sock",
  );
});

function expectLifecycle(hook_event_name) {
  assert.equal(
    sanitizeHookInput({ session_id: "thr_123", hook_event_name }, "2026-07-29T12:00:00.000Z").eventName,
    hook_event_name,
  );
}
