import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { vReveal } from './composables/useReveal.js'
// cablea anime.js a los tokens de movimiento de la casa. Se importa aquí, y no
// solo desde quien la usa, para que los valores por defecto del motor estén
// puestos antes de que se monte nada (ver src/animate.js).
import './animate.js'

createApp(App).directive('reveal', vReveal).mount('#app')

/*
 * PWA: instalable y con la interfaz en caché (ver public/sw.js).
 *
 * Solo en producción, para no pelear con el servidor de desarrollo de Vite, y
 * solo si el navegador expone `serviceWorker`: en un origen sin HTTPS (o sin
 * localhost) no existe, y entonces la app funciona exactamente igual que
 * siempre, sin caché y sin poder instalarse.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sin service worker la app va igual: solo pierde el arranque sin red */
    })
  })
}
