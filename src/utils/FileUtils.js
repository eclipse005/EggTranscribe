/**
 * 文件处理工具类
 * 统一处理文件相关的常用操作
 */
export class FileUtils {
  /**
   * 获取文件扩展名
   * @param {string} filename - 文件名
   * @returns {string} 扩展名（小写）
   */
  static getFileExtension(filename = '') {
    return filename.split('.').pop()?.toLowerCase() || 'bin';
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的大小
   */
  static formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * 格式化时长
   * @param {number} seconds - 秒数
   * @returns {string} 格式化后的时长
   */
  static formatDuration(seconds) {
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

  /**
   * 生成文件唯一ID
   * @param {File} file - 文件对象
   * @param {string} model - 模型名称
   * @returns {string|null} 文件ID
   */
  static generateFileId(file, model) {
    if (!file) {
      console.error('generateFileId: file is null or undefined');
      return null;
    }
    
    if (!file.name || !model) {
      console.error('generateFileId: missing required parameters', { fileName: file.name, model });
      return null;
    }
    
    try {
      const safeName = encodeURIComponent(file.name);
      const safeModel = encodeURIComponent(model);
      return `${safeName}_${file.size}_${file.lastModified}_${safeModel}`;
    } catch (error) {
      console.error('generateFileId: error creating ID', error);
      return null;
    }
  }

  /**
   * 检查是否为支持的音频格式
   * @param {File} file - 文件对象
   * @returns {boolean} 是否支持
   */
  static isSupportedAudioFormat(file) {
    const supportedFormats = [
      'audio/wav',
      'audio/mp3', 
      'audio/mpeg',
      'audio/aiff',
      'audio/aac',
      'audio/ogg',
      'audio/flac'
    ];
    return supportedFormats.includes(file.type);
  }

  /**
   * 获取媒体文件时长
   * @param {File} file - 媒体文件
   * @returns {Promise<number|null>} 时长（秒）
   */
  static getMediaDuration(file) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
        resolve(null);
        return;
      }

      const url = URL.createObjectURL(file);
      const media = document.createElement('audio');
      
      const cleanup = () => {
        media.onloadedmetadata = null;
        media.onerror = null;
        media.removeAttribute('src');
        media.load();
        URL.revokeObjectURL(url);
      };
      
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 3000);
      
      media.preload = 'metadata';
      media.muted = true;
      
      media.onloadedmetadata = () => {
        clearTimeout(timeout);
        const duration = media.duration && isFinite(media.duration) ? media.duration : null;
        cleanup();
        resolve(duration);
      };
      
      media.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(null);
      };
      
      media.src = url;
    });
  }
}