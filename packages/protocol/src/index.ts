import { z } from "zod";

export const presenceSchema = z.enum([
  "online",
  "reconnecting",
  "offline",
  "privacy_hidden",
]);

export const taskStateSchema = z.enum([
  "idle",
  "running",
  "needs_input",
  "ready",
  "blocked",
]);

export const energyStateSchema = z.enum([
  "relaxed",
  "focused",
  "tired",
  "exhausted",
]);

export type Presence = z.infer<typeof presenceSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type EnergyState = z.infer<typeof energyStateSchema>;

export const petStateEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerDeviceId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    presence: presenceSchema,
    taskState: taskStateSchema.nullable(),
    energyState: energyStateSchema.nullable(),
    eventId: z.string().uuid().nullable().default(null),
    updatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export type PetStateEnvelope = z.infer<typeof petStateEnvelopeSchema>;

export const registerDeviceResponseSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(32),
});

export const createPairingResponseSchema = z.object({
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
  expiresAt: z.iso.datetime(),
});

export const claimPairingRequestSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
  })
  .strict();

export const websocketClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat"), sentAt: z.iso.datetime() }).strict(),
  z.object({ type: z.literal("pet.state"), state: petStateEnvelopeSchema }).strict(),
]);

export const websocketServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), deviceId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("heartbeat"), receivedAt: z.iso.datetime() }).strict(),
  z.object({ type: z.literal("pet.state"), state: petStateEnvelopeSchema }).strict(),
  z.object({ type: z.literal("snapshot"), states: z.array(petStateEnvelopeSchema) }).strict(),
  z.object({ type: z.literal("pair.created"), friendDeviceId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("pair.revoked") }).strict(),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }).strict(),
]);

export type WebsocketClientMessage = z.infer<typeof websocketClientMessageSchema>;
export type WebsocketServerMessage = z.infer<typeof websocketServerMessageSchema>;
