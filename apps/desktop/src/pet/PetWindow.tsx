import { useEffect, useMemo, useState } from "react";
import { desktopApi } from "../tauri";
import type { PetViewState } from "../types";
import { Penguin } from "./Penguin";

const fallback = (owner: "self" | "friend"): PetViewState => ({
  owner,
  presence: owner === "self" ? "online" : "offline",
  taskState: "idle",
  energyState: "relaxed",
  limitedDetection: true,
  updatedAt: new Date(0).toISOString(),
});

export function PetWindow({ owner }: { owner: "self" | "friend" }) {
  const [state, setState] = useState(() => fallback(owner));
  const [reduceMotion, setReduceMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    void desktopApi.snapshot().then((snapshot) => {
      setState(owner === "self" ? snapshot.selfPet : snapshot.friendPet);
      setReduceMotion(snapshot.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches);
    });
    const unlistenState = desktopApi.onPetState((next) => {
      if (next.owner === owner) setState(next);
    });
    const unlistenSnapshot = desktopApi.onSnapshot((snapshot) => {
      setReduceMotion(snapshot.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches);
    });
    return () => {
      void unlistenState.then((fn) => fn());
      void unlistenSnapshot.then((fn) => fn());
    };
  }, [owner]);

  const title = useMemo(() => (owner === "self" ? "我的企鹅" : "好友企鹅"), [owner]);
  return (
    <main className="pet-window" data-tauri-drag-region title="拖动移动桌宠">
      <span className="owner-label">{title}{state.limitedDetection && owner === "self" ? " · 有限检测" : ""}</span>
      <Penguin
        presence={state.presence}
        taskState={state.taskState}
        energyState={state.energyState}
        reduceMotion={reduceMotion}
      />
    </main>
  );
}
