import ffmpegUtils from './ffmpeg-utils.js';

/**
 * 支持的音频格式，无需转码
 */
const SUPPORTED_AUDIO_FORMATS = [
  'audio/wav',
  'audio/mp3', 
  'audio/mpeg',  // MP3的另一种MIME类型
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac'
];

/**
 * 检查文件是否为支持的音频格式
 * @param {File|Blob} file 
 * @returns {boolean}
 */
function isSupportedAudioFormat(file) {
  return SUPPORTED_AUDIO_FORMATS.includes(file.type);
}

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
 * 如果已经是支持的音频格式，则跳过转码
 * @param {File|Blob} inputFile
 * @returns {Promise<{ blob: Blob, name: string, mime: string }>}
 */
export async function transcodeToMp316kMono(inputFile) {
  // 检查是否为支持的音频格式
  if (isSupportedAudioFormat(inputFile)) {
    console.log('文件已经是支持的音频格式，跳过转码:', inputFile.type);
    
    // 直接返回原文件（保持原始音频格式不变），只统一返回对象结构
    const baseName = inputFile?.name?.replace(/\.[^/.]+$/, "") || "audio";
    const extension = inputFile.name?.split('.').pop() || 'audio';
    
    return { 
      blob: inputFile,  // 原始文件，格式不变
      name: `${baseName}.${extension}`, 
      mime: inputFile.type 
    };
  }
  
  // 需要转码的情况
  console.log('文件需要转码:', inputFile.type);
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