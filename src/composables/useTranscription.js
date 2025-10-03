import { ref, computed, onMounted, onUnmounted } from "vue";
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { transcodeToMp316kMono, splitAudioBySilence, setProgressCallback, getCacheStatus, preloadFFmpeg } from "../lib/transcode";
import { SubtitleProcessor } from "../utils/SubtitleProcessor";
import { CacheManager } from "../utils/CacheManager";
import { FileUtils } from "../utils/FileUtils";

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

  // 统一的定时器管理
  const clearTimer = (timerId) => {
    if (timerId.value) {
      clearTimeout(timerId.value);
      timerId.value = null;
    }
  };

  const setStatusTimer = (message, delay = 2000) => {
    clearTimer(statusTimeoutId);
    status.value = message;
    statusTimeoutId.value = setTimeout(() => {
      status.value = "";
      statusTimeoutId.value = null;
    }, delay);
  };
  const selectedModel = ref("gemini-flash-latest");
  const customModel = ref("");

  // 缓存管理器
  const cacheManager = new CacheManager();

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
    return FileUtils.formatBytes(file.value.size);
  });

  // 文件变更处理
  async function handleFileChange(f) {
    file.value = f || null;
    fileDuration.value = null; // 重置时长
    
    if (!f) return;
    
    // 获取文件时长信息（如果是音视频文件）
    try {
      const duration = await FileUtils.getMediaDuration(f);
      if (file.value === f) {
        fileDuration.value = duration;
      }
    } catch (error) {
      console.warn('获取文件时长失败:', error);
      if (file.value === f) {
        fileDuration.value = null;
      }
    }
  }



  // 转录主函数
  async function transcribe(fileIdOverride = null, isResume = false) {
    if (!apiKey.value) { 
      status.value = "请先输入 API Key";
      return; 
    }
    
    // 如果不是resume模式，需要检查文件
    if (!isResume) {
      if (!file.value) { 
        status.value = "请先选择音频文件";
        return; 
      }
    }

    srt.value = "";
    loading.value = true;
    
    try {
      // 保存 API Key 到本地
      try { localStorage.setItem(LS_KEY, apiKey.value); } catch {}

      // 设置进度回调
      setProgressCallback((progressText) => {
        status.value = progressText;
      });

      const ai = new GoogleGenAI({ apiKey: apiKey.value });

      // 检查是否已有缓存 - 只有在音频分段之后才有缓存
      let cache = null;
      let shouldResume = isResume || false;
      let actualFileId = null;
      
      // 在resume模式下，获取缓存数据
      if (isResume && fileIdOverride) {
        cache = await cacheManager.getCache(fileIdOverride);
        if (cache && (cache.status === 'processing' || cache.status === 'error')) {
          shouldResume = true;
          actualFileId = fileIdOverride;
          console.log(`从断点恢复任务: ${cache.fileName}`);
          
          // 如果是错误状态，重置为processing状态
          if (cache.status === 'error') {
            cache.status = 'processing';
            cache.error = null;
            await cacheManager.setCache(actualFileId, cache);
          }
        } else {
          // 如果缓存不存在或已完成，则不是有效的resume请求
          status.value = "无法恢复任务，缓存不存在或已处理完毕";
          return;
        }
      }

      // 如果不是从断点继续，则执行完整流程直到音频分段
      if (!shouldResume) {
        status.value = "正在转码音频...";
        const { blob, name, mime } = await transcodeToMp316kMono(file.value);
        const transcodedFile = new File([blob], name, { type: mime });

        status.value = "正在检测静音点...";
        const splitResult = await splitAudioBySilence(transcodedFile, {
          segmentDuration: 300,     // 5分钟切割
          searchRange: 30,          // 前后30秒搜索范围
          silenceThreshold: -30,    // -30dB静音阈值
          minSilenceDuration: 0.5   // 最小0.5秒静音
        });

        status.value = "正在分段音频...";
        // 准备音频片段
        const audioSegments = !splitResult.needsSplit 
          ? [transcodedFile] 
          : splitResult.segments.map((segmentBlob, index) => 
              new File([segmentBlob], `segment_${index + 1}.mp3`, { type: 'audio/mpeg' })
            );

        // 创建缓存记录，只包含音频片段和转录结果
        actualFileId = FileUtils.generateFileId(file.value, effectiveModel.value);
        if (!actualFileId) {
          status.value = "生成文件ID失败";
          loading.value = false;
          return;
        }
        
        cache = {
          id: actualFileId,
          fileName: file.value.name,
          segments: audioSegments.map((segment, index) => ({
            index,
            blob: segment,
            processed: false,
            transcription: null,
            uploadedFileId: null
          })),
          totalSegments: audioSegments.length,
          currentStep: 'transcribe', // 从转录步骤开始
          model: effectiveModel.value,
          status: 'processing',
          error: null,
          timestamp: Date.now(),
          splitResult: splitResult // 保存分割结果用于后续合并
        };
        
        // 将分段音频缓存到indexedDB
        await cacheManager.setCache(actualFileId, cache);
      }

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

      // 从音频片段开始，处理未完成的音频片段转录
      status.value = "正在转录音频片段...";
      cache.currentStep = 'transcribe';
      await cacheManager.setCache(actualFileId, cache);

      const prompt = "Transcribe the audio. Split at natural phrase boundaries. Each line should not contain more than 15 words. " +
        "Output with start and end timestamps. " +
        "For example: [00:00:00:500-00:00:02:000] Hello, this is a test.";

      for (let i = 0; i < cache.segments.length; i++) {
        const segment = cache.segments[i];
        
        // 如果该片段已经处理过，则跳过
        if (segment.processed) {
          console.log(`跳过已处理的片段 ${i + 1}`);
          continue;
        }
        
        try {
          // 上传步骤，带重试
          status.value = `正在上传第 ${i + 1}/${cache.totalSegments} 个片段到 Gemini...`;
          
          const uploaded = await retryWithBackoff(async () => {
            return await ai.files.upload({
              file: segment.blob,
              config: { mimeType: segment.blob.type || "audio/mpeg" },
            });
          });

          // 保存上传的文件ID
          segment.uploadedFileId = uploaded.uri;

          // 转录步骤，带重试
          status.value = `正在转录第 ${i + 1}/${cache.totalSegments} 个片段...`;
          
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
          
          // 更新段落信息
          segment.processed = true;
          segment.transcription = text;
          
          // 保存当前进度到缓存
          await cacheManager.setCache(actualFileId, cache);
          
        } catch (error) {
          console.error(`处理第 ${i + 1} 个片段时出错:`, error);
          cache.error = `处理第 ${i + 1} 个片段失败: ${error.message}`;
          cache.status = 'error';
          await cacheManager.setCache(actualFileId, cache);
          throw new Error(`处理第 ${i + 1} 个片段失败: ${error.message}`);
        }
      }

      // 获取最新缓存数据（因为可能在循环中更新）
      cache = await cacheManager.getCache(actualFileId);
      
      // 检查是否所有片段都已处理
      const allProcessed = cache.segments.every(segment => segment.processed);
      if (!allProcessed) {
        status.value = "部分片段处理失败，已保存进度";
        return;
      }

      // 5. 处理转录结果 - 使用字幕处理工具类
      status.value = "正在合并转录结果...";
      cache.currentStep = 'merge';
      await cacheManager.setCache(actualFileId, cache);
      
      // 汇总所有转录结果
      const transcriptionResults = cache.segments.map(segment => ({
        text: segment.transcription,
        segmentIndex: segment.index,
        rawResult: segment.transcription
      }));
      
      // 合并字幕片段
      const combinedRawText = SubtitleProcessor.mergeSubtitleSegments(
        transcriptionResults, 
        cache.splitResult.timeMap
      );
      
      // 转换为 SRT 格式
      const finalSrt = SubtitleProcessor.toSRT(combinedRawText);

      srt.value = finalSrt;
      status.value = srt.value ? "转录完成 ✨" : "转录完成，但未获得文本";
      
      // 更新缓存状态为完成
      cache.status = 'completed';
      cache.currentStep = 'completed';
      await cacheManager.setCache(actualFileId, cache);
      
    } catch (err) {
      console.error(err);
      status.value = "出错：" + (err?.message || String(err));
      
      // 如果出错，更新缓存状态
      try {
        if (actualFileId) {
          const cache = await cacheManager.getCache(actualFileId);
          if (cache) {
            cache.status = 'error';
            cache.error = err?.message || String(err);
            await cacheManager.setCache(actualFileId, cache);
          }
        }
      } catch (cacheErr) {
        console.error('更新缓存状态失败:', cacheErr);
      }
    } finally {
      loading.value = false;
      setStatusTimer("", 2000);
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
    
    // 初始化缓存管理器
    try {
      await cacheManager.init();
      
      // 清理过期缓存
      await cleanupExpiredCaches();
      
      // 检查是否有未完成的转录任务
      const incompleteCaches = await cacheManager.getCachesByStatus('processing');
      if (incompleteCaches.length > 0) {
        const incompleteTasks = incompleteCaches.map(cache => cache.fileName).join(', ');
        console.log(`检测到未完成的转录任务: ${incompleteTasks}`);
        // 可以显示通知给用户，这里先记录到控制台
      }
    } catch (error) {
      console.error('初始化缓存管理器失败:', error);
    }
    
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
        setStatusTimer("FFmpeg 预加载完成 ✨", 3000);
      }
    } catch (error) {
      console.warn('FFmpeg 预加载失败:', error);
      status.value = "";
    }
  });

  // 清理过期缓存（超过24小时的处理中缓存）
  async function cleanupExpiredCaches() {
    try {
      const allCaches = await cacheManager.getAllCaches();
      const now = Date.now();
      const expiredThreshold = 24 * 60 * 60 * 1000; // 24小时
      
      for (const cache of allCaches) {
        if (cache.status === 'processing' && (now - cache.timestamp) > expiredThreshold) {
          await cacheManager.deleteCache(cache.id);
          console.log(`已清理过期缓存: ${cache.fileName}`);
        }
      }
    } catch (error) {
      console.error('清理过期缓存失败:', error);
    }
  }

  // 组件卸载时清理定时器
  onUnmounted(() => {
    clearTimer(statusTimeoutId);
    clearTimer(mediaTimeoutId);
  });

  // 获取所有缓存任务
  async function getCachedTasks() {
    try {
      return await cacheManager.getAllCaches();
    } catch (error) {
      console.error('获取缓存任务失败:', error);
      return [];
    }
  }

  // 恢复特定任务
  async function resumeTask(task) {
    if (!task || (task.status !== 'processing' && task.status !== 'error')) return;
    
    try {
      // 设置状态为继续处理
      status.value = `正在从断点恢复任务: ${task.fileName}`;
      loading.value = true;
      
      // 如果是错误状态的任务，先重置状态为processing
      if (task.status === 'error') {
        const cache = await cacheManager.getCache(task.id);
        if (cache) {
          cache.status = 'processing';
          cache.error = null; // 清除之前的错误信息
          await cacheManager.setCache(task.id, cache);
        }
      }
      
      // 重新执行转录流程，从缓存的分段开始
      await transcribe(task.id, true); // 传入任务ID和resume标志
      
    } catch (error) {
      console.error('恢复任务失败:', error);
      status.value = '恢复任务失败: ' + error.message;
    } finally {
      loading.value = false;
    }
  }

  // 删除特定任务
  async function deleteTask(task) {
    try {
      await cacheManager.deleteCache(task.id);
      status.value = `已删除任务: ${task.fileName}`;
    } catch (error) {
      console.error('删除任务失败:', error);
      status.value = '删除任务失败: ' + error.message;
    }
  }

  // 清空所有缓存
  async function clearAllCaches() {
    try {
      await cacheManager.clearAllCaches();
      status.value = '已清空所有缓存';
    } catch (error) {
      console.error('清空缓存失败:', error);
      status.value = '清空缓存失败: ' + error.message;
    }
  }

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
    formatDuration: FileUtils.formatDuration,
    handleFileChange,
    transcribe,
    downloadSrt,
    // 缓存管理方法
    getCachedTasks,
    resumeTask,
    deleteTask,
    clearAllCaches
  };
}