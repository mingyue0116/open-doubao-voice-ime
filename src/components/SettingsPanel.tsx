import { useState } from "react";
import { useAppStore, type AppConfig } from "../store/appStore";

const TABS = [
  { id: "general", label: "通用" },
  { id: "asr",     label: "语音识别" },
  { id: "about",   label: "关于" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsPanel({ standalone }: { standalone?: boolean }) {
  const { config, saveConfig, updateConfig } = useAppStore();
  const [tab, setTab] = useState<TabId>("general");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const close = standalone
    ? async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("close_settings");
        } catch {}
      }
    : () => useAppStore.getState().toggleSettings();

  const save = async () => {
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveConfig();
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("register_hotkey", { shortcut: config.hotkey });
      } catch (e: any) {
        // register 失败:显示错误,状态恢复 idle
        const msg = typeof e === "string" ? e : (e?.message || String(e));
        setSaveError(msg);
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1400);
    } catch (e: any) {
      const msg = typeof e === "string" ? e : (e?.message || String(e));
      setSaveError(msg);
      setSaveState("idle");
    }
  };

  // 整窗就是卡片,没有外围背景框
  return (
    <div
      className="select-none"
      style={{
        width: "100%",
        height: "100%",
        background: "#ffffff",
        color: "#1d1d1f",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid #e8e8ed",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        // 展开动画: 从下方+缩小弹入,360ms iOS 风格
        transformOrigin: "center bottom",
        animation: "settingsIn 360ms cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      {/* Header - 整块可拖动(关闭按钮除外) */}
      <div
        data-tauri-drag-region
        style={{
          height: 40,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          cursor: "move",
        }}
      >
        <span
          data-tauri-drag-region
          style={{ fontSize: 12.5, fontWeight: 600 }}
        >
          设置
        </span>
        {standalone && (
          <button
            onClick={close}
            style={{
              width: 22, height: 22,
              borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", cursor: "pointer",
              color: "#86868b",
            }}
            className="hover:bg-zinc-100 transition-colors"
            aria-label="关闭"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#e8e8ed", flexShrink: 0 }} />

      {/* Tabs */}
      <div
        style={{
          height: 36,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexShrink: 0,
        }}
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                height: 24,
                padding: 0,
                fontSize: 12,
                fontWeight: active ? 500 : 400,
                color: active ? "#1d1d1f" : "#86868b",
                background: "none",
                border: "none",
                borderBottom: active ? "1.5px solid #1d1d1f" : "1.5px solid transparent",
                cursor: "pointer",
                transition: "color 0.12s, border-color 0.12s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#e8e8ed", flexShrink: 0 }} />

      {/* Body - 不再 grow,只滚动 */}
      <div style={{ overflowY: "auto", padding: "4px 0" }}>
        {tab === "general" && <GeneralTab config={config} update={updateConfig} />}
        {tab === "asr"     && <AsrTab     config={config} update={updateConfig} />}
        {tab === "about"   && <AboutTab />}
      </div>

      {/* Divider */}
      {tab !== "about" && <div style={{ height: 1, background: "#e8e8ed", flexShrink: 0 }} />}

      {/* Error banner */}
      {saveError && tab !== "about" && (
        <div
          style={{
            padding: "8px 16px",
            background: "#fef2f2",
            borderTop: "1px solid #fecaca",
            color: "#b91c1c",
            fontSize: 11.5,
            lineHeight: 1.4,
            flexShrink: 0,
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ flex: 1, wordBreak: "break-word" }}>{saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      )}

      {/* Footer */}
      {tab !== "about" && (
        <div
          style={{
            height: 48,
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <button
            onClick={close}
            style={{
              height: 28, padding: "0 14px",
              fontSize: 11.5, color: "#515154",
              background: "#ffffff",
              border: "1px solid #d2d2d7",
              borderRadius: 6,
              cursor: "pointer",
            }}
            className="hover:bg-zinc-50 active:bg-zinc-100 transition-colors"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saveState !== "idle"}
            style={{
              height: 28, padding: "0 14px",
              fontSize: 11.5,
              color: saveState === "saved" ? "#1d1d1f" : "#ffffff",
              fontWeight: 500,
              background:
                saveState === "saved"
                  ? "#f5f5f7"
                  : saveState === "saving"
                  ? "#8e8e93"
                  : "#1d1d1f",
              border: saveState === "saved" ? "1px solid #d2d2d7" : "none",
              borderRadius: 6,
              cursor: saveState === "idle" ? "pointer" : "default",
              transition: "all 0.2s ease-out",
              minWidth: 64,
            }}
          >
            {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "保存"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────── Tabs ───────── */

function GeneralTab({
  config, update,
}: {
  config: AppConfig;
  update: (p: Partial<AppConfig>) => void;
}) {
  return (
    <div style={{ padding: "0 16px" }}>
      <Item
        label="快捷键"
        control={
          <TextInput
            value={config.hotkey}
            onChange={(v) => update({ hotkey: v })}
            placeholder="Ctrl+Shift+F8"
            width={160}
          />
        }
      />
      <Item
        label="开机自启"
        control={<Switch checked={config.auto_launch} onChange={(v) => update({ auto_launch: v })} />}
      />
      <Item
        label="窗口置顶"
        control={<Switch checked={config.always_on_top} onChange={(v) => update({ always_on_top: v })} />}
      />
      <Item
        label="主题"
        control={
          <Segmented
            value={config.theme}
            options={[
              { value: "system", label: "系统" },
              { value: "light",  label: "浅色" },
              { value: "dark",   label: "深色" },
            ]}
            onChange={(v) => update({ theme: v })}
          />
        }
      />
    </div>
  );
}

function AsrTab({
  config, update,
}: {
  config: AppConfig;
  update: (p: Partial<AppConfig>) => void;
}) {
  return (
    <div style={{ padding: "0 16px" }}>
      <Item
        label="App ID"
        control={
          <TextInput value={config.doubao_appid} onChange={(v) => update({ doubao_appid: v })} placeholder="请输入 App ID" />
        }
      />
      <Item
        label="Token"
        control={
          <TextInput value={config.doubao_token} onChange={(v) => update({ doubao_token: v })} placeholder="请输入 Token" type="password" />
        }
      />
      <Item
        label="Secret"
        control={
          <TextInput value={config.doubao_secret} onChange={(v) => update({ doubao_secret: v })} placeholder="请输入 Secret" type="password" />
        }
      />
      <Item
        label="Cluster"
        hint="流式识别服务名"
        control={
          <TextInput value={config.doubao_cluster} onChange={(v) => update({ doubao_cluster: v })} placeholder="volc_seedasr_streaming" />
        }
      />
      <GuideCard />
    </div>
  );
}

/* ───────── 引导卡片 ───────── */
function GuideCard() {
  const openLink = async (url: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
    } catch {
      try { window.open(url, "_blank"); } catch {}
    }
  };

  return (
    <div
      style={{
        margin: "12px 16px 16px",
        padding: "12px 14px",
        background: "#fafafa",
        border: "1px solid #e8e8ed",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>
        如何获取火山引擎 ASR 凭证
      </div>
      <ol style={{ margin: "0 0 10px 16px", padding: 0, fontSize: 11, color: "#515154", lineHeight: 1.6 }}>
        <li>注册 / 登录火山引擎账号</li>
        <li>开通「语音技术」服务,创建应用获取 App ID</li>
        <li>在「在线体验」或「控制台」获取 Token 和 Secret</li>
      </ol>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <LinkChip label="注册火山引擎" onClick={() => openLink("https://www.volcengine.com/register")} />
        <LinkChip label="控制台" onClick={() => openLink("https://console.volcengine.com/speech/app/list")} />
        <LinkChip label="充值" onClick={() => openLink("https://console.volcengine.com/wallet")} />
        <LinkChip label="计费说明" onClick={() => openLink("https://www.volcengine.com/docs/6257/155559")} />
      </div>

      <div style={{ fontSize: 10.5, color: "#86868b", lineHeight: 1.5, paddingTop: 8, borderTop: "1px solid #e8e8ed" }}>
        <span style={{ color: "#1d1d1f", fontWeight: 500 }}>费用参考</span> · 实时流式识别约 ¥0.0001/秒(0.36 元/小时)。
        <br />
        <span style={{ color: "#1d1d1f", fontWeight: 500 }}>充值</span> · 火山引擎新用户有免费额度,可在控制台领取。
      </div>
    </div>
  );
}

function LinkChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 22,
        padding: "0 9px",
        fontSize: 10.5,
        color: "#1d1d1f",
        background: "#ffffff",
        border: "1px solid #d2d2d7",
        borderRadius: 4,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      className="hover:bg-zinc-50 active:bg-zinc-100 transition-colors"
    >
      {label}
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </button>
  );
}

function AboutTab() {
  return (
    <div style={{ padding: "24px 16px", textAlign: "center" }}>
      <div
        style={{
          width: 48, height: 48, borderRadius: 12,
          background: "#f5f5f7",
          margin: "0 auto 12px",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid #e8e8ed",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
          <path d="M8 21h8" />
        </svg>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1d1d1f" }}>开源豆包语音输入法</div>
      <div style={{ fontSize: 11.5, color: "#86868b", marginTop: 2 }}>版本 0.1.0</div>
      <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 16 }}>
        基于火山引擎豆包语音识别
      </div>
    </div>
  );
}

/* ───────── Layout primitive ───────── */

function Item({
  label, hint, control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div
      style={{
        height: 40,
        borderBottom: "1px solid #f0f0f0",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "#1d1d1f", lineHeight: 1.3 }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 10.5, color: "#aeaeb2", lineHeight: 1.2, marginTop: 1 }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

/* ───────── Form controls ───────── */

function TextInput({
  value, onChange, placeholder, type = "text", width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  width?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        height: 26,
        width: width ?? 180,
        padding: "0 8px",
        borderRadius: 5,
        fontSize: 12,
        background: "#fafafa",
        border: "1px solid #d2d2d7",
        color: "#1d1d1f",
        outline: "none",
        transition: "border-color 0.12s",
      }}
      className="focus:border-zinc-500"
    />
  );
}

function Switch({
  checked, onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 28,
        height: 16,
        borderRadius: 999,
        background: checked ? "#1d1d1f" : "#c7c7cc",
        border: "none",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "#ffffff",
          transform: checked ? "translateX(12px)" : "translateX(0)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
          transition: "transform 0.15s cubic-bezier(0.32,0.72,0,1)",
        }}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{ padding: 2, borderRadius: 5, background: "#f2f2f7", display: "inline-flex" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              height: 22,
              padding: "0 10px",
              borderRadius: 4,
              fontSize: 11.5,
              background: active ? "#ffffff" : "transparent",
              color: active ? "#1d1d1f" : "#86868b",
              fontWeight: active ? 500 : 400,
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              border: "none",
              cursor: "pointer",
              transition: "all 0.1s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
