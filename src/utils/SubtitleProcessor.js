/**
 * 字幕处理工具类
 * 负责处理字幕格式转换、时间戳调整等功能
 */
export class SubtitleProcessor {
  /**
   * 将原始转录文本转换为SRT格式
   * 支持弹性时间戳解析：HH:MM:SS:mmm / MM:SS:mmm / SS:mmm
   * @param {string} rawText - 原始转录文本
   * @returns {string} SRT格式字幕
   */
  static toSRT(rawText) {
    if (!rawText) return "";
    
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // 匹配方括号中的起止时间，后接文本；时间部分格式弹性
    const re = /^\[(.+?)\-(.+?)\]\s*(.+)$/;

    const out = [];
    let idx = 1;

    for (const line of lines) {
      const m = re.exec(line);
      if (!m) continue;
      
      const start = this._parseFlexibleTimestamp(m[1]);
      const end = this._parseFlexibleTimestamp(m[2]);
      const text = m[3];
      
      if (!start || !end) continue;
      out.push(`${idx++}\n${start} --> ${end}\n${text}\n`);
    }
    
    // 若没有匹配，保留原文
    return out.length ? out.join("\n").trim() : rawText.trim();
  }

  /**
   * 调整原始文本中的时间戳偏移量
   * @param {string} rawText - 原始文本
   * @param {number} offsetSeconds - 偏移秒数
   * @returns {string} 调整后的文本
   */
  static adjustTimestampsInRawText(rawText, offsetSeconds) {
    if (!rawText || offsetSeconds === 0) return rawText;
    
    // 匹配格式：[ 00:56:557-00:59:777 ] 或 [00:56:557-00:59:777] 的时间戳模式
    const timestampRegex = /\[([^\]]*?)\]/g;
    
    return rawText.replace(timestampRegex, (match, timestampPart) => {
      // 拆分开始时间和结束时间
      const [startTime, endTime] = timestampPart.split('-');
      if (!startTime || !endTime) return match;
      
      const parsedStart = this._parseTimestamp(startTime);
      const parsedEnd = this._parseTimestamp(endTime);
      
      if (!parsedStart || !parsedEnd) return match;
      
      // 添加偏移量
      const adjustedStart = this._addSecondsToTimestamp(parsedStart, offsetSeconds);
      const adjustedEnd = this._addSecondsToTimestamp(parsedEnd, offsetSeconds);
      
      if (!adjustedStart || !adjustedEnd) return match;
      
      // 格式化调整后的时间戳
      const formattedStart = this._formatTimestamp(adjustedStart);
      const formattedEnd = this._formatTimestamp(adjustedEnd);
      
      if (!formattedStart || !formattedEnd) return match;
      
      return `[${formattedStart}-${formattedEnd}]`;
    });
  }

  /**
   * 合并多个字幕片段
   * @param {Array} transcriptionResults - 转录结果数组
   * @param {Array} timeMap - 时间映射数组
   * @returns {string} 合并后的原始文本
   */
  static mergeSubtitleSegments(transcriptionResults, timeMap) {
    const adjustedRawTexts = [];
    
    for (let segmentIndex = 0; segmentIndex < transcriptionResults.length; segmentIndex++) {
      const result = transcriptionResults[segmentIndex];
      if (!result.text) continue;
      
      // 获取片段开始时间偏移量
      const segmentStartTime = timeMap[segmentIndex] || 0;
      const adjustedText = this.adjustTimestampsInRawText(result.text, segmentStartTime);
      
      adjustedRawTexts.push(adjustedText);
    }
    
    return adjustedRawTexts.join('\n');
  }

  /**
   * 解析弹性时间戳格式（用于SRT转换）
   * @private
   * @param {string} ts - 时间戳字符串
   * @returns {string|null} SRT格式时间戳
   */
  static _parseFlexibleTimestamp(ts) {
    // 从右往左：毫秒, 秒, 分(可省), 时(可省)
    const parts = ts.trim().split(":").map(s => s.trim());
    if (parts.length < 2 || parts.length > 4) return null;

    const msStr = parts[parts.length - 1];
    const secStr = parts[parts.length - 2];
    const minStr = parts.length >= 3 ? parts[parts.length - 3] : "0";
    const hrStr = parts.length === 4 ? parts[0] : "0";

    let ms = Number(msStr);
    const sec = Number(secStr);
    const min = Number(minStr);
    const hr = Number(hrStr);
    
    if (![ms, sec, min, hr].every(Number.isFinite)) return null;

    // 处理毫秒格式：如果是1-2位数字，需要补齐到3位
    // 例如：60 -> 600, 5 -> 500, 123 -> 123
    if (msStr.length === 1) {
      ms = ms * 100; // 5 -> 500
    } else if (msStr.length === 2) {
      ms = ms * 10;  // 60 -> 600
    }
    // 3位数字保持不变

    const HH = String(Math.max(0, hr)).padStart(2, "0");
    const MM = String(Math.max(0, min)).padStart(2, "0");
    const SS = String(Math.max(0, sec)).padStart(2, "0");
    const mmm = String(Math.max(0, ms)).padStart(3, "0");
    
    return `${HH}:${MM}:${SS},${mmm}`;
  }

  /**
   * 解析时间戳为对象格式
   * @private
   * @param {string} ts - 时间戳字符串
   * @returns {Object|null} 时间戳对象 {hr, min, sec, ms}
   */
  static _parseTimestamp(ts) {
    // 支持 HH:MM:SS:mmm / MM:SS:mmm / SS:mmm 格式
    const parts = ts.trim().split(":").map(s => s.trim());
    if (parts.length < 2 || parts.length > 4) return null;

    const msStr = parts[parts.length - 1];
    const secStr = parts[parts.length - 2];
    const minStr = parts.length >= 3 ? parts[parts.length - 3] : "0";
    const hrStr = parts.length === 4 ? parts[0] : "0";

    let ms = Number(msStr);
    const sec = Number(secStr);
    const min = Number(minStr);
    const hr = Number(hrStr);
    
    if (![ms, sec, min, hr].every(Number.isFinite)) return null;

    // 处理毫秒格式：如果是1-2位数字，需要补齐到3位
    // 例如：60 -> 600, 5 -> 500, 123 -> 123
    if (msStr.length === 1) {
      ms = ms * 100; // 5 -> 500
    } else if (msStr.length === 2) {
      ms = ms * 10;  // 60 -> 600
    }
    // 3位数字保持不变

    return { hr, min, sec, ms };
  }

  /**
   * 格式化时间戳对象为字符串
   * @private
   * @param {Object} parsedTs - 时间戳对象
   * @returns {string|null} 格式化的时间戳字符串
   */
  static _formatTimestamp(parsedTs) {
    if (!parsedTs) return null;
    
    const { hr, min, sec, ms } = parsedTs;
    const HH = String(Math.max(0, hr)).padStart(2, "0");
    const MM = String(Math.max(0, min)).padStart(2, "0");
    const SS = String(Math.max(0, sec)).padStart(2, "0");
    const mmm = String(Math.max(0, ms)).padStart(3, "0");
    
    return `${HH}:${MM}:${SS}:${mmm}`;
  }

  /**
   * 为时间戳对象添加秒数偏移
   * @private
   * @param {Object} parsedTs - 时间戳对象
   * @param {number} seconds - 要添加的秒数
   * @returns {Object|null} 调整后的时间戳对象
   */
  static _addSecondsToTimestamp(parsedTs, seconds) {
    if (!parsedTs) return null;
    
    const { hr, min, sec, ms } = parsedTs;
    const totalSeconds = hr * 3600 + min * 60 + sec + seconds;
    const newH = Math.floor(totalSeconds / 3600);
    const newM = Math.floor((totalSeconds % 3600) / 60);
    const newS = Math.floor(totalSeconds % 60);
    
    return {
      hr: newH,
      min: newM,
      sec: newS,
      ms: ms // 毫秒部分保持不变
    };
  }

  /**
   * 验证字幕文本格式
   * @param {string} text - 字幕文本
   * @returns {boolean} 是否为有效的字幕格式
   */
  static isValidSubtitleFormat(text) {
    if (!text) return false;
    
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const timestampRegex = /^\[(.+?)\-(.+?)\]\s*(.+)$/;
    
    // 至少要有一行符合时间戳格式
    return lines.some(line => timestampRegex.test(line));
  }

  /**
   * 获取字幕统计信息
   * @param {string} srtText - SRT格式字幕文本
   * @returns {Object} 统计信息 {lineCount, duration, segmentCount}
   */
  static getSubtitleStats(srtText) {
    if (!srtText) return { lineCount: 0, duration: 0, segmentCount: 0 };
    
    const lines = srtText.split('\n').filter(line => line.trim());
    const timeRegex = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;
    
    let segmentCount = 0;
    let maxEndTime = 0;
    
    for (const line of lines) {
      const match = timeRegex.exec(line);
      if (match) {
        segmentCount++;
        // 计算结束时间（秒）
        const endHours = parseInt(match[5]);
        const endMinutes = parseInt(match[6]);
        const endSeconds = parseInt(match[7]);
        const endMs = parseInt(match[8]);
        
        const endTime = endHours * 3600 + endMinutes * 60 + endSeconds + endMs / 1000;
        maxEndTime = Math.max(maxEndTime, endTime);
      }
    }
    
    return {
      lineCount: lines.length,
      duration: maxEndTime,
      segmentCount
    };
  }
}