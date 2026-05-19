import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // 이슈 #357 — production 번들 minify 활성 + sourcemap 분리 + vendor chunk 분할.
    // 이전: 2.6MB raw / 544KB gzip 단일 청크. esbuild minify + manualChunks 적용 시 약 −55% raw / −37% gzip.
    sourcemap: 'hidden',          // map 파일은 산출물에 포함하되 JS 끝 sourceMappingURL 주석 제거 (운영 권장 기본)
    minify: 'esbuild',            // Vite 기본값 회복 — false 명시는 디버그 빌드용
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // node_modules 벤더 분할 — 안정적 캐싱 단위(react/query/charts) 로 분리해 라우트 청크의 무게 감소.
          if (id.includes('node_modules')) {
            if (id.includes('react-router') || id.includes('/react-dom/') || id.includes('/react/')) return 'react-vendor';
            if (id.includes('@tanstack/react-query') || id.includes('/axios/')) return 'query';
            if (id.includes('/recharts/')) return 'charts';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
})
