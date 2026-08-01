import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { brandStampPlugin } from './vite.brandStamp.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [brandStampPlugin(), react()],
})
