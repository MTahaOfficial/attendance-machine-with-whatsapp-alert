import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev`: the web app runs on :5173 and forwards /api to the Node server on :4000.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  server: {
    host: true,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 2500, // the face-recognition library (TensorFlow.js) is large by nature
  },
});
