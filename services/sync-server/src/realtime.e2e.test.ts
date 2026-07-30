import { once } from "node:events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "./app.js";
import { MemoryPetRepository } from "./memory-repository.js";

const realtime = process.env.RUN_NETWORK_E2E === "1" ? describe : describe.skip;

realtime("two-device realtime flow", () => {
  it("syncs privacy-safe state, restores a snapshot, and revokes the room", async () => {
    const app = await buildApp({ repository: new MemoryPetRepository() });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const wsUrl = address.replace("http://", "ws://") + "/v1/realtime";
    const a = await register(app);
    const b = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/pairings",
      headers: auth(a.deviceToken),
    });
    const { code } = created.json<{ code: string }>();
    await app.inject({
      method: "POST",
      url: "/v1/pairings/claim",
      headers: auth(b.deviceToken),
      payload: { code },
    });

    const clientA = await connect(wsUrl, a.deviceToken);
    let clientB = await connect(wsUrl, b.deviceToken);
    const startedAt = performance.now();
    clientA.socket.send(JSON.stringify({
      type: "pet.state",
      state: stateEnvelope(a.deviceId, 1, "running", "focused"),
    }));
    const running = await clientB.waitFor((message) => message.type === "pet.state");
    expect(running.state.taskState).toBe("running");
    expect(performance.now() - startedAt).toBeLessThan(2_000);

    clientA.socket.send(JSON.stringify({
      type: "pet.state",
      state: {
        ...stateEnvelope(a.deviceId, 2, null, null),
        presence: "privacy_hidden",
      },
    }));
    const hidden = await clientB.waitFor(
      (message) => message.type === "pet.state" && message.state.sequence === 2,
    );
    expect(hidden.state).toMatchObject({
      presence: "privacy_hidden",
      taskState: null,
      energyState: null,
    });

    clientB.socket.close();
    await once(clientB.socket, "close");
    clientB = await connect(wsUrl, b.deviceToken);
    const snapshot = await clientB.waitFor((message) => message.type === "snapshot");
    expect(snapshot.states).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerDeviceId: a.deviceId, sequence: 2 }),
    ]));

    await app.inject({
      method: "DELETE",
      url: "/v1/pairing",
      headers: auth(a.deviceToken),
    });
    expect(await clientB.waitFor((message) => message.type === "pair.revoked")).toEqual({
      type: "pair.revoked",
    });

    clientA.socket.close();
    clientB.socket.close();
    await app.close();
  });
});

async function register(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: "POST", url: "/v1/devices/register" });
  return response.json<{ deviceId: string; deviceToken: string }>();
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function stateEnvelope(
  ownerDeviceId: string,
  sequence: number,
  taskState: "running" | null,
  energyState: "focused" | null,
) {
  return {
    schemaVersion: 1,
    ownerDeviceId,
    sequence,
    presence: "online",
    taskState,
    energyState,
    eventId: null,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function connect(url: string, token: string) {
  const socket = new WebSocket(url, { headers: auth(token) });
  const messages: any[] = [];
  const listeners = new Set<() => void>();
  socket.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const listener of listeners) listener();
  });
  await once(socket, "open");
  return {
    socket,
    waitFor(predicate: (message: any) => boolean, timeoutMs = 2_000): Promise<any> {
      return new Promise((resolve, reject) => {
        const inspect = () => {
          const index = messages.findIndex(predicate);
          if (index < 0) return;
          cleanup();
          resolve(messages.splice(index, 1)[0]);
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("timed out waiting for WebSocket message"));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timeout);
          listeners.delete(inspect);
        };
        listeners.add(inspect);
        inspect();
      });
    },
  };
}
