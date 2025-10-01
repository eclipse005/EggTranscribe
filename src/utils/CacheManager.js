/**
 * 转录缓存管理器
 * 使用 IndexedDB 实现断点续传功能
 */
export class CacheManager {
  constructor() {
    this.DB_NAME = 'TranscribeCache';
    this.DB_VERSION = 1;
    this.STORE_NAME = 'transcribe_cache';
    this.db = null;
  }

  /**
   * 初始化数据库
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('fileName', 'fileName', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
    });
  }

  /**
   * 获取数据库实例，如果未初始化则先初始化
   */
  async getDB() {
    if (!this.db) {
      await this.init();
    }
    return this.db;
  }

  /**
   * 创建或更新缓存记录
   * @param {string} fileId - 文件唯一标识
   * @param {Object} data - 缓存数据
   */
  async setCache(fileId, data) {
    // 验证 fileId 是否有效
    if (fileId === null || fileId === undefined || fileId === '') {
      console.error('setCache: fileId is invalid', fileId);
      return Promise.reject(new Error('fileId is invalid'));
    }
    
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);

    // 预处理数据，避免存储大型二进制对象
    const processedData = this._processForStorage(data);

    const cacheData = {
      ...processedData,
      id: fileId,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.put(cacheData);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * 从 IndexedDB 读取缓存记录
   * @param {string} fileId - 文件唯一标识
   */
  async getCache(fileId) {
    // 验证 fileId 是否有效
    if (fileId === null || fileId === undefined || fileId === '') {
      console.warn('getCache: fileId is invalid', fileId);
      return null;
    }
    
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readonly');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(fileId);
      request.onerror = (event) => {
        console.error('getCache error:', event.target.error);
        resolve(null); // 发生错误时返回 null 而不是拒绝
      };
      request.onsuccess = () => {
        // 处理从存储中获取的数据
        const result = request.result;
        if (result) {
          resolve(this._processFromStorage(result));
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * 从存储中获取数据时重新处理
   * @param {Object} data - 从存储获取的数据
   * @returns {Object} 处理后的数据
   */
  _processFromStorage(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    // 创建副本以避免修改原始数据
    const result = { ...data };
    
    if (result.segments && Array.isArray(result.segments)) {
      result.segments = result.segments.map(segment => {
        const processedSegment = { ...segment };
        
        // 如果 blob 是 ArrayBuffer（从 IndexedDB 读取的），则将其转换为 Blob
        if (processedSegment.blob && processedSegment.blob instanceof ArrayBuffer) {
          processedSegment.blob = new Blob([processedSegment.blob], { type: processedSegment.type || 'audio/mpeg' });
        }
        
        return processedSegment;
      });
    }
    
    return result;
  }

  /**
   * 为存储预处理数据（移除大型二进制对象）
   * @param {Object} data - 要存储的数据
   * @returns {Object} 处理后的数据
   */
  _processForStorage(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    // 创建副本以避免修改原始数据
    const result = { ...data };
    
    if (result.segments && Array.isArray(result.segments)) {
      result.segments = result.segments.map(segment => {
        const processedSegment = { ...segment };
        
        // 目前我们仍会在 IndexedDB 中存储 Blob 对象，但如果遇到性能问题，
        // 我们可以考虑只存储转录结果，而重新在需要时分割音频
        // 这将在性能和数据持久性之间权衡
        return processedSegment;
      });
    }
    
    return result;
  }

  /**
   * 获取缓存记录
   * @param {string} fileId - 文件唯一标识
   */
  async getCache(fileId) {
    // 验证 fileId 是否有效
    if (fileId === null || fileId === undefined || fileId === '') {
      console.warn('getCache: fileId is invalid', fileId);
      return null;
    }
    
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readonly');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(fileId);
      request.onerror = (event) => {
        console.error('getCache error:', event.target.error);
        resolve(null); // 发生错误时返回 null 而不是拒绝
      };
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve(this._processFromStorage(result));
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * 获取所有缓存记录
   */
  async getAllCaches() {
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readonly');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * 获取特定状态的缓存记录
   * @param {string} status - 状态
   */
  async getCachesByStatus(status) {
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readonly');
    const store = transaction.objectStore(this.STORE_NAME);
    const index = store.index('status');

    return new Promise((resolve, reject) => {
      const request = index.getAll(status);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * 删除缓存记录
   * @param {string} fileId - 文件唯一标识
   */
  async deleteCache(fileId) {
    // 验证 fileId 是否有效
    if (fileId === null || fileId === undefined || fileId === '') {
      console.warn('deleteCache: fileId is invalid', fileId);
      return Promise.resolve(null);
    }
    
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.delete(fileId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * 清除所有缓存
   */
  async clearAllCaches() {
    const db = await this.getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * 检查是否有可用的断点
   */
  async hasResumePoint(fileId) {
    try {
      const cache = await this.getCache(fileId);
      return cache && cache.status === 'processing' && cache.currentStep !== 'completed';
    } catch (error) {
      console.warn('检查断点失败:', error);
      return false;
    }
  }
}