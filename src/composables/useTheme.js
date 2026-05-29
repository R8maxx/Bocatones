import { ref, watch } from 'vue'

/*
 * useTheme — color de fondo personalizable por persona.
 *
 * Cada compañero elige su fondo; se guarda en SU localStorage y se aplica
 * recalculando toda la paleta (texto, paneles, líneas) a partir del color
 * para que siga siendo legible, sea claro u oscuro.
 */

const STORAGE_KEY = 'bocatones:bg'
const DEFAULT_BG = '#050505'

// presets cuidados (oscuros + un par claros) que quedan bien con el tema
export const PRESETS = [
  { name: 'terminal', bg: '#050505' },
  { name: 'matrix', bg: '#143d24' },
  { name: 'medianoche', bg: '#15294f' },
  { name: 'vino', bg: '#45191b' },
  { name: 'violeta', bg: '#2c1944' },
  { name: 'pizarra', bg: '#1f2e35' },
  { name: 'café', bg: '#33240f' },
  { name: 'papel', bg: '#ece7da' },
]

function clampHex(v) {
  if (typeof v !== 'string') return DEFAULT_BG
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : DEFAULT_BG
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function toHex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

// mezcla c1 hacia c2 en proporción t (0..1)
function mix(c1, c2, t) {
  const a = hexToRgb(c1)
  const b = hexToRgb(c2)
  return `#${toHex(a.r + (b.r - a.r) * t)}${toHex(a.g + (b.g - a.g) * t)}${toHex(a.b + (b.b - a.b) * t)}`
}

// luminancia relativa percibida (0 oscuro .. 1 claro)
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function applyTheme(bg) {
  const root = document.documentElement.style
  const dark = luminance(bg) < 0.5
  const fg = dark ? '#ffffff' : '#000000' // dirección del contraste

  root.setProperty('--bg', bg)
  root.setProperty('--bg-soft', mix(bg, fg, 0.035))
  root.setProperty('--panel', mix(bg, fg, 0.06))
  root.setProperty('--line', mix(bg, fg, 0.11))
  root.setProperty('--line-2', mix(bg, fg, 0.17))
  root.setProperty('--ink', mix(bg, fg, dark ? 0.95 : 0.92))
  root.setProperty('--ink-dim', mix(bg, fg, dark ? 0.55 : 0.6))
  root.setProperty('--ink-faint', mix(bg, fg, dark ? 0.3 : 0.42))
  root.setProperty('color-scheme', dark ? 'dark' : 'light')
}

const bg = ref(clampHex(localStorage.getItem(STORAGE_KEY) || DEFAULT_BG))

// aplica de inmediato al cargar el módulo (antes del primer render de Vue)
applyTheme(bg.value)

watch(bg, (v) => {
  const c = clampHex(v)
  applyTheme(c)
  try {
    localStorage.setItem(STORAGE_KEY, c)
  } catch {
    /* ignorar */
  }
})

export function useTheme() {
  function setBg(v) {
    bg.value = clampHex(v)
  }
  function reset() {
    setBg(DEFAULT_BG)
  }
  return { bg, setBg, reset, PRESETS, DEFAULT_BG }
}