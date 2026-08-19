<script setup>
import { useNotices } from '../composables/useNotices.js'

/*
 * Notices — pila de avisos del sistema, abajo a la izquierda.
 *
 * Va teleportada a `body` a propósito: `#app` tiene `position: relative` y
 * `z-index: 1` (main.css), lo que crea un contexto de apilamiento; cualquier
 * aviso que se quedara dentro aparecería DEBAJO de los modales, que sí se
 * teleportan. Y justo cuando hace falta avisar de un fallo es cuando puede
 * haber un modal abierto.
 */

const { notices, dismiss, undo } = useNotices()

const ICON = { error: '⚠', ok: '✓', undo: '🗑️' }
</script>

<template>
  <Teleport to="body">
    <div class="notices" role="region" aria-label="Avisos">
      <TransitionGroup name="notice">
        <div
          v-for="n in notices"
          :key="n.id"
          class="notice"
          :class="n.kind"
          :role="n.kind === 'error' ? 'alert' : 'status'"
          aria-live="polite"
        >
          <span class="n-icon" aria-hidden="true">{{ ICON[n.kind] || '·' }}</span>

          <span class="n-body">
            <span class="n-text">{{ n.text }}</span>
            <span v-if="n.detail" class="n-detail">{{ n.detail }}</span>
          </span>

          <button v-if="n.kind === 'undo'" class="n-undo" type="button" @click="undo(n.id)">
            ↩ deshacer
          </button>
          <button v-else class="n-x" type="button" aria-label="descartar aviso" @click="dismiss(n.id)">✕</button>

          <span class="n-bar" :style="{ animationDuration: n.ttl + 'ms' }" aria-hidden="true" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.notices {
  position: fixed;
  left: var(--sp-3);
  bottom: var(--sp-3);
  z-index: var(--z-notice);
  display: flex;
  flex-direction: column-reverse; /* el más reciente, abajo y a la vista */
  gap: var(--sp-2);
  max-width: min(92vw, 30rem);
  pointer-events: none;
}

.notice {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sp-2);
  overflow: hidden;
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-2);
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-left: 2px solid var(--ink-dim);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}
.notice.error { border-left-color: var(--g6); }
.notice.ok { border-left-color: var(--g5); }
.notice.undo { border-left-color: var(--g3); }

.n-icon { font-size: var(--fs-3); line-height: 1; }
.notice.error .n-icon { color: var(--g6); }
.notice.ok .n-icon { color: var(--g5); }

.n-body { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.n-text { font-weight: 700; }
.n-detail { font-size: var(--fs-1); color: var(--ink-dim); }

.n-undo,
.n-x {
  font-family: var(--mono);
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.n-undo {
  font-size: var(--fs-1);
  font-weight: 700;
  white-space: nowrap;
  padding: 0.3rem 0.7rem;
  min-height: var(--tap);
}
.n-undo:hover { color: var(--ink); border-color: var(--ink); }
.n-x {
  font-size: var(--fs-1);
  width: var(--tap);
  height: var(--tap);
  border-color: transparent;
}
.n-x:hover { color: var(--ink); border-color: var(--line-2); }

/* barra de tiempo: scaleX, no width (no provoca reflow) */
.n-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--ink-dim);
  opacity: 0.4;
  transform-origin: left;
  animation: n-drain linear forwards;
}
@keyframes n-drain { to { transform: scaleX(0); } }

.notice-enter-active,
.notice-leave-active { transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.2, 1), opacity 0.25s; }
.notice-enter-from { transform: translateX(-1rem); opacity: 0; }
.notice-leave-to { transform: translateX(-1rem); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .n-bar { animation: none; opacity: 0.25; }
}
</style>
