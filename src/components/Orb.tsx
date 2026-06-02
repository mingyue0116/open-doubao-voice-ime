import { useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store/appStore";

export function Orb() {
  const status = useAppStore((s) => s.status);
  const audioLevel = useAppStore((s) => s.audioLevel);
  const hotkeyError = useAppStore((s) => s.hotkeyError);

  const ds = useRef({ sx: 0, sy: 0, dragging: false });
  const [pressed, setPressed] = useState(false);
  const recording = status === "recording";

  const handleTap = async () => {
    if (ds.current.dragging) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_settings");
    } catch {}
  };

  // 录音时光晕强度跟随 audioLevel
  const glowIntensity = recording ? 0.15 + audioLevel * 0.35 : 0;

  return (
    <div
      onPointerDown={(e) => {
        ds.current = { sx: e.screenX, sy: e.screenY, dragging: false };
        setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerMove={(e) => {
        const s = ds.current;
        if (s.dragging) return;
        if (Math.abs(e.screenX - s.sx) > 4 || Math.abs(e.screenY - s.sy) > 4) {
          s.dragging = true;
          setPressed(false);
          getCurrentWindow().startDragging().catch(() => {});
        }
      }}
      onClick={handleTap}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 44, height: 44, borderRadius: "50%",
        zIndex: 50, userSelect: "none",
        background: recording ? "#ef4444" : "#ffffff",
        border: recording ? "2px solid #dc2626" : "1.5px solid #e8e8ed",
        boxShadow: recording
          ? `0 0 ${8 + audioLevel * 18}px ${4 + audioLevel * 8}px rgba(239,68,68,${glowIntensity})`
          : pressed
          ? "0 0 0 3px rgba(0,0,0,0.05), 0 4px 14px rgba(0,0,0,0.06)"
          : "0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.05)",
        cursor: "grab",
        transition: recording
          ? "background 0.15s ease, border-color 0.15s ease"
          : "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        display: "flex", alignItems: "center", justifyContent: "center",
        // 录音时整体微微呼吸
        animation: recording ? "orbPulse 1.8s ease-in-out infinite" : "none",
      }}
    >
      {/* 麦克风图标 */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke={recording ? "#ffffff" : "#1d1d1f"} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
        <path d="M8 21h8" />
      </svg>

      {/* 快捷键错误 */}
      {hotkeyError && (
        <div
          title={hotkeyError}
          onClick={(e) => { e.stopPropagation(); handleTap(); }}
          style={{
            position: "absolute", top: -2, right: -2,
            width: 10, height: 10, borderRadius: 5,
            background: "#ef4444", border: "1.5px solid #fff",
            cursor: "pointer", zIndex: 2,
          }}
        />
      )}
    </div>
  );
}
