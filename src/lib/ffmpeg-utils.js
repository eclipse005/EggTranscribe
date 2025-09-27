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
    if (this._ffmpeg && this._isLoaded) return this._ffmpeg;

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
    }
  }

  /**
   * 转码为 WAV
   */
  async transcodeToWav(audioFile, options = {}) {
    const { sampleRate = 16000, channels = 1, bitDepth = 16 } = options;
    const ffmpeg = await this.getFFmpeg();
    
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
    }
  }

  /**
   * 执行自定义 FFmpeg 命令
   */
  async exec(args) {
    const ffmpeg = await this.getFFmpeg();
    return await ffmpeg.exec(args);
  }

  /**
   * 写入文件
   */
  async writeFile(filename, data) {
    const ffmpeg = await this.getFFmpeg();
    await ffmpeg.writeFile(filename, data);
  }

  /**
   * 读取文件
   */
  async readFile(filename) {
    const ffmpeg = await this.getFFmpeg();
    return await ffmpeg.readFile(filename);
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
   * 绑定进度回调到 FFmpeg 实例
   */
  _bindProgressCallback(ffmpeg) {
    if (this._progressCallback && ffmpeg) {
      ffmpeg.off?.("progress");
      ffmpeg.on("progress", ({ progress }) => {
        if (Number.isFinite(progress)) {
          const pct = Math.round(progress * 100);
          this._progressCallback(`音频转换进度: ${pct}%`);
        }
      });
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
}

// 导出单例
const ffmpegUtils = new FFmpegUtils();
export default ffmpegUtils;