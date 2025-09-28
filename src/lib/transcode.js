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

/**
 * 智能切割音频（基于静音检测，适用于长音频）
 * @param {File|Blob} inputFile
 * @param {Object} options - 切割选项
 * @returns {Promise<{ segments: Blob[], timeMap: number[], needsSplit: boolean }>}
 */
export async function splitAudioBySilence(inputFile, options = {}) {
  return await ffmpegUtils.splitAudioBySilence(inputFile, options);
}

/**
 * 调整时间戳（根据音频切割后的时间映射）
 * @param {Array} timestamps - 原始时间戳数组
 * @param {Array} timeMap - 切割点时间映射
 * @returns {Array} 调整后的时间戳信息
 */
export function adjustTimestamps(timestamps, timeMap) {
  return ffmpegUtils.adjustTimestamps(timestamps, timeMap);
}