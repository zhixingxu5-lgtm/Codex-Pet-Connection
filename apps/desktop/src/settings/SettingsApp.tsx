import { useEffect, useState } from "react";
import type { TaskState } from "@petlink/protocol";
import { desktopApi } from "../tauri";
import type { DesktopSnapshot } from "../types";

const simulations: Array<{ state: TaskState; label: string }> = [
  { state: "idle", label: "悠闲" },
  { state: "running", label: "工作" },
  { state: "needs_input", label: "等待输入" },
  { state: "ready", label: "完成" },
  { state: "blocked", label: "失败" },
];

export function SettingsApp() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [claimCode, setClaimCode] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void desktopApi.snapshot().then(setSnapshot).catch((error) => setMessage(String(error)));
    const unlisten = desktopApi.onSnapshot(setSnapshot);
    return () => void unlisten.then((fn) => fn());
  }, []);

  if (!snapshot) return <main className="settings-shell"><p>正在启动桌宠…</p></main>;

  async function action(fn: () => Promise<DesktopSnapshot | string | void>) {
    try {
      const result = await fn();
      if (typeof result === "string") setMessage(result);
      else if (result) setSnapshot(result);
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <main className="settings-shell">
      <header>
        <div><small>Codex Pet Link</small><h1>和朋友一起工作</h1></div>
        <button className="secondary" onClick={() => void action(() => desktopApi.showPetWindows(true))}>显示桌宠</button>
      </header>

      <section className="hero-card">
        <div><strong>我的状态</strong><p>{snapshot.selfPet.taskState} · {snapshot.selfPet.energyState}</p></div>
        <div><strong>Codex 接入</strong><p>{snapshot.appServerConnected ? "App Server 已连接" : snapshot.hookConnected ? "Hook 已连接" : "有限检测"}</p></div>
      </section>

      <section>
        <h2>双人配对</h2>
        {snapshot.paired ? (
          <div className="row"><span>已连接一位好友</span><button className="danger" onClick={() => void action(desktopApi.unpair)}>解除配对</button></div>
        ) : (
          <>
            <div className="row">
              <button onClick={() => void action(desktopApi.createPairing)}>生成配对码</button>
              {snapshot.pairingCode && <code className="pairing-code">{snapshot.pairingCode}</code>}
            </div>
            <div className="row">
              <input value={claimCode} maxLength={8} placeholder="输入 8 位配对码" onChange={(event) => setClaimCode(event.target.value.toUpperCase())} />
              <button onClick={() => void action(() => desktopApi.claimPairing(claimCode))}>连接好友</button>
            </div>
          </>
        )}
      </section>

      <section>
        <h2>隐私与显示</h2>
        <Toggle label="好友可见精力状态" checked={snapshot.shareEnergy} onChange={(shareEnergy) => void action(() => desktopApi.updateSettings({ shareEnergy }))} />
        <Toggle label="暂停对外共享" checked={snapshot.privacyPaused} onChange={(privacyPaused) => void action(() => desktopApi.updateSettings({ privacyPaused }))} />
        <Toggle label="减少动态效果" checked={snapshot.reduceMotion} onChange={(reduceMotion) => void action(() => desktopApi.updateSettings({ reduceMotion }))} />
      </section>

      <section>
        <h2>Codex 连接</h2>
        <p className="muted">插件只传递会话 ID、轮次 ID 和抽象状态，不传 Prompt、代码、路径或回复。</p>
        <div className="simulation-grid">
          <button onClick={() => void action(desktopApi.installPlugin)}>安装本地插件</button>
          <button className="secondary" onClick={() => void action(desktopApi.uninstallPlugin)}>卸载插件</button>
        </div>
      </section>

      <section>
        <h2>模拟状态</h2>
        <div className="simulation-grid">
          {simulations.map(({ state, label }) => <button className="secondary" key={state} onClick={() => void action(() => desktopApi.simulate(state))}>{label}</button>)}
        </div>
      </section>
      {message && <p className="notice">{message}</p>}
    </main>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
