import type { WebsocketServerMessage } from "@petlink/protocol";

export interface RealtimeSocket {
  send(data: string): void;
  readyState: number;
}

export class RealtimeHub {
  readonly #sockets = new Map<string, Set<RealtimeSocket>>();

  add(deviceId: string, socket: RealtimeSocket): () => void {
    const sockets = this.#sockets.get(deviceId) ?? new Set<RealtimeSocket>();
    sockets.add(socket);
    this.#sockets.set(deviceId, sockets);
    return () => {
      sockets.delete(socket);
      if (sockets.size === 0) this.#sockets.delete(deviceId);
    };
  }

  send(deviceId: string, message: WebsocketServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.#sockets.get(deviceId) ?? []) {
      if (socket.readyState === 1) socket.send(serialized);
    }
  }
}
