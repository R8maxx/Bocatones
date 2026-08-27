<script setup>
import { useTheme } from '../composables/useTheme.js'

const { bg, setBg, reset, PRESETS, DEFAULT_BG } = useTheme()
</script>

<template>
  <div class="theme">
    <span class="lbl">// tu tema</span>

    <div class="swatches">
      <button
        v-for="p in PRESETS"
        :key="p.bg"
        type="button"
        class="sw"
        :class="{ active: bg === p.bg }"
        :style="{ background: p.bg }"
        :title="p.name"
        :aria-label="`tema ${p.name}`"
        @click="setBg(p.bg)"
      />

      <label class="sw custom" :style="{ background: bg }" title="color personalizado">
        <span class="plus" aria-hidden="true">+</span>
        <input type="color" :value="bg" @input="setBg($event.target.value)" />
      </label>
    </div>

    <!-- era el único v-if de la topbar que aparecía y desaparecía de golpe -->
    <Transition name="pop">
      <button v-if="bg !== DEFAULT_BG" type="button" class="reset" @click="reset" title="volver al tema por defecto">
        reset
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.theme {
  display: inline-flex;
  align-items: center;
  gap: 0.7ch;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 1.1rem;
}
.lbl {
  font-size: var(--fs-1);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.swatches { display: inline-flex; gap: 0.4rem; }

/* el swatch sigue midiendo 20px a la vista, pero su área táctil llega a 28px
   (WCAG 2.5.8 pide 24 mínimo) */
.sw::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
}
.sw {
  position: relative;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line-2);
  cursor: pointer;
  padding: 0;
  position: relative;
  transition:
    transform var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.sw:hover { transform: scale(1.18); }
.sw.active {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--ink);
}

.sw.custom {
  display: inline-grid;
  place-items: center;
  overflow: hidden;
}
.sw.custom .plus {
  font-size: var(--fs-2);
  line-height: 1;
  color: var(--ink);
  mix-blend-mode: difference;
  pointer-events: none;
}
.sw.custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: none;
}

.reset {
  font-family: var(--mono);
  font-size: var(--fs-1);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.reset:hover { color: var(--ink); border-color: var(--ink); }
</style>