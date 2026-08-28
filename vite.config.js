import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/*
 * Sello de build: el commit del que sale este bundle.
 *
 * Sirve para dos cosas, y las dos existen por el mismo motivo — que un
 * compañero con la app abierta desde ayer no se quede mirando la versión de
 * ayer:
 *   1. el servidor lo anuncia por el WebSocket y el cliente compara con el
 *      suyo (src/composables/useVersion.js);
 *   2. le da nombre a la caché del service worker, así que cada despliegue
 *      estrena caché y el `activate` borra la anterior (public/sw.js).
 *
 * Fuera de un repo git (un tarball, un contenedor sin .git) cae a la hora del
 * build: peor de leer, pero igual de único, que es lo único que importa aquí.
 */
const BUILD = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return `t${Date.now().toString(36)}`
  }
})()

/*
 * Los ficheros de `public/` se copian LITERALES a dist: ni `define` ni ninguna
 * transformación de Vite los toca. Y sw.js necesita el sello dentro. De ahí
 * este plugin: cuando el bundle ya está escrito, sustituye el marcador y deja
 * al lado un version.json que lee el servidor al arrancar.
 */
function stampBuild(version) {
  return {
    name: 'bocatones-stamp-build',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist', import.meta.url))
      const sw = `${dist}/sw.js`
      writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD__', version))
      writeFileSync(
        `${dist}/version.json`,
        `${JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)}\n`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    stampBuild(BUILD),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(BUILD),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3017',
      '/ws': { target: 'ws://localhost:3017', ws: true },
    },
  },
})
