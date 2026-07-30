import websocket from "@fastify/websocket";
import {
  claimPairingRequestSchema,
  petStateEnvelopeSchema,
  websocketClientMessageSchema,
  type WebsocketServerMessage,
} from "@petlink/protocol";
import Fastify, { type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { PetRepository } from "./model.js";
import { RealtimeHub } from "./realtime-hub.js";
import { bearerToken, hashSecret, newDeviceToken, newPairingCode } from "./security.js";

declare module "fastify" {
  interface FastifyRequest {
    deviceId?: string;
  }
}

export interface BuildAppOptions {
  repository: PetRepository;
  logger?: boolean;
  now?: () => Date;
  hub?: RealtimeHub;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const now = options.now ?? (() => new Date());
  const hub = options.hub ?? new RealtimeHub();
  await app.register(websocket);

  async function authenticate(request: FastifyRequest): Promise<string | null> {
    const token = bearerToken(request.headers.authorization);
    if (!token) return null;
    const device = await options.repository.findDeviceByTokenHash(hashSecret(token));
    if (!device) return null;
    request.deviceId = device.id;
    return device.id;
  }

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/v1/devices/register", async (_request, reply) => {
    const deviceToken = newDeviceToken();
    const at = now();
    const deviceId = randomUUID();
    await options.repository.createDevice({
      id: deviceId,
      tokenHash: hashSecret(deviceToken),
      createdAt: at,
      lastSeenAt: at,
      pairingAttempts: 0,
      pairingAttemptWindowStarted: null,
    });
    return reply.code(201).send({ deviceId, deviceToken });
  });

  app.post("/v1/pairings", async (request, reply) => {
    const deviceId = await authenticate(request);
    if (!deviceId) return reply.code(401).send({ error: "unauthorized" });
    if (await options.repository.isPaired(deviceId)) return reply.code(409).send({ error: "already_paired" });

    const code = newPairingCode();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60_000);
    await options.repository.createPairingCode({
      id: randomUUID(),
      creatorDeviceId: deviceId,
      codeHash: hashSecret(code),
      expiresAt,
      failedAttempts: 0,
      claimedBy: null,
      createdAt,
    });
    return reply.code(201).send({ code, expiresAt: expiresAt.toISOString() });
  });

  app.post("/v1/pairings/claim", async (request, reply) => {
    const deviceId = await authenticate(request);
    if (!deviceId) return reply.code(401).send({ error: "unauthorized" });
    const parsed = claimPairingRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_code" });
    if (!(await options.repository.consumePairingAttempt(deviceId, now()))) {
      return reply.code(429).send({ error: "too_many_attempts" });
    }
    const result = await options.repository.claimPairingCode(hashSecret(parsed.data.code), deviceId, now());
    if (!result.ok) return reply.code(result.reason === "not_found" ? 404 : 409).send({ error: result.reason });
    hub.send(result.pairing.deviceA, { type: "pair.created", friendDeviceId: deviceId });
    return reply.code(200).send({ paired: true, friendDeviceId: result.pairing.deviceA });
  });

  app.get("/v1/pairing", async (request, reply) => {
    const deviceId = await authenticate(request);
    if (!deviceId) return reply.code(401).send({ error: "unauthorized" });
    const friendDeviceId = await options.repository.getFriendDeviceId(deviceId);
    return { paired: friendDeviceId !== null, friendDeviceId };
  });

  app.delete("/v1/pairing", async (request, reply) => {
    const deviceId = await authenticate(request);
    if (!deviceId) return reply.code(401).send({ error: "unauthorized" });
    const friend = await options.repository.removePairing(deviceId);
    if (!friend) return reply.code(404).send({ error: "not_paired" });
    hub.send(friend, { type: "pair.revoked" });
    return reply.code(204).send();
  });

  app.get("/v1/state/snapshot", async (request, reply) => {
    const deviceId = await authenticate(request);
    if (!deviceId) return reply.code(401).send({ error: "unauthorized" });
    return { states: await options.repository.listPairState(deviceId) };
  });

  app.get("/v1/realtime", { websocket: true }, async (socket, request) => {
    const deviceId = await authenticate(request);
    if (!deviceId) {
      socket.close(1008, "unauthorized");
      return;
    }
    const remove = hub.add(deviceId, socket);
    hub.send(deviceId, { type: "hello", deviceId });
    hub.send(deviceId, { type: "snapshot", states: await options.repository.listPairState(deviceId) });

    socket.on("message", async (raw: { toString(): string }) => {
      const parsedJson = safeJson(raw.toString());
      const parsed = websocketClientMessageSchema.safeParse(parsedJson);
      if (!parsed.success) {
        sendSocket(socket, { type: "error", code: "invalid_message", message: "Message failed validation" });
        return;
      }
      await options.repository.touchDevice(deviceId, now());
      if (parsed.data.type === "heartbeat") {
        sendSocket(socket, { type: "heartbeat", receivedAt: now().toISOString() });
        return;
      }
      const state = petStateEnvelopeSchema.parse(parsed.data.state);
      if (state.ownerDeviceId !== deviceId) {
        sendSocket(socket, { type: "error", code: "owner_mismatch", message: "State owner does not match token" });
        return;
      }
      const saved = await options.repository.saveState(state);
      if (!saved) return;
      const friend = await options.repository.getFriendDeviceId(deviceId);
      if (friend) hub.send(friend, { type: "pet.state", state });
    });
    socket.on("close", remove);
  });

  return app;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sendSocket(socket: { send(data: string): void }, message: WebsocketServerMessage): void {
  socket.send(JSON.stringify(message));
}
