import { create } from "zustand";

export type EngineStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "correcting"
  | "done"
  | "error"
  | "ready"
  | "no_speech";

export interface AppConfig {
  hotkey: string;
  asr_engine: string;
  doubao_appid: string;
  doubao_token: string;
  doubao_secret: string;
  doubao_cluster: string;
  corrector_api_key: string;
  corrector_api_base: string;
  corrector_model: string;
  correction_style: string;
  language_style: string;
  theme: string;
  always_on_top: boolean;
  auto_launch: boolean;
  audio_device: string | null;
}

const DEFAULT_CONFIG: AppConfig = {
  hotkey: "Ctrl+Shift+F8",
  asr_engine: "doubao",
  doubao_appid: "",
  doubao_token: "",
  doubao_secret: "",
  doubao_cluster: "volc_seedasr_streaming",
  corrector_api_key: "",
  corrector_api_base: "https://api.deepseek.com/v1",
  corrector_model: "deepseek-chat",
  correction_style: "增强通用",
  language_style: "结构化",
  theme: "system",
  always_on_top: true,
  auto_launch: false,
  audio_device: null,
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
      // setup 阶段已经注册了快捷键,这里不再重复注册(避免 "already registered" 假报错)
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
