<template>
  <div>
    <div class="row">
      <label class="label" for="apiKey">API Key</label>
      <input
        id="apiKey"
        class="input"
        v-model="apiKey"
        type="password"
        placeholder="请输入 Google API Key"
        autocomplete="off"
      />
    </div>

    <div class="row">
      <label class="label" for="audio">音频文件</label>
      <input
        id="audio"
        class="input"
        type="file"
        @change="onFileChange"
      />
    </div>

    <!-- 本地文件信息（仅选择提示，不涉及上传） -->
    <div v-if="file" class="text-xs text-gray-500 -mt-2 mb-2">
      已选择：{{ file.name }}（{{ fileMeta }}）
    </div>

    <div class="row">
      <label class="label" for="model">模型</label>
      <div class="flex-1 min-w-0 flex gap-3">
        <select id="model" class="input" v-model="selectedModel">
          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
          <option value="__custom__">自定义...</option>
        </select>
        <input
          v-if="selectedModel === '__custom__'"
          class="input"
          v-model="customModel"
          type="text"
          placeholder="请输入自定义模型名，如 gemini-2.5-pro-latest"
        />
      </div>
    </div>

    <div class="row items-center">
      <button class="btn btn-primary" :disabled="!apiKey || !file || loading" @click="transcribe">
        <span v-if="!loading">开始转录</span>
        <span v-else class="inline-flex items-center gap-2">
          <svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4A4 4 0 004 12z"/></svg>
          处理中...
        </span>
      </button>
      <button class="btn" :disabled="!srt || loading" @click="downloadSrt">下载 SRT</button>
      <span class="badge">{{ status }}</span>
    </div>

    <div class="mt-4">
      <textarea class="textarea" v-model="srt" placeholder="转录结果（SRT）将显示在此处"></textarea>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { transcodeToMp316kMono, setProgressCallback, getCacheStatus } from "../lib/transcode";

const apiKey = ref("");
const file = ref(null);
const srt = ref("");
const status = ref("");
const loading = ref(false);

const LS_KEY = "genai_api_key";
onMounted(() => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) apiKey.value = saved;
  } catch {}
});

// 模型选择：内置三种 + 自定义
const selectedModel = ref("gemini-2.5-flash");
const customModel = ref("");
const effectiveModel = computed(() => {
  return selectedModel.value === "__custom__"
    ? (customModel.value || "gemini-2.5-flash")
    : selectedModel.value;
});

// 本地文件信息展示
const fileMeta = computed(() => {
  if (!file.value) return "";
  return formatBytes(file.value.size);
});

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// 弹性 SRT 转换：从右往左解析时间戳，兼容 HH:MM:SS:mmm / MM:SS:mmm / SS:mmm
function toSRT(raw) {
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // 匹配方括号中的起止时间，后接文本；时间部分格式弹性
  const re = /^\[(.+?)\-(.+?)\]\s*(.+)$/;

  function parseFlexible(ts) {
    // 从右往左：毫秒, 秒, 分(可省), 时(可省)
    const parts = ts.trim().split(":").map(s => s.trim());
    if (parts.length < 2 || parts.length > 4) return null;

    const msStr = parts[parts.length - 1];
    const secStr = parts[parts.length - 2];
    const minStr = parts.length >= 3 ? parts[parts.length - 3] : "0";
    const hrStr  = parts.length === 4 ? parts[0] : "0";

    const ms = Number(msStr);
    const sec = Number(secStr);
    const min = Number(minStr);
    const hr  = Number(hrStr);
    if (![ms, sec, min, hr].every(Number.isFinite)) return null;

    const HH = String(Math.max(0, hr)).padStart(2, "0");
    const MM = String(Math.max(0, min)).padStart(2, "0");
    const SS = String(Math.max(0, sec)).padStart(2, "0");
    const mmm = String(Math.max(0, ms)).padStart(3, "0");
    return `${HH}:${MM}:${SS},${mmm}`;
  }

  const out = [];
  let idx = 1;

  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    const start = parseFlexible(m[1]);
    const end = parseFlexible(m[2]);
    const text = m[3];
    if (!start || !end) continue;
    out.push(`${idx++}\n${start} --> ${end}\n${text}\n`);
  }
  // 若没有匹配，保留原文
  return out.length ? out.join("\n").trim() : raw.trim();
}

function onFileChange(e) {
  const f = e.target.files?.[0];
  file.value = f || null;
}

async function transcribe() {
  if (!apiKey.value) { alert("请先输入 API Key"); return; }
  if (!file.value) { alert("请先选择音频文件"); return; }

  srt.value = "";
  status.value = "初始化模型...";
  loading.value = true;

  try {
    // 保存 API Key 到本地
    try { localStorage.setItem(LS_KEY, apiKey.value); } catch {}

    // 设置进度回调
    setProgressCallback((progressText) => {
      status.value = progressText;
    });

    // 检查 IndexedDB 缓存状态
    const cacheStatus = await getCacheStatus();
    
    // 先在本地将媒体转码为 16kbps 单声道 MP3
    if (cacheStatus.isFullyCached) {
      status.value = "正在加载 FFmpeg 核心文件（使用缓存）...";
    } else {
      status.value = "正在加载 FFmpeg 核心文件（首次下载可能耗时较长）...";
    }
    const { blob, name, mime } = await transcodeToMp316kMono(file.value);
    const mp3File = new File([blob], name, { type: mime });

    const ai = new GoogleGenAI({ apiKey: apiKey.value });

    status.value = "音频上传...";

    const uploaded = await ai.files.upload({
      file: mp3File,
      config: { mimeType: mp3File.type || "audio/mpeg" },
    });

    status.value = "请求转录...";
    const prompt =
      "Transcribe the audio. Split at natural phrase boundaries. Each line should not contain more than 15 words. " +
      "Each segment duration should not exceed 6 seconds. " +
      "Output with start and end timestamps. " +
      "For example: [00:00:00:500-00:00:02:000] Hello, this is a test.";

    const result = await ai.models.generateContent({
      model: effectiveModel.value,
      contents: createUserContent([
        createPartFromUri(uploaded.uri, uploaded.mimeType),
        prompt,
      ]),
    });

    const text = (result && result.text) ? result.text : "";
    srt.value = toSRT(text.trim());
    status.value = srt.value ? "转录完成" : "转录完成，但未获得文本";
  } catch (err) {
    console.error(err);
    status.value = "出错：" + (err?.message || String(err));
    alert(status.value);
  } finally {
    loading.value = false;
  }
}

function downloadSrt() {
  if (!srt.value) return;
  const blob = new Blob([srt.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = file.value ? (file.value.name.replace(/\.[^/.]+$/, "") + ".srt") : "transcript.srt";
    a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
</style>