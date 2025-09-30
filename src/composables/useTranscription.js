import { ref, computed, onMounted, onUnmounted } from "vue";
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { transcodeToMp316kMono, splitAudioBySilence, setProgressCallback, getCacheStatus, preloadFFmpeg } from "../lib/transcode";
import { SubtitleProcessor } from "../utils/SubtitleProcessor";

export function useTranscription() {
  // 响应式状态
  const apiKey = ref("");
  const file = ref(null);
  const fileDuration = ref(null);
  const srt = ref("");
  const status = ref("");
  const loading = ref(false);
  const showApiKey = ref(false);
  const statusTimeoutId = ref(null);
  const mediaTimeoutId = ref(null);
  const selectedModel = ref("gemini-flash-latest");
  const customModel = ref("");

  // 常量
  const LS_KEY = "genai_api_key";

  // 计算属性
  const effectiveModel = computed(() => {
    return selectedModel.value === "__custom__"
      ? (customModel.value || "gemini-2.5-flash")
      : selectedModel.value;
  });

  const fileMeta = computed(() => {
    if (!file.value) return "";
    return formatBytes(file.value.size);
  });

  // 工具函数
  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B","KB","MB","GB","TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) {
      return "未知时长";
    }
    if (seconds === 0) {
      return "0:00";
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  // 文件变更处理
  async function handleFileChange(f) {
    file.value = f || null;
    fileDuration.value = null; // 重置时长
    
    if (!f) return;
    
    // 获取文件时长信息（如果是音视频文件）
    if (f.type.startsWith('audio/') || f.type.startsWith('video/')) {
      try {
        const url = URL.createObjectURL(f);
        const media = document.createElement('audio'); // 统一使用 audio 元素
        
        // 清理之前的定时器
        if (mediaTimeoutId.value) {
          clearTimeout(mediaTimeoutId.value);
          mediaTimeoutId.value = null;
        }
        
        // 设置媒体元素属性
        media.preload = 'metadata';
        media.muted = true; // 静音避免播放声音
        
        // 设置超时处理
        mediaTimeoutId.value = setTimeout(() => {
          cleanup();
          if (file.value === f) {
            fileDuration.value = null;
          }
        }, 3000); // 减少到3秒超时
        
        const cleanup = () => {
          if (mediaTimeoutId.value) {
            clearTimeout(mediaTimeoutId.value);
            mediaTimeoutId.value = null;
          }
          media.onloadedmetadata = null;
          media.onerror = null;
          media.removeAttribute('src');
          media.load(); // 清空媒体元素
          URL.revokeObjectURL(url);
        };
        
        media.onloadedmetadata = () => {
          if (file.value === f && media.duration && isFinite(media.duration)) {
            fileDuration.value = media.duration;
          } else {
            fileDuration.value = null;
          }
          cleanup();
        };
        
        media.onerror = () => {
          if (file.value === f) {
            fileDuration.value = null;
          }
          cleanup();
        };
        
        // 设置 src 触发加载
        media.src = url;
        
      } catch (error) {
        console.warn('获取文件时长失败:', error);
        if (file.value === f) {
          fileDuration.value = null;
        }
      }
    }
  }

  // 转录主函数
  async function transcribe() {
    if (!apiKey.value) { 
      status.value = "请先输入 API Key";
      return; 
    }
    if (!file.value) { 
      status.value = "请先选择音频文件";
      return; 
    }

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

      const ai = new GoogleGenAI({ apiKey: apiKey.value });

      // 1. 先转码为 Gemini 需要的格式
      status.value = "正在转码音频...";
      const { blob, name, mime } = await transcodeToMp316kMono(file.value);
      const transcodedFile = new File([blob], name, { type: mime });

      // 2. 对转码后的音频进行智能切割
      const splitResult = await splitAudioBySilence(transcodedFile, {
        segmentDuration: 300,     // 5分钟切割
        searchRange: 30,          // 前后30秒搜索范围
        silenceThreshold: -30,    // -30dB静音阈值
        minSilenceDuration: 0.5   // 最小0.5秒静音
      });

      // 3. 准备音频片段（短音频1个片段，长音频多个片段）
      const audioSegments = !splitResult.needsSplit 
        ? [transcodedFile] 
        : splitResult.segments.map((segmentBlob, index) => 
            new File([segmentBlob], `segment_${index + 1}.mp3`, { type: 'audio/mpeg' })
          );

      // 重试函数，支持指数退避
      const retryWithBackoff = async (fn, maxRetries = 4, baseDelay = 2000) => {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
              const delay = baseDelay * Math.pow(2, attempt); // 2, 4, 8, 16 秒
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        throw lastError;
      };

      // 4. 上传并转录每个音频片段
      const transcriptionResults = [];
      const prompt = "Transcribe the audio. Split at natural phrase boundaries. Each line should not contain more than 15 words. " +
        "Output with start and end timestamps. " +
        "For example: [00:00:00:500-00:00:02:000] Hello, this is a test.";

      for (let i = 0; i < audioSegments.length; i++) {
        const segmentFile = audioSegments[i];
        
        try {
          // 上传步骤，带重试
          status.value = `正在上传第 ${i + 1}/${audioSegments.length} 个片段到 Gemini...`;
          
          const uploaded = await retryWithBackoff(async () => {
            return await ai.files.upload({
              file: segmentFile,
              config: { mimeType: segmentFile.type || "audio/mpeg" },
            });
          });

          // 转录步骤，带重试
          status.value = `正在转录第 ${i + 1}/${audioSegments.length} 个片段...`;
          
          const result = await retryWithBackoff(async () => {
            return await ai.models.generateContent({
              model: effectiveModel.value,
              contents: createUserContent([
                createPartFromUri(uploaded.uri, uploaded.mimeType),
                prompt,
              ]),
            });
          });

          const text = (result && result.text) ? result.text.trim() : "";
          
          transcriptionResults.push({
            text,
            segmentIndex: i,
            rawResult: text
          });
        } catch (error) {
          console.error(`处理第 ${i + 1} 个片段时出错:`, error);
          throw new Error(`处理第 ${i + 1} 个片段失败: ${error.message}`);
        }
      }

      // 5. 处理转录结果 - 使用字幕处理工具类
      status.value = "正在合并转录结果...";
      
      // 合并字幕片段
      const combinedRawText = SubtitleProcessor.mergeSubtitleSegments(
        transcriptionResults, 
        splitResult.timeMap
      );
      
      // 转换为 SRT 格式
      const finalSrt = SubtitleProcessor.toSRT(combinedRawText);

      srt.value = finalSrt;
      status.value = srt.value ? "转录完成 ✨" : "转录完成，但未获得文本";
      
    } catch (err) {
      console.error(err);
      status.value = "出错：" + (err?.message || String(err));
    } finally {
      loading.value = false;
      // 清理之前的状态定时器
      if (statusTimeoutId.value) {
        clearTimeout(statusTimeoutId.value);
      }
      // 添加新的状态清理定时器
      statusTimeoutId.value = setTimeout(() => {
        status.value = "";
        statusTimeoutId.value = null;
      }, 2000);
    }
  }

  // 下载SRT文件
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

  // 初始化和清理
  onMounted(async () => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) apiKey.value = saved;
    } catch {}
    
    // 预加载 FFmpeg
    try {
      // 先检查缓存状态
      const cacheStatus = await getCacheStatus();
      
      if (cacheStatus.isFullyCached) {
        // 如果已有完整缓存，静默预加载，不显示状态
        await preloadFFmpeg();
      } else {
        // 如果需要下载，显示预加载状态
        status.value = "正在预加载 FFmpeg（首次下载）...";
        await preloadFFmpeg();
        status.value = "FFmpeg 预加载完成 ✨";
        
        // 3秒后清除状态信息
        if (statusTimeoutId.value) {
          clearTimeout(statusTimeoutId.value);
        }
        statusTimeoutId.value = setTimeout(() => {
          if (status.value === "FFmpeg 预加载完成 ✨") {
            status.value = "";
          }
          statusTimeoutId.value = null;
        }, 3000);
      }
    } catch (error) {
      console.warn('FFmpeg 预加载失败:', error);
      status.value = "";
    }
  });

  // 组件卸载时清理定时器
  onUnmounted(() => {
    // 清理 FFmpeg 状态定时器
    if (statusTimeoutId.value) {
      clearTimeout(statusTimeoutId.value);
      statusTimeoutId.value = null;
    }
    // 清理媒体时长获取定时器
    if (mediaTimeoutId.value) {
      clearTimeout(mediaTimeoutId.value);
      mediaTimeoutId.value = null;
    }
  });

  return {
    // 状态
    apiKey,
    file,
    fileDuration,
    srt,
    status,
    loading,
    showApiKey,
    selectedModel,
    customModel,
    
    // 计算属性
    effectiveModel,
    fileMeta,
    
    // 方法
    formatDuration,
    handleFileChange,
    transcribe,
    downloadSrt
  };
}