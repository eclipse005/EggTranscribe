import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/EggTranscribe/',
  plugins: [vue()],
  server: {
    // 优化静态资源服务
    cors: true,
    // 移除可能导致问题的 headers
    fs: {
      // 允许访问项目根目录外的文件
      strict: false
    }
  },
  // 优化构建配置
  build: {
    // 增加 chunk 大小限制，避免 FFmpeg 文件被警告
    chunkSizeWarningLimit: 2000
  },
  // 优化依赖预构建
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core']
  }
})