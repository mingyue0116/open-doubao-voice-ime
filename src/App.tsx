import { useEffect, useState } from "react";
import { Orb } from "./components/Orb";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store/appStore";

function EngineListener() {
  const setStatus = useAppStore((s) => s.setStatus);
  const setTranscript = useAppStore((s) => s.setTranscript);
  const setAudioLevel = useAppStore((s) => s.setAudioLevel);
  const setHotkeyError = useAppStore((s) => s.setHotkeyError);

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string>("engine-message", (event) => {
        try {
          const msg = JSON.parse(event.payload);
          if (msg.type === "status") setStatus(msg.state);
          if (msg.type === "error") {
            setTranscript(msg.message || "Error");
            setStatus("error");
          }
          if (msg.type === "partial") setTranscript(msg.text);
          if (msg.type === "transcript") setTranscript(msg.text);
          if (msg.type === "audio_level") setAudioLevel(msg.level ?? 0);
        } catch {}
      }).then((fn) => { un1 = fn; });

      listen<string>("hotkey-error", (event) => {
        setHotkeyError(event.payload);
      }).then((fn) => { un2 = fn; });

      // Rust hotkey handler emit 这个事件
      listen("toggle-recording", () => {
        const cur = useAppStore.getState().status;
        setStatus(cur === "recording" ? "idle" : "recording");
      }).then((fn) => { un3 = fn; });
    });

    return () => {
      if (un1) un1();
      if (un2) un2();
      if (un3) un3();
    };
  }, [setStatus, setTranscript, setAudioLevel, setHotkeyError]);

  return null;
}

function ConfigLoader() {
  const loadConfig = useAppStore((s) => s.loadConfig);
  const configLoaded = useAppStore((s) => s.configLoaded);

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  return null;
}

function App() {
  const [winLabel, setWinLabel] = useState("main");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const override = params.get("window");
      if (override === "settings" || override === "main") {
        setWinLabel(override);
        return;
      }
    }
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => setWinLabel(getCurrentWindow().label))
      .catch(() => {});
  }, []);

  if (winLabel === "settings") {
    return <SettingsPanel standalone />;
  }

  return (
    <>
      <ConfigLoader />
      <EngineListener />
      <Orb />
    </>
  );
}

export default App;
