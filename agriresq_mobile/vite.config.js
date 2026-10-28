import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'



export default defineConfig({
  plugins: [react()],
  base: './',

  server: {
    port: 5173,
    proxy: {
      // Django backend (IoT hub). The ESP32-CAM live view is proxied by Django
      // at /api/devices/<id>/live/, so no camera IP is hardcoded here.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})