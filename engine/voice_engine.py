#!/usr/bin/env python3
# Voice IME Engine — streaming ASR via Volcengine Doubao

import json, sys, time, threading, logging, uuid
from collections import deque
import queue
import numpy as np
import sounddevice as sd

_ws_available = True
try:
    import websockets.sync.client as ws_client
except ImportError:
    _ws_available = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", handlers=[logging.StreamHandler(sys.stderr)])
log = logging.getLogger("VoiceEngine")

ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
RESOURCE_ID = "volc.seedasr.sauc.duration"


class VoiceEngine:
    def __init__(self):
        self.recording = False
        self.continuous = False
        self.audio_buffer = deque(maxlen=600)
        self.samplerate = 16000
        self.silence_start = 0.0
        self.silence_threshold = 0.5
        self.processing = False
        self.has_voice = False
        self.stream = None
        self.ws = None
        self.audio_queue = queue.Queue()
        self.partial_text = ""
        self.final_text = ""
        self._end_segment_requested = False
        self._last_segment_time = 0.0
        self._session_text = ""
        self._msg_queue = queue.Queue()
        self._writer_stop = threading.Event()
        self._writer_thread = threading.Thread(target=self._stdout_writer, daemon=True)
        self._writer_thread.start()
        self.doubao_appid = ""
        self.doubao_token = ""
        self.doubao_secret = ""
        self._last_pasted = ""  # 去重:记录最后粘贴的文本

    def send(self, msg):
        self._msg_queue.put(msg)

    def _stdout_writer(self):
        while not self._writer_stop.is_set():
            try:
                msg = self._msg_queue.get(timeout=0.5)
                line = json.dumps(msg, ensure_ascii=False)
                try:
                    sys.stdout.buffer.write((line + "\n").encode("utf-8"))
                    sys.stdout.buffer.flush()
                except (BrokenPipeError, OSError):
                    log.warning("stdout pipe closed, stopping")
                    self.recording = False
                    self.continuous = False
                    self._writer_stop.set()
                    return
            except queue.Empty:
                continue

    def handle_command(self, cmd):
        action = cmd.get("cmd")
        if action == "start":
            self.start_recording()
        elif action == "stop":
            self.stop_recording()
        elif action == "config":
            self.update_config(cmd.get("key"), cmd.get("value", ""))
        elif action == "config_batch":
            self.apply_batch_config(cmd.get("config", {}))

    def update_config(self, key, value=""):
        mapping = {"doubao_appid": "doubao_appid", "doubao_token": "doubao_token", "doubao_secret": "doubao_secret"}
        if key in mapping:
            setattr(self, mapping[key], value)
            log.info("config: %s = %s", key, "***" if "token" in key else value)

    def apply_batch_config(self, config):
        for key, value in config.items():
            if isinstance(value, str):
                self.update_config(key, value)
            elif isinstance(value, bool):
                self.update_config(key, str(value))
        log.info("batch config applied")

    def start_recording(self):
        if self.recording:
            log.info("already recording")
            return
        self.recording = True
        self.continuous = True
        self.has_voice = False
        self.silence_start = 0.0
        self._last_segment_time = time.time()
        self._session_text = ""
        self.partial_text = ""
        self.final_text = ""
        self._last_pasted = ""
        self.audio_buffer.clear()
        threading.Thread(target=self._open_ws, daemon=True).start()
        try:
            self.stream = sd.InputStream(samplerate=self.samplerate, channels=1, dtype="float32", blocksize=1600, callback=self._audio_callback)
            self.stream.start()
        except Exception as e:
            log.error("audio stream: %s", e)
            self.send({"type": "error", "message": f"Audio device error: {e}"})
            self.recording = False
            self.continuous = False
            self.send({"type": "status", "state": "idle"})
            return
        threading.Thread(target=self._silence_check, daemon=True).start()
        self.send({"type": "status", "state": "recording"})
        log.info("recording started")

    def _open_ws(self):
        if not self.recording:
            return
        try:
            api_key = self.doubao_secret or self.doubao_token
            if not api_key:
                log.error("doubao: missing API Key")
                return
            log.info("opening ws...")
            ws = ws_client.connect(
                ENDPOINT,
                timeout=10,
                additional_headers={
                    "X-Api-Key": api_key,
                    "X-Api-Resource-Id": RESOURCE_ID,
                    "X-Api-Request-Id": str(uuid.uuid4()),
                    "X-Api-Sequence": "-1",
                },
            )
            # ★ 二次检查: 连接期间用户可能已经按了停止
            if not self.recording:
                log.info("_open_ws: recording stopped during connect, closing")
                try: ws.close()
                except: pass
                return
            self.ws = ws
            log.info("ws opened")
            import gzip
            start_payload = json.dumps({"appid": self.doubao_appid, "user": {"uid": "voice_ime"}, "audio": {"format": "pcm", "rate": 16000, "channels": 1}, "request": {"resource_id": RESOURCE_ID}})
            compressed = gzip.compress(start_payload.encode("utf-8"))
            start_frame = bytes([0x11, 0x10, 0x11, 0x00]) + len(compressed).to_bytes(4, "big") + compressed
            ws.send(start_frame)
            ack = ws.recv(timeout=5)
            if isinstance(ack, bytes):
                log.info("ws ack received")
            # ★ 三次检查: 握手完成后再次确认,防止发送脏 "recording" 状态
            if not self.recording:
                log.info("_open_ws: recording stopped after handshake, closing")
                try: ws.close()
                except: pass
                self.ws = None
                return
            self.send({"type": "status", "state": "recording"})
            log.info("streaming recording started")
            self._ws_read_loop()
        except Exception as e:
            if self.recording:
                log.error("ws error: %s", e)
            self.ws = None

    def _ws_read_loop(self):
        while self.recording and self.ws:
            try:
                while not self.audio_queue.empty():
                    chunk = self.audio_queue.get_nowait()
                    chunk_int16 = (chunk * 32767).astype(np.int16) if chunk.dtype == np.float32 else chunk.astype(np.int16)
                    audio_bytes = chunk_int16.tobytes()
                    self.ws.send(bytes([0x11, 0x20, 0x10, 0x00]) + len(audio_bytes).to_bytes(4, "big") + audio_bytes)
                if self._end_segment_requested:
                    self._end_segment_requested = False
                    end_hdr = bytes([0x11, 0x22, 0x10, 0x00])
                    self.ws.send(end_hdr + (0).to_bytes(4, "big"))
                    final_text = ""
                    for _ in range(30):
                        try:
                            msg = self.ws.recv(timeout=0.5)
                            if isinstance(msg, bytes) and len(msg) >= 8:
                                flags = msg[1] & 0x0F
                                has_seq = flags in (1, 3)
                                off = 4 if has_seq else 0
                                ps = int.from_bytes(msg[4+off:8+off], "big")
                                if ps > 0:
                                    payload = json.loads(msg[8+off:8+off+ps].decode("utf-8", errors="replace"))
                                    res = payload.get("result", {})
                                    if isinstance(res, dict):
                                        t = res.get("text", "") or ""
                                        if t:
                                            final_text = t
                                if flags in (2, 3):
                                    break
                        except:
                            break
                    try:
                        self.ws.close()
                    except:
                        pass
                    self.ws = None
                    self._on_segment_end(final_text)
                    if self.continuous:
                        threading.Thread(target=self._open_ws, daemon=True).start()
                    break
                try:
                    msg = self.ws.recv(timeout=0.05)
                    if isinstance(msg, bytes) and len(msg) >= 8:
                        flags = msg[1] & 0x0F
                        has_seq = flags in (1, 3)
                        off = 4 if has_seq else 0
                        ps = int.from_bytes(msg[4+off:8+off], "big")
                        if ps > 0:
                            payload = json.loads(msg[8+off:8+off+ps].decode("utf-8", errors="replace"))
                            res = payload.get("result", {})
                            if isinstance(res, dict):
                                t = res.get("text", "") or ""
                                if t:
                                    self.partial_text = t
                                    self.send({"type": "partial", "text": t})
                except:
                    pass
            except Exception as e:
                log.error("ws_loop: %s", e)
                break
        self.ws = None

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            log.warning("audio status: %s", status)
        if self.recording:
            chunk = indata.copy()
            self.audio_buffer.append(chunk)
            self.audio_queue.put(chunk)

    def stop_recording(self):
        self.recording = False
        self.continuous = False
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except:
                pass
            self.stream = None
        if self.ws:
            try:
                end_hdr = bytes([0x11, 0x22, 0x10, 0x00])
                self.ws.send(end_hdr + (0).to_bytes(4, "big"))
                for _ in range(10):
                    if not self.ws:
                        break
                    try:
                        msg = self.ws.recv(timeout=0.5)
                        if isinstance(msg, bytes) and len(msg) >= 8:
                            flags = msg[1] & 0x0F
                            has_seq = flags in (1, 3)
                            off = 4 if has_seq else 0
                            ps = int.from_bytes(msg[4+off:8+off], "big")
                            if ps > 0:
                                payload = json.loads(msg[8+off:8+off+ps].decode("utf-8", errors="replace"))
                                res = payload.get("result", {})
                                if isinstance(res, dict):
                                    t = res.get("text", "") or ""
                                    if t:
                                        self.final_text = t
                    except:
                        break
                try: self.ws.close()
                except: pass
            except:
                pass
            self.ws = None
        # 二次清理: 防 _open_ws 竞态打开了新 WS
        time.sleep(0.1)
        if self.ws:
            try: self.ws.close()
            except: pass
            self.ws = None
        # 流式输出已经在 _on_segment_end 里逐段粘贴了
        # stop_recording 只处理最后的尾段:如果跟已粘贴的不同才粘贴,相同就跳过
        if self.final_text and self.final_text.strip():
            text = self.final_text.strip()
            self.final_text = ""
            if text != self._last_pasted:
                self._paste_text(text)
                self.send({"type": "transcript", "text": text, "final": True})
        self._last_pasted = ""
        self._session_text = ""
        self.partial_text = ""
        self.send({"type": "status", "state": "idle"})
        log.info("recording stopped")

    def _silence_check(self):
        """每 50ms 跑一次,负责两件事:
           1) 推送 audio_level 给前端(圆球波形律动,要求真正实时)
           2) 检测静音 / 长时间说话,触发切段
        """
        while self.recording and self.continuous:
            time.sleep(0.05)
            # 1) 推送 audio_level:即使 buffer 为空也推 level=0,前端能及时反应"无声音"
            if not self.audio_buffer:
                self.send({"type": "audio_level", "level": 0})
            else:
                # 只看最近 0.5s 的音频(5 个 chunk @ 100ms),保证反应跟得上嘴
                recent = list(self.audio_buffer)[-5:]
                audio = np.concatenate(recent, axis=0)
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)
                rms = float(np.sqrt(np.mean(audio ** 2)))
                # 阈值 0.03 (正常说话 rms 约 0.05-0.2,这样 level 会冲到 1.0)
                level = min(1.0, max(0.0, rms / 0.03))
                self.send({"type": "audio_level", "level": level})

            # 2) 切段检测
            now = time.time()
            if not self.audio_buffer:
                continue
            recent = list(self.audio_buffer)[-5:]
            audio = np.concatenate(recent, axis=0)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            rms = float(np.sqrt(np.mean(audio ** 2)))
            has_rms = rms >= 0.005  # 非常低的静音阈值,只要有一点点底噪就算"有声音"
            if has_rms:
                self.has_voice = True
                self.silence_start = now
            else:
                if self.has_voice and not self.processing and len(self.audio_buffer) > 10:
                    if self.silence_start > 0 and (now - self.silence_start) >= self.silence_threshold:
                        self.processing = True
                        self._end_segment_requested = True
                        self._last_segment_time = now
            if self.has_voice and not self.processing and len(self.audio_buffer) > 20:
                if now - self._last_segment_time >= 1.5:
                    self.processing = True
                    self._end_segment_requested = True
                    self._last_segment_time = now
            # 注意: _do_session_correct / 润色逻辑已删除(用户不要)

    def _on_segment_end(self, text):
        if text and text.strip():
            clean = text.strip()
            if self._session_text:
                self._session_text += " " + clean
            else:
                self._session_text = clean
            self.send({"type": "transcript", "text": clean, "final": True})
            # 流式输出: 每段一识别完就立即粘贴
            self._paste_text(clean)
            self._last_pasted = clean  # 记下来,stop_recording 跳过它
        else:
            if not self.continuous:
                self.send({"type": "status", "state": "no_speech"})
        self.processing = False
        self.audio_buffer.clear()
        self.partial_text = ""
        self.final_text = ""
        self._last_segment_time = time.time()
        # 关键修复: 连续模式下不发 status 变化,让前端保持 "recording" 红色状态
        if not self.continuous:
            self.send({"type": "status", "state": "idle"})
        # continuous 时不发任何 status,录音态(红色)始终不变

    def _paste_text(self, text):
        try:
            import pyperclip, pyautogui
            pyperclip.copy(text)
            time.sleep(0.1)
            pyautogui.hotkey("ctrl", "v")
            log.info("pasted: %s...", text[:50])
        except Exception:
            try:
                self.send({"type": "paste", "text": text})
            except Exception:
                log.error("paste failed")

    def run(self):
        if not _ws_available:
            log.warning("websockets not installed - ASR will not work")
        self.send({"type": "status", "state": "ready"})
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
                self.handle_command(cmd)
            except json.JSONDecodeError as e:
                log.error("invalid JSON: %s", e)


if __name__ == "__main__":
    engine = VoiceEngine()
    engine.run()




