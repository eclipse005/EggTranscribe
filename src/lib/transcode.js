import ffmpegUtils from './ffmpeg-utils.js';

/**
 * 设置进度回调函数
 */
export function setProgressCallback(callback) {
  ffmpegUtils.setProgressCallback(callback);
}

/**
 * 获取缓存状态
 */
export async function getCacheStatus() {
  return await ffmpegUtils.getCacheStatus();
}

/**
 * 预加载 FFmpeg（页面加载时调用）
 */
export async function preloadFFmpeg() {
  return await ffmpegUtils.preload();
}

/**
 * 将任意音/视频转码为 16 kbps 单声道、16kHz 的 MP3
 * @param {File|Blob} inputFile
 * @returns {Promise<{ blob: Blob, name: string, mime: string }>}
 */
export async function transcodeToMp316kMono(inputFile) {
  return await ffmpegUtils.transcodeToMp316kMono(inputFile);
}