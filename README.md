<div align="center">

<p align="center">
  <img src="docs/banner.png" alt="开源豆包语音输入法" width="720" style="border-radius: 16px;" />
</p>

</div>

# 开源豆包语音输入法 · Open Doubao Voice IME

> **Windows 桌面端的开源语音输入法** — 基于火山引擎豆包语音识别，解决 Windows 自带语音输入经常识别错误的问题。

[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey)](LICENSE)

---

## 为什么做这个项目？

豆包 App、微信等移动端都有非常好用的语音输入功能，但在 **Windows 桌面端** 却无法直接使用。Windows 自带的语音输入识别效果经常出错，远不如豆包的识别准确。

本项目将 **火山引擎豆包语音识别** 的能力带到 Windows 桌面，作为一个开源的语音输入法供大家使用。

## 特性

- 豆包语音识别引擎 — 基于火山引擎豆包 ASR（WebSocket 实时流式识别）
- 全局快捷键 — 默认 Ctrl+Shift+F8，一键切换录音
- 系统托盘 — 后台常驻，随时唤醒
- 胶囊悬浮球 — 置顶显示，可拖动，录音时红色光晕随音量强弱变化
- 自动粘贴 — 识别结果直接模拟 Ctrl+V 粘贴到当前输入框
- 设置面板 — 可视化配置快捷键、API 密钥等

## 快速开始

### 环境要求

- Windows 10/11
- Rust (MSVC toolchain) — 编译 Tauri 后端
- Python 3.9+ — 运行语音识别引擎
- Node.js 20+ — 构建前端

### 安装依赖

```bash
# Python 依赖
pip install sounddevice numpy requests pyperclip pyautogui pywin32 websockets>=12.0

# Node 依赖
npm install
```

### 获取豆包 API 密钥

本项目需要火山引擎豆包语音识别的 App ID、Token 和 Secret：

1. 前往 [火山引擎控制台](https://console.volcengine.com/speech/) 开通语音识别服务
2. 获取 appid、token 和 secret
3. 在设置面板中配置即可

### 运行

```bash
# 开发模式
npx tauri dev

# 构建安装包
npx tauri build
```

## 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| hotkey | 全局快捷键 | Ctrl+Shift+F8 |
| doubao_appid | 火山引擎 App ID | — |
| doubao_token | 火山引擎 Token | — |
| doubao_secret | 火山引擎 Secret | — |
| doubao_cluster | 集群名称 | volc_seedasr_streaming |
| always_on_top | 窗口置顶 | true |

## 技术栈

| 层 | 技术 |
|-----|------|
| 前端 | React 19 + TypeScript + Vite + TailwindCSS |
| 状态管理 | Zustand |
| 桌面框架 | Tauri v2 (Rust) + 系统托盘 |
| 语音引擎 | Python sidecar + 火山引擎豆包 WebSocket ASR |
| 输入方式 | Windows IME / 模拟键盘粘贴 |

## 项目结构

```
voice-ime/
+-- src/               # React 前端
|   +-- components/    # Orb 胶囊、设置面板
|   +-- store/         # Zustand 状态
|   +-- App.tsx
+-- src-tauri/         # Rust 后端
|   +-- src/
|       +-- main.rs    # 托盘、快捷键
|       +-- windows_ime_ipc.rs  # IME 通信
+-- engine/            # Python 语音引擎
|   +-- voice_engine.py
+-- package.json
```

## 许可证

[CC BY-NC-SA 4.0](LICENSE) — **非商业使用**。

您可以自由地共享和改编本作品，但**不得用于商业目的**，且必须署名并以相同方式共享。
