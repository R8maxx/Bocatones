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

// luminancia relativa percibida (0 oscuro .. 1 claro), para decidir la dirección
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// luminancia relativa de la WCAG (con la corrección de gamma), para el contraste
function relLum(hex) {
  const { r, g, b } = hexToRgb(hex)
  const ch = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

// ratio de contraste WCAG entre dos colores (1 = idéntico, 21 = negro/blanco)
function contrast(a, b) {
  const la = relLum(a)
  const lb = relLum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/*
 * Empuja `hex` hacia el blanco o el negro (lo que aleje del fondo) hasta
 * alcanzar el contraste objetivo, conservando el tono todo lo posible.
 *
 * Esto arregla dos problemas de raíz:
 *  - `--ink-faint` daba ~2.3:1 en LOS OCHO temas, y no es decorativo: pinta
 *    todas las etiquetas `//`, los placeholders y los hints.
 *  - la paleta glitch estaba muestreada de un gif sobre negro, así que en el
 *    tema claro el amarillo caía a 1.3:1 y el naranja de la deuda a 2.4:1.
 */
function ensureContrast(hex, against, target) {
  if (contrast(hex, against) >= target) return hex
  const toward = relLum(against) < 0.18 ? '#ffffff' : '#000000'
  let lo = 0
  let hi = 1
  let best = toward
  for (let i = 0; i < 18; i++) {
    const t = (lo + hi) / 2
    const c = mix(hex, toward, t)
    if (contrast(c, against) >= target) {
      best = c
      hi = t
    } else {
      lo = t
    }
  }
  return best
}

// paleta glitch de referencia, muestreada del gif del título (sobre negro)
const GLITCH = {
  '--g1': '#b5126b',
  '--g2': '#1b7a5a',
  '--g3': '#d4b800',
  '--g4': '#1c2b6b',
  '--g5': '#2f8f3e',
  '--g6': '#d4691e',
  '--g7': '#2b8fd4',
  '--g8': '#8a1d9e',
}

function applyTheme(bg) {
  const root = document.documentElement.style
  const dark = luminance(bg) < 0.5
  const fg = dark ? '#ffffff' : '#000000' // dirección del contraste

  root.setProperty('--bg', bg)
  const bgSoft = mix(bg, fg, 0.035)
  const panel = mix(bg, fg, 0.06)
  root.setProperty('--bg-soft', bgSoft)
  root.setProperty('--panel', panel)
  root.setProperty('--line', mix(bg, fg, 0.11))
  root.setProperty('--line-2', mix(bg, fg, 0.17))
  root.setProperty('--ink', mix(bg, fg, dark ? 0.95 : 0.92))
  root.setProperty('--ink-dim', ensureContrast(mix(bg, fg, dark ? 0.55 : 0.6), panel, 4.5))
  // se mide contra --panel, que es el fondo más exigente de los dos
  root.setProperty('--ink-faint', ensureContrast(mix(bg, fg, dark ? 0.3 : 0.42), panel, 4.5))
  root.setProperty('color-scheme', dark ? 'dark' : 'light')

  // los colores de estado tienen que leerse en el tema que sea
  for (const [name, hex] of Object.entries(GLITCH)) {
    root.setProperty(name, ensureContrast(hex, panel, 4.5))
  }

  /*
   * Hacia dónde "hunde" una superficie. En oscuro se hunde hacia el negro; en
   * claro, hacia el blanco. Antes había `#000` literal metido en los color-mix
   * de la tragaperras, así que en el tema claro la máquina se oscurecía mientras
   * el texto se aclaraba: los nombres de los rodillos quedaban a 1.1:1.
   */
  root.setProperty('--sink', dark ? '#000000' : '#ffffff')

  // una sombra sigue siendo oscura en el tema claro, pero mucho más suave
  root.setProperty('--hairline', dark ? '0 0 0 1px rgba(0, 0, 0, 0.55)' : '0 0 0 1px rgba(0, 0, 0, 0.1)')
  root.setProperty('--scrim', dark ? 'rgba(0, 0, 0, 0.76)' : 'rgba(20, 18, 14, 0.55)')

  // las scanlines CRT: blanco en overlay no se ve sobre crema; en claro toca multiply
  root.setProperty('--crt-tint', dark ? 'rgba(255, 255, 255, 0.025)' : 'rgba(0, 0, 0, 0.04)')
  root.setProperty('--crt-blend', dark ? 'overlay' : 'multiply')
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