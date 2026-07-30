import { describe, expect, it } from "vitest";
import { resolveAnimation } from "./animation";

describe("animation resolver", () => {
  it("selects task and energy variants", () => {
    const exhausted = resolveAnimation("online", "running", "exhausted");
    expect(exhausted.key).toBe("running_exhausted");
    expect(exhausted.url).toBe("/pets/pingu/sprites/running_exhausted.webp");
    expect(resolveAnimation("online", "idle", "relaxed").key).toBe("idle_relaxed");
  });

  it("uses neutral and presence-safe animations", () => {
    expect(resolveAnimation("online", "running", null).key).toBe("running_focused");
    expect(resolveAnimation("privacy_hidden", null, null).key).toBe("offline");
  });
});
