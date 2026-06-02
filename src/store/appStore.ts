import { create } from "zustand";

export type EngineStatus =
  | "idle"
  | "recording"
  | "error"
  | "ready"
  | "no_speech";

export interface AppConfig {
  hotkey: string;
  doubao_appid: string;
  doubao_token: string;
  doubao_secret: string;
  always_on_top: boolean;
  auto_launch: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  hotkey: "Ctrl+Shift+F8",
  doubao_appid: "",
  doubao_token: "",
  doubao_secret: "",
  always_on_top: true,
  auto_launch: false,
};

export interface AppState {
  status: EngineStatus;
  lastTranscript: string;
  audioLevel: number;
  isSettingsOpen: boolean;
  configLoaded: boolean;
  config: AppConfig;
  hotkeyError: string | null;

  setStatus: (status: EngineStatus) => void;
  setTranscript: (text: string) => void;
  setAudioLevel: (level: number) => void;
  toggleSettings: () => void;
  updateConfig: (partial: Partial<AppConfig>) => void;
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
  setHotkeyError: (msg: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  status: "idle",
  lastTranscript: "",
  audioLevel: 0,
  isSettingsOpen: false,
  configLoaded: false,
  config: { ...DEFAULT_CONFIG },
  hotkeyError: null,

  setStatus: (status) => set({ status }),
  setTranscript: (text) => set({ lastTranscript: text }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  updateConfig: (partial) =>
    set((s) => ({ config: { ...s.config, ...partial } })),
  setHotkeyError: (msg) => set({ hotkeyError: msg }),

  loadConfig: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = (await invoke("get_config")) as Record<string, unknown>;
      const merged = { ...DEFAULT_CONFIG };
      for (const key of Object.keys(merged) as (keyof AppConfig)[]) {
        if (key in raw && raw[key] !== undefined && raw[key] !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (merged as any)[key] = raw[key];
        }
      }
      set({ config: merged, configLoaded: true });
    } catch (e) {
      console.error("loadConfig:", e);
      set({ configLoaded: true });
    }
  },

  saveConfig: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cfg = get().config;
      await invoke("save_config", { config: cfg });
    } catch (e) {
      console.error("saveConfig:", e);
      throw e;
    }
  },
}));
