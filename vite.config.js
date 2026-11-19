import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // [FASE 5] En desenvolupament, Vite (5173) reenvia el WebSocket /senyal
    // al servidor de senyalització (3030). Així el client sempre es connecta
    // al mateix origen, tant amb `npm run dev` com en producció.
    proxy: {
      '/senyal': { target: 'ws://localhost:3030', ws: true }
    }
  }
})
