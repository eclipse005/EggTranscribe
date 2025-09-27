<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50 text-gray-900 relative overflow-hidden">
    <!-- 背景装饰光斑 -->
    <div class="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-brand-400/20 blur-3xl"></div>
    <div class="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-purple-400/20 blur-3xl"></div>

    <main class="relative z-10 px-4 py-8 md:px-8">
      <header class="max-w-5xl mx-auto mb-8 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30 mb-4 select-none">
          G
        </div>
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight">Gemini 音视频转录为 SRT</h1>

      </header>

      <section class="max-w-5xl mx-auto">
        <div class="rounded-2xl border border-white/50 bg-white/70 backdrop-blur-md shadow-xl p-5 md:p-8">
          <Transcriber />
        </div>
      </section>

      <footer class="max-w-5xl mx-auto mt-8 text-center text-xs text-gray-500">
        提示：为获得较好效果，请确保音频清晰；推荐模型：gemini-2.5-flash 或根据需要选择/自定义。
      </footer>
    </main>
  </div>
</template>

<script setup>
import Transcriber from "./components/Transcriber.vue";
</script>