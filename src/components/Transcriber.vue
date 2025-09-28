<template>
  <div class="space-y-8">
    <!-- API Key 输入 -->
    <div class="row">
      <label class="label" for="apiKey">
        <svg class="w-5 h-5 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd"/>
        </svg>
        API Key
      </label>
      <div class="flex-1 relative">
        <input
          id="apiKey"
          class="input pr-12"
          v-model="apiKey"
          :type="showApiKey ? 'text' : 'password'"
          placeholder="请输入 Google Gemini API Key"
          autocomplete="off"
        />
        <button
          type="button"
          @click="showApiKey = !showApiKey"
          class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors duration-200 focus:outline-none"
        >
          <!-- 显示密码图标 (眼睛睁开) -->
          <svg v-if="showApiKey" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
          </svg>
          <!-- 隐藏密码图标 (眼睛闭上) -->
          <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 文件上传 -->
    <div class="row">
      <label class="label">
        <svg class="w-5 h-5 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
        </svg>
        媒体文件
      </label>
      <div class="flex-1">
        <div class="file-upload">
          <input
            id="audio"
            type="file"
            @change="onFileChange"
            accept="audio/*,video/*"
          />
          <div class="file-upload-content">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            <span v-if="!file">点击选择或拖拽音视频文件</span>
            <span v-else class="text-blue-300">{{ file.name }}</span>
          </div>
        </div>
        
        <!-- 文件信息 -->
        <div v-if="file" class="mt-3 flex items-center gap-4 text-sm text-gray-300">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
            <span>{{ fileMeta }}</span>
          </div>
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
            </svg>
            <span>{{ formatDuration(fileDuration) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 模型选择 -->
    <div class="row">
      <label class="label" for="model">
        <svg class="w-5 h-5 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        识别模型
      </label>
      <div class="flex-1 flex gap-4">
        <select id="model" class="input flex-1" v-model="selectedModel">
          <option value="gemini-2.5-pro">Gemini 2.5 Pro (高精度)</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash (推荐)</option>
          <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (快速)</option>
          <option value="__custom__">自定义模型...</option>
        </select>
        <input
          v-if="selectedModel === '__custom__'"
          class="input flex-1"
          v-model="customModel"
          type="text"
          placeholder="输入自定义模型名称"
        />
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="flex flex-wrap items-center gap-4">
      <button 
        class="btn btn-primary flex-1 md:flex-none" 
        :disabled="!apiKey || !file || loading" 
        @click="transcribe"
      >
        <svg v-if="!loading" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m2-10V7a3 3 0 00-3-3H9a3 3 0 00-3 3v1M7 21h10a2 2 0 002-2v-5a2 2 0 00-2-2H7a2 2 0 00-2 2v5a2 2 0 002 2z"/>
        </svg>
        <svg v-else class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4A4 4 0 004 12z"/>
        </svg>
        <span v-if="!loading">开始转录</span>
        <span v-else>处理中...</span>
      </button>
      
      <button 
        class="btn btn-secondary" 
        :disabled="!srt || loading" 
        @click="downloadSrt"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        下载 SRT
      </button>

      <div class="badge animate-float">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
        </svg>
        {{ status || '等待开始...' }}
      </div>
    </div>


    <!-- 结果展示 -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-white flex items-center gap-2">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
          </svg>
          转录结果
        </h3>
        <div v-if="srt" class="text-sm text-gray-300">
          {{ srt.split('\n').filter(line => line.trim()).length }} 行
        </div>
      </div>
      
      <textarea 
        class="textarea animate-glow" 
        v-model="srt" 
        placeholder="转录结果将在这里显示...&#10;&#10;支持的格式：&#10;• 音频文件：MP3, WAV, M4A, AAC 等&#10;• 视频文件：MP4, AVI, MOV, MKV 等&#10;&#10;转录完成后可直接下载 SRT 字幕文件"
      ></textarea>
    </div>
  </div>
</template>

<script setup>
import { useTranscription } from '../composables/useTranscription';

// 使用组合式函数
const {
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
  formatDuration,
  handleFileChange,
  transcribe,
  downloadSrt
} = useTranscription();

// 文件变更事件处理
function onFileChange(e) {
  const f = e.target.files?.[0];
  handleFileChange(f);
}
</script>

<style scoped>
</style>