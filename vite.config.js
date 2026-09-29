import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    basicSsl() // Permite usar https:// localmente para poder probar la cámara en el celular
  ],
  server: {
    host: true // Expone la app a la red local (WIFI)
  }
})
