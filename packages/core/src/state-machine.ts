import type { EnergyState, TaskState } from "@petlink/protocol";

export const READY_TTL_MS = 30_000;
export const BLOCKED_TTL_MS = 5 * 60_000;

export type SessionState = Exclude<TaskState, "idle"> | "idle";

export interface SessionSnapshot {
  state: SessionState;
  updatedAtMs: number;
  source: "app_server" | "hook" | "manual";
}

export interface DailyWorkload {
  localDate: string;
  accumulatedSeconds: number;
  runningSinceMs: number | null;
}

const priority: Record<TaskState, number> = {
  idle: 0,
  running: 1,
  ready: 2,
  blocked: 3,
  needs_input: 4,
};

export function aggregateTaskState(
  sessions: Iterable<SessionSnapshot>,
  nowMs: number,
): TaskState {
  let selected: TaskState = "idle";
  for (const session of sessions) {
    let candidate: TaskState = session.state;
    const age = nowMs - session.updatedAtMs;
    if (candidate === "ready" && age >= READY_TTL_MS) candidate = "idle";
    if (candidate === "blocked" && age >= BLOCKED_TTL_MS) candidate = "idle";
    if (priority[candidate]! > priority[selected]!) selected = candidate;
  }
  return selected;
}

export function energyForSeconds(seconds: number): EnergyState {
  if (seconds < 20 * 60) return "relaxed";
  if (seconds < 60 * 60) return "focused";
  if (seconds < 120 * 60) return "tired";
  return "exhausted";
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function settleWorkload(
  workload: DailyWorkload,
  nextState: TaskState,
  now: Date,
): DailyWorkload {
  const nowMs = now.getTime();
  const localDate = localDateKey(now);
  let accumulatedSeconds =
    workload.localDate === localDate ? workload.accumulatedSeconds : 0;
  let runningSinceMs = workload.localDate === localDate ? workload.runningSinceMs : null;

  if (runningSinceMs !== null && nextState !== "running") {
    accumulatedSeconds += Math.max(0, Math.floor((nowMs - runningSinceMs) / 1000));
    runningSinceMs = null;
  }
  if (runningSinceMs === null && nextState === "running") {
    runningSinceMs = nowMs;
  }

  return { localDate, accumulatedSeconds, runningSinceMs };
}

export function workloadSeconds(workload: DailyWorkload, nowMs: number): number {
  if (workload.runningSinceMs === null) return workload.accumulatedSeconds;
  return workload.accumulatedSeconds + Math.max(0, Math.floor((nowMs - workload.runningSinceMs) / 1000));
}

export interface SourceEvent {
  sessionId: string;
  state: SessionState;
  source: SessionSnapshot["source"];
  receivedAtMs: number;
}

export class StateAggregator {
  readonly #sessions = new Map<string, SessionSnapshot>();
  readonly #lastAppServerEvent = new Map<string, number>();

  apply(event: SourceEvent): boolean {
    if (event.source === "hook") {
      const authoritativeAt = this.#lastAppServerEvent.get(event.sessionId);
      if (authoritativeAt !== undefined && event.receivedAtMs - authoritativeAt <= 5_000) {
        return false;
      }
    }
    if (event.source === "app_server") {
      this.#lastAppServerEvent.set(event.sessionId, event.receivedAtMs);
    }
    this.#sessions.set(event.sessionId, {
      state: event.state,
      updatedAtMs: event.receivedAtMs,
      source: event.source,
    });
    return true;
  }

  removeSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
    this.#lastAppServerEvent.delete(sessionId);
  }

  taskState(nowMs: number): TaskState {
    return aggregateTaskState(this.#sessions.values(), nowMs);
  }

  snapshots(): ReadonlyMap<string, SessionSnapshot> {
    return this.#sessions;
  }
}
