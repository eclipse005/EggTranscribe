import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// 单例：只加载一次核心
let _ffmpeg = null;
let _progressCallback = null;

// IndexedDB 配置
const DB_NAME = 'FFmpegCache';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const CACHE_VERSION = '0.12.10';

/**
 * 设置进度回调函数
 */
export function setProgressCallback(callback) {
  _progressCallback = callback;
}

/**
 * 打开 IndexedDB 数据库
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('version', 'version', { unique: false });
      }
    };
  });
}

/**
 * 从 IndexedDB 获取缓存的文件
 */
async function getCachedFile(key) {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.version === CACHE_VERSION) {
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
    });
  } catch (e) {
    console.warn('读取 IndexedDB 缓存失败:', e);
    return null;
  }
}

/**
 * 将文件保存到 IndexedDB
 */
async function setCachedFile(key, data) {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const record = {
      key: key,
      version: CACHE_VERSION,
      data: data,
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.warn('保存到 IndexedDB 失败:', e);
  }
}

/**
 * 获取缓存状态
 */
export async function getCacheStatus() {
  const jsCache = await getCachedFile('ffmpeg-core.js');
  const wasmCache = await getCachedFile('ffmpeg-core.wasm');
  return {
    hasCachedJS: !!jsCache,
    hasCachedWASM: !!wasmCache,
    isFullyCached: !!(jsCache && wasmCache)
  };
}

/**
 * 创建或获取缓存的 blob URL
 */
async function getOrCreateBlobURL(url, mimeType, fileName, progressCallback) {
  // 先尝试从 IndexedDB 缓存获取
  const cachedData = await getCachedFile(fileName);
  if (cachedData) {
    if (progressCallback) progressCallback('使用缓存文件...');
    try {
      const blob = new Blob([cachedData], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('缓存数据损坏，重新下载:', e);
    }
  }

  // 缓存不存在或损坏，重新下载
  if (progressCallback) progressCallback('正在下载核心文件...');
  
  try {
    // 下载文件
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // 保存到 IndexedDB 缓存
    await setCachedFile(fileName, arrayBuffer);
    
    // 创建 blob URL
    const blob = new Blob([arrayBuffer], { type: mimeType });
    return URL.createObjectURL(blob);
    
  } catch (error) {
    // 如果直接下载失败，回退到 toBlobURL
    console.warn('直接下载失败，使用 toBlobURL:', error);
    return await toBlobURL(url, mimeType);
  }
}

/**
 * 使用 CDN 版本的 FFmpeg 核心文件，支持 IndexedDB 缓存
 */
async function getFFmpeg() {
  if (_ffmpeg) return _ffmpeg;

  const ffmpeg = new FFmpeg();

  // 设置进度回调，显示在页面状态中
  try {
    ffmpeg.on?.("progress", ({ progress }) => {
      if (_progressCallback && Number.isFinite(progress)) {
        const pct = Math.round(progress * 100);
        _progressCallback(`音频转换进度: ${pct}%`);
      }
    });
  } catch {
    // 事件绑定异常不影响主流程
  }

  try {
    // 使用 jsdelivr CDN，参考官网示例
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    
    // 使用 IndexedDB 缓存机制获取 blob URL
    const coreURL = await getOrCreateBlobURL(
      `${baseURL}/ffmpeg-core.js`, 
      'text/javascript', 
      'ffmpeg-core.js',
      _progressCallback
    );
    
    const wasmURL = await getOrCreateBlobURL(
      `${baseURL}/ffmpeg-core.wasm`, 
      'application/wasm', 
      'ffmpeg-core.wasm',
      _progressCallback
    );
    
    if (_progressCallback) _progressCallback('正在初始化 FFmpeg...');
    await ffmpeg.load({ coreURL, wasmURL });
    
  } catch (error) {
    throw new Error(`FFmpeg 加载失败: ${error?.message || error}`);
  }

  _ffmpeg = ffmpeg;
  return _ffmpeg;
}

/**
 * 将任意音/视频转码为 16 kbps 单声道、16kHz 的 MP3
 * @param {File|Blob} inputFile
 * @returns {Promise<{ blob: Blob, name: string, mime: string }>}
 */
export async function transcodeToMp316kMono(inputFile) {
  const ffmpeg = await getFFmpeg();

  // 生成输入/输出文件名
  const ext = (() => {
    const n = inputFile?.name || "input";
    const i = n.lastIndexOf(".");
    return i >= 0 ? n.slice(i + 1) : "bin";
  })();
  const inputFS = `input.${ext}`;
  const outputFS = "output.mp3";

  // 写入输入文件
  await ffmpeg.writeFile(inputFS, await fetchFile(inputFile));

  // 转码：显式使用 libmp3lame，采样率 16kHz，单声道，比特率 16kbps
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

  // 读取输出
  const data = await ffmpeg.readFile(outputFS);
  const blob = new Blob([data], { type: "audio/mpeg" });

  // 生成输出名
  const baseName = (() => {
    const n = inputFile?.name || "audio";
    const i = n.lastIndexOf(".");
    return i >= 0 ? n.slice(0, i) : n;
  })();
  const name = `${baseName}.mp3`;

  return { blob, name, mime: "audio/mpeg" };
}