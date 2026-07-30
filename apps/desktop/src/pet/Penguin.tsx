import type { EnergyState, Presence, TaskState } from "@petlink/protocol";
import type { CSSProperties } from "react";
import { resolveAnimation } from "./animation";

interface PenguinProps {
  presence: Presence;
  taskState: TaskState | null;
  energyState: EnergyState | null;
  reduceMotion: boolean;
}

const taskLabels: Record<TaskState, string> = {
  idle: "悠闲",
  running: "正在工作",
  needs_input: "等你处理",
  ready: "完成啦",
  blocked: "遇到问题",
};

export function Penguin({ presence, taskState, energyState, reduceMotion }: PenguinProps) {
  const task = taskState ?? "idle";
  const label = presence === "offline" ? "离线" : presence === "privacy_hidden" ? "暂时隐身" : taskLabels[task];
  const classes = ["penguin", `task-${task}`, `energy-${energyState ?? "hidden"}`, `presence-${presence}`];
  if (reduceMotion) classes.push("reduce-motion");
  const animation = resolveAnimation(presence, taskState, energyState);
  const useSprites = import.meta.env.VITE_USE_SPRITES === "true";
  const spriteStyle = { "--sprite-url": `url(${animation.url})` } as CSSProperties;
  return (
    <div className={classes.join(" ")} role="img" aria-label={`企鹅：${label}`}>
      <div className="status-bubble">{bubbleFor(presence, task)}</div>
      {useSprites ? (
        <div
          className={`sprite-strip${animation.loop ? " sprite-loop" : " sprite-once"}`}
          style={spriteStyle}
          data-animation={animation.key}
        />
      ) : (
        <div className="penguin-body">
          <div className="penguin-head">
            <i className="eye eye-left" />
            <i className="eye eye-right" />
            <i className="beak" />
          </div>
          <div className="penguin-belly" />
          <i className="wing wing-left" />
          <i className="wing wing-right" />
          {task === "running" && <div className="laptop"><span /></div>}
        </div>
      )}
      <div className="pet-caption">{label}</div>
    </div>
  );
}

function bubbleFor(presence: Presence, task: TaskState): string {
  if (presence === "offline") return "⋯";
  if (presence === "privacy_hidden") return "◌";
  if (task === "needs_input") return "!";
  if (task === "ready") return "✓";
  if (task === "blocked") return "×";
  if (task === "running") return "⌘";
  return "·";
}
