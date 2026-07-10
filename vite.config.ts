import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Bind to all interfaces (0.0.0.0) so the dev server is reachable via
    // both IPv4 (127.0.0.1) and IPv6 (::1). On Windows, `localhost` often
    // resolves to IPv6 first while Vite would otherwise bind only one stack,
    // producing "connection refused" in the browser.
    host: true,
    port: 5173,
  },
})
