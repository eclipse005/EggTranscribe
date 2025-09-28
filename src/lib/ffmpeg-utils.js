import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

/**
 * FFmpeg 工具类 - 简化版
 */
class FFmpegUtils {
  constructor() {
    this._ffmpeg = null;
    this._progressCallback = null;
    this._isLoaded = false;
    this._boundProgressHandler = null; // 用于跟踪绑定的进度处理函数
    this._suppressProgress = false; // 用于控制是否抑制进度回调

    // IndexedDB 缓存配置
    this.DB_NAME = 'FFmpegCache';
    this.DB_VERSION = 1;
    this.STORE_NAME = 'files';
    this.CACHE_VERSION = '0.12.10';
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback) {
    this._progressCallback = callback;
  }

  /**
   * 预加载 FFmpeg（页面加载时调用）
   */
  async preload() {
    if (this._isLoaded || this._loadingPromise) {
      return;
    }
    
    try {
      // 静默预加载，不显示进度信息
      const originalCallback = this._progressCallback;
      this._progressCallback = null;
      
      await this.getFFmpeg();
      
      // 恢复进度回调
      this._progressCallback = originalCallback;
    } catch (error) {
      // 预加载失败不影响后续使用，用户点击时会重新尝试加载
    }
  }

  /**
   * 获取 FFmpeg 实例
   */
  async getFFmpeg() {
    if (this._ffmpeg && this._isLoaded) {
      // 重新绑定回调以确保进度回调是最新的
      this._bindProgressCallback(this._ffmpeg);
      return this._ffmpeg;
    }

    // 清理之前的实例
    if (this._ffmpeg) {
      this._unbindProgressCallback(this._ffmpeg);
    }

    const ffmpeg = new FFmpeg();
    this._bindProgressCallback(ffmpeg);

    try {
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
      
      const [coreURL, wasmURL] = await Promise.all([
        this.getOrCreateBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript', 'ffmpeg-core.js'),
        this.getOrCreateBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm', 'ffmpeg-core.wasm')
      ]);
      
      await ffmpeg.load({ coreURL, wasmURL });
      
    } catch (error) {
      throw new Error(`FFmpeg 加载失败: ${error?.message || error}`);
    }

    this._ffmpeg = ffmpeg;
    this._isLoaded = true;
    return ffmpeg;
  }

  /**
   * 获取缓存状态
   */
  async getCacheStatus() {
    const jsCache = await this.getCachedFile('ffmpeg-core.js');
    const wasmCache = await this.getCachedFile('ffmpeg-core.wasm');
    return {
      hasCachedJS: !!jsCache,
      hasCachedWASM: !!wasmCache,
      isFullyCached: !!(jsCache && wasmCache)
    };
  }

  /**
   * 转码为 MP3 (16kbps 单声道)
   */
  async transcodeToMp316kMono(inputFile) {
    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);

    const ext = this.getFileExtension(inputFile?.name || 'input');
    const inputFS = `input.${ext}`;
    const outputFS = "output.mp3";

    try {
      await ffmpeg.writeFile(inputFS, await fetchFile(inputFile));

      await ffmpeg.exec([
        "-i", inputFS,
        "-vn",
        "-c:a", "libmp3lame",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "16k",
        "-y",
        outputFS,
      ]);

      const data = await ffmpeg.readFile(outputFS);
      const blob = new Blob([data], { type: "audio/mpeg" });

      const baseName = inputFile?.name?.replace(/\.[^/.]+$/, "") || "audio";
      return { blob, name: `${baseName}.mp3`, mime: "audio/mpeg" };
    } finally {
      await this.cleanup([inputFS, outputFS]);
      // 操作完成后，重新绑定当前的全局回调
      this._bindProgressCallback(ffmpeg);
    }
  }

  /**
   * 转码为 WAV
   */
  async transcodeToWav(audioFile, options = {}) {
    const { sampleRate = 16000, channels = 1, bitDepth = 16 } = options;
    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);
    
    const inputFilename = `input.${this.getFileExtension(audioFile.name)}`;
    const outputFilename = 'output.wav';
    
    try {
      await ffmpeg.writeFile(inputFilename, new Uint8Array(await audioFile.arrayBuffer()));
      
      await ffmpeg.exec([
        '-i', inputFilename,
        '-ar', sampleRate.toString(),
        '-ac', channels.toString(),
        '-sample_fmt', this.getBitDepthFormat(bitDepth),
        '-f', 'wav',
        outputFilename
      ]);
      
      return await ffmpeg.readFile(outputFilename);
    } finally {
      await this.cleanup([inputFilename, outputFilename]);
      // 操作完成后，重新绑定当前的全局回调
      this._bindProgressCallback(ffmpeg);
    }
  }

  /**
   * 执行自定义 FFmpeg 命令
   */
  async exec(args) {
    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);
    return await ffmpeg.exec(args);
  }

  /**
   * 写入文件
   */
  async writeFile(filename, data) {
    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);
    await ffmpeg.writeFile(filename, data);
  }

  /**
   * 读取文件
   */
  async readFile(filename) {
    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);
    return await ffmpeg.readFile(filename);
  }

  /**
   * 检测音频中的静音片段
   */
  async detectSilence(audioFile, options = {}) {
    const {
      silenceThreshold = -30,    // 静音阈值（dB）
      minSilenceDuration = 0.5   // 最小静音时长（秒）
    } = options;

    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);
    
    const inputFilename = `silence_input.${this.getFileExtension(audioFile.name)}`;
    
    try {
      await ffmpeg.writeFile(inputFilename, new Uint8Array(await audioFile.arrayBuffer()));
      
      // 使用 silencedetect 滤镜检测静音
      await ffmpeg.exec([
        '-i', inputFilename,
        '-af', `silencedetect=noise=${silenceThreshold}dB:duration=${minSilenceDuration}`,
        '-f', 'null', '-'
      ]);
      
      // 从 FFmpeg 日志中解析静音信息
      // 注意：这里需要从 FFmpeg 的 stderr 输出中解析，实际实现可能需要调整
      return []; // 临时返回空数组，实际需要解析
      
    } finally {
      await this.cleanup([inputFilename]);
      // 操作完成后，重新绑定当前的全局回调
      this._bindProgressCallback(ffmpeg);
    }
  }

  /**
   * 获取音频时长
   */
  async getAudioDuration(audioFile) {
    const ffmpeg = await this.getFFmpeg();
    // 在此操作期间绑定当前的进度回调
    this._bindProgressCallback(ffmpeg);
    
    const inputFilename = `duration_input.${this.getFileExtension(audioFile.name)}`;
    
    try {
      await ffmpeg.writeFile(inputFilename, new Uint8Array(await audioFile.arrayBuffer()));
      
      // 使用 ffprobe 获取时长信息
      await ffmpeg.exec([
        '-i', inputFilename,
        '-f', 'null', '-'
      ]);
      
      // 从输出中解析时长，这里简化处理
      // 实际需要从 FFmpeg 输出中解析 Duration 信息
      return 0; // 临时返回，实际需要解析
      
    } finally {
      await this.cleanup([inputFilename]);
      // 操作完成后，重新绑定当前的全局回调
      this._bindProgressCallback(ffmpeg);
    }
  }

  /** 
   * 智能切割音频（基于静音检测）
   */
  async splitAudioBySilence(audioFile, options = {}) {
    const {
      segmentDuration = 300,     // 目标切割间隔（5分钟）
      searchRange = 30,          // 静音搜索范围（30秒）
      silenceThreshold = -30,    // 静音阈值（dB）
      minSilenceDuration = 0.5,  // 最小静音时长（秒）
      maxSegmentDuration = 360   // 最大段落时长（6分钟）
    } = options;

    // 临时设置标志以抑制进度回调 during the entire segmentation process
    const originalSuppress = this._suppressProgress;
    this._suppressProgress = true;

    // 简化实现：先获取音频时长
    const duration = await this.getSimpleAudioDuration(audioFile);
    
    // 如果音频小于目标切割时长，直接返回原音频
    if (duration <= segmentDuration) {
      // 恢复原始的进度抑制设置
      this._suppressProgress = originalSuppress;
      return {
        segments: [audioFile],
        timeMap: [0],
        needsSplit: false
      };
    }

    // 计算切割点
    const cutPoints = await this.calculateCutPoints(audioFile, duration, {
      segmentDuration,
      searchRange,
      silenceThreshold,
      minSilenceDuration
    });

    // 执行切割
    const segments = await this.splitAudioAtPoints(audioFile, cutPoints);

    // 恢复原始的进度抑制设置
    this._suppressProgress = originalSuppress;

    return {
      segments,
      timeMap: [0, ...cutPoints],
      needsSplit: true,
      originalDuration: duration
    };
  }

  /**
   * 简化的音频时长获取（通过浏览器 Audio API）
   */
  async getSimpleAudioDuration(audioFile) {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(audioFile);
      
      const cleanup = () => {
        audio.src = '';
        URL.revokeObjectURL(url);
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve(0); // 获取失败返回0，会跳过切割
      }, 5000);

      audio.onloadedmetadata = () => {
        clearTimeout(timeout);
        const duration = audio.duration || 0;
        cleanup();
        resolve(duration);
      };

      audio.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(0);
      };

      audio.src = url;
    });
  }

  /**
   * 计算切割点
   */
  async calculateCutPoints(audioFile, duration, options) {
    const { segmentDuration, searchRange, silenceThreshold, minSilenceDuration } = options;
    const cutPoints = [];

    for (let targetTime = segmentDuration; targetTime < duration; targetTime += segmentDuration) {
      // 简化实现：在搜索范围内寻找最佳切割点
      const searchStart = Math.max(0, targetTime - searchRange);
      const searchEnd = Math.min(duration, targetTime + searchRange);
      
      // 尝试在范围内找到静音点
      const silencePoint = await this.findSilenceInRange(
        audioFile, 
        searchStart, 
        searchEnd, 
        { silenceThreshold, minSilenceDuration }
      );

      // 如果找到静音点，使用静音中点；否则使用目标时间
      cutPoints.push(silencePoint || targetTime);
    }

    return cutPoints;
  }

  /**
   * 在指定范围内寻找静音点
   */
  async findSilenceInRange(audioFile, startTime, endTime, options) {
    const ffmpeg = await this.getFFmpeg();
    // 设置标志以抑制进度回调
    const originalSuppress = this._suppressProgress;
    this._suppressProgress = true;
    // 重新绑定以应用新的抑制设置
    this._bindProgressCallback(ffmpeg);
    
    const inputFilename = `range_input.${this.getFileExtension(audioFile.name)}`;
    
    try {
      await ffmpeg.writeFile(inputFilename, new Uint8Array(await audioFile.arrayBuffer()));
      
      // 提取指定时间范围的音频片段进行静音检测
      const tempOutput = 'temp_range.wav';
      await ffmpeg.exec([
        '-i', inputFilename,
        '-ss', startTime.toString(),
        '-to', endTime.toString(),
        '-c:a', 'pcm_s16le',
        tempOutput
      ]);

      // 对片段进行静音检测
      await ffmpeg.exec([
        '-i', tempOutput,
        '-af', `silencedetect=noise=${options.silenceThreshold}dB:duration=${options.minSilenceDuration}`,
        '-f', 'null', '-'
      ]);

      // 简化处理：如果在范围中间附近，认为找到了合适的切割点
      // 实际应该解析 FFmpeg 输出来找到真正的静音点
      const midPoint = (startTime + endTime) / 2;
      return midPoint;

    } catch (error) {
      // 检测失败，返回 null
      return null;
    } finally {
      await this.cleanup([inputFilename, 'temp_range.wav']);
      // 恢复原始的进度抑制设置
      this._suppressProgress = originalSuppress;
      // 重新绑定以应用恢复的设置
      this._bindProgressCallback(ffmpeg);
    }
  }

  /**
   * 在指定切割点切割音频
   */
  async splitAudioAtPoints(audioFile, cutPoints) {
    const ffmpeg = await this.getFFmpeg();
    // 设置标志以抑制进度回调
    const originalSuppress = this._suppressProgress;
    this._suppressProgress = true;
    // 重新绑定以应用新的抑制设置
    this._bindProgressCallback(ffmpeg);
    
    const inputFilename = `split_input.${this.getFileExtension(audioFile.name)}`;
    const segments = [];

    try {
      await ffmpeg.writeFile(inputFilename, new Uint8Array(await audioFile.arrayBuffer()));

      // 添加起始点和结束点
      const allPoints = [0, ...cutPoints];
      
      for (let i = 0; i < allPoints.length; i++) {
        const startTime = allPoints[i];
        const endTime = allPoints[i + 1]; // 如果是最后一段，endTime 为 undefined，FFmpeg 会处理到结尾

        const outputFilename = `segment_${String(i + 1).padStart(3, '0')}.mp3`;
        
        if (this._progressCallback) {
          this._progressCallback(`正在切分音频 (${i + 1}/${allPoints.length})...`);
        }

        const args = [
          '-i', inputFilename,
          '-ss', startTime.toString(),
          '-c', 'copy'
        ];

        if (endTime !== undefined) {
          args.push('-to', endTime.toString());
        }

        args.push('-y', outputFilename);
        
        await ffmpeg.exec(args);

        // 读取切割后的音频数据
        const segmentData = await ffmpeg.readFile(outputFilename);
        const blob = new Blob([segmentData], { type: 'audio/mpeg' });
        
        segments.push(blob);
        
        // 清理临时文件
        await this.cleanup([outputFilename]);
      }

    } finally {
      await this.cleanup([inputFilename]);
      // 恢复原始的进度抑制设置
      this._suppressProgress = originalSuppress;
      // 重新绑定以应用恢复的设置
      this._bindProgressCallback(this._ffmpeg);
    }

    return segments;
  }

  /**
   * 调整时间戳（根据切割点映射）
   */
  adjustTimestamps(timestamps, timeMap) {
    if (!timeMap || timeMap.length <= 1) {
      return timestamps; // 没有切割，返回原时间戳
    }

    const adjustedTimestamps = [];

    for (const timestamp of timestamps) {
      // 找到时间戳属于哪个段落
      let segmentIndex = 0;
      for (let i = 1; i < timeMap.length; i++) {
        if (timestamp >= timeMap[i]) {
          segmentIndex = i;
        } else {
          break;
        }
      }

      // 计算在该段落中的相对时间
      const segmentStartTime = timeMap[segmentIndex];
      const relativeTime = timestamp - segmentStartTime;

      adjustedTimestamps.push({
        originalTime: timestamp,
        segmentIndex,
        relativeTime,
        adjustedTime: relativeTime
      });
    }

    return adjustedTimestamps;
  }

  // ===== 内部辅助方法 =====

  async getOrCreateBlobURL(url, mimeType, fileName) {
    const cachedData = await this.getCachedFile(fileName);
    if (cachedData) {
      try {
        const blob = new Blob([cachedData], { type: mimeType });
        return URL.createObjectURL(blob);
      } catch (e) {
        // 缓存数据损坏，重新下载
      }
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`下载失败: ${response.status}`);
      
      const arrayBuffer = await response.arrayBuffer();
      await this.setCachedFile(fileName, arrayBuffer);
      
      const blob = new Blob([arrayBuffer], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch (error) {
      return await toBlobURL(url, mimeType);
    }
  }

  async getCachedFile(key) {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          if (result && result.version === this.CACHE_VERSION) {
            resolve(result.data);
          } else {
            resolve(null);
          }
        };
      });
    } catch (e) {
      return null;
    }
  }

  async setCachedFile(key, data) {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      
      const record = { key, version: this.CACHE_VERSION, data, timestamp: Date.now() };
      
      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (e) {
      // 保存失败不影响功能
    }
  }

  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
          store.createIndex('version', 'version', { unique: false });
        }
      };
    });
  }

  getFileExtension(filename = '') {
    return filename.split('.').pop()?.toLowerCase() || 'bin';
  }

  getBitDepthFormat(bitDepth) {
    switch (bitDepth) {
      case 8: return 'u8';
      case 16: return 's16';
      case 24: return 's32';
      case 32: return 's32';
      default: return 's16';
    }
  }

  /**
   * 解绑进度回调从 FFmpeg 实例
   */
  _unbindProgressCallback(ffmpeg) {
    if (ffmpeg && this._boundProgressHandler) {
      ffmpeg.off("progress", this._boundProgressHandler);
      this._boundProgressHandler = null;
    }
  }

  /** 
   * 绑定进度回调到 FFmpeg 实例
   */
  _bindProgressCallback(ffmpeg) {
    if (!ffmpeg) return;
    
    // 先解绑之前的进度回调，避免回调累积
    if (this._boundProgressHandler) {
      ffmpeg.off("progress", this._boundProgressHandler);
    }
    
    if (this._progressCallback && typeof this._progressCallback === 'function') {
      // 创建一个新的处理函数
      this._boundProgressHandler = ({ progress }) => {
        if (Number.isFinite(progress) && this._progressCallback && typeof this._progressCallback === 'function') {
          // 只在非分割操作期间显示进度
          if (!this._suppressProgress) {
            const pct = Math.round(progress * 100);
            this._progressCallback(`音频转换进度: ${pct}%`);
          }
        }
      };
      
      ffmpeg.on("progress", this._boundProgressHandler);
    } else {
      // 如果没有回调函数，确保移除之前的监听器
      this._boundProgressHandler = null;
    }
  }

  async cleanup(filenames = []) {
    if (!this._ffmpeg || !this._isLoaded) return;
    
    for (const filename of filenames) {
      try {
        await this._ffmpeg.deleteFile(filename);
      } catch (error) {
        // 清理失败不影响功能
      }
    }
  }
  
  /**
   * 完全清理 FFmpeg 实例，释放所有资源
   */
  async destroy() {
    if (this._ffmpeg) {
      // 解绑所有事件监听器
      if (this._boundProgressHandler) {
        this._ffmpeg.off("progress", this._boundProgressHandler);
        this._boundProgressHandler = null;
      }
      
      // 清理所有文件
      try {
        const files = await this._ffmpeg.listDir('/');
        for (const file of files) {
          await this._ffmpeg.deleteFile(file.name);
        }
      } catch (error) {
        // 忽略清理文件列表的错误
      }
      
      this._ffmpeg = null;
      this._isLoaded = false;
    }
  }
}

// 导出单例
const ffmpegUtils = new FFmpegUtils();
export default ffmpegUtils;