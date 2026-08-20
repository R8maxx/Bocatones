<script setup>
import { reactive, ref, watch } from 'vue'
import { useClassics } from '../composables/useClassics.js'
import { useModal } from '../composables/useModal.js'
import { toInput, parse } from '../money.js'

/*
 * PriceList — editor del catálogo de precios (entero y media de cada clásico).
 *
 * Los precios de aquí son la SUGERENCIA que se autorellena al pedir; el importe
 * que se guarda en cada pedido es el que se aplicó en ese momento, así que
 * cambiar un precio aquí no toca el histórico.
 *
 * Si dejas la media en blanco, se cobra la mitad del entero redondeada.
 */

const emit = defineEmits(['close'])
const { classics, loading, updateClassic } = useClassics()

const panel = ref(null)
useModal(panel, () => emit('close'))

// borradores por id: lo que hay escrito en los inputs
const drafts = reactive({})
const saving = ref(null)
const failed = ref(null)

function syncDrafts(list) {
  for (const c of list) {
    if (!drafts[c.id]) drafts[c.id] = { whole: '', half: '' }
    // no pisamos lo que está escribiendo el usuario en la fila que está tocando
    if (saving.value === c.id) continue
    drafts[c.id].whole = toInput(c.priceWhole)
    drafts[c.id].half = toInput(c.priceHalf)
  }
}
syncDrafts(classics.value)
watch(classics, syncDrafts, { deep: true })

async function save(c, field) {
  const d = drafts[c.id]
  const payload =
    field === 'whole' ? { priceWhole: parse(d.whole) } : { priceHalf: parse(d.half) }
  // nada que hacer si no ha cambiado
  const current = field === 'whole' ? c.priceWhole : c.priceHalf
  const next = field === 'whole' ? payload.priceWhole : payload.priceHalf
  if (current === next) return
  saving.value = c.id
  failed.value = null
  try {
    await updateClassic(c.id, payload)
  } catch (e) {
    failed.value = e.message
  } finally {
    saving.value = null
  }
}

// lo que se cobraría por una media si no está definida a mano
const autoHalf = (c) => (c.priceWhole === null ? '' : toInput(Math.round(c.priceWhole / 2)))

</script>

<template>
  <div
    class="pl-overlay"
    @click.self="emit('close')"
  >
    <div
      ref="panel"
      class="pl-panel modal-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pl-title"
      tabindex="-1"
    >
      <div class="pl-head">
        <h3 id="pl-title"><span class="hash">#</span> precios del catálogo</h3>
        <button class="pl-x" type="button" aria-label="cerrar" @click="emit('close')">✕</button>
      </div>

      <p class="pl-note">
        Es el precio que se autorellena al pedir. Cada pedido guarda el importe que se le
        aplicó, así que cambiar esto <b>no altera el histórico</b>.
      </p>

      <p v-if="failed" class="pl-error" role="alert">⚠ {{ failed }}</p>

      <div v-if="classics.length" class="pl-cols" aria-hidden="true">
        <span>relleno</span>
        <span>🥖 entero</span>
        <span>½ media</span>
      </div>

      <ul class="pl-rows">
        <li v-for="c in classics" :key="c.id" class="pl-row">
          <span class="pl-name">{{ c.name }}</span>
          <span class="pl-money" :class="{ busy: saving === c.id }">
            <input
              v-model="drafts[c.id].whole"
              type="text"
              inputmode="decimal"
              maxlength="7"
              placeholder="—"
              :aria-label="`precio del entero de ${c.name}`"
              @change="save(c, 'whole')"
              @blur="save(c, 'whole')"
            />
            <span class="pl-cur" aria-hidden="true">€</span>
          </span>
          <span class="pl-money" :class="{ busy: saving === c.id }">
            <input
              v-model="drafts[c.id].half"
              type="text"
              inputmode="decimal"
              maxlength="7"
              :placeholder="autoHalf(c) || '—'"
              :title="c.priceHalf === null && c.priceWhole !== null ? 'mitad del entero (automático)' : ''"
              :aria-label="`precio de la media de ${c.name}`"
              @change="save(c, 'half')"
              @blur="save(c, 'half')"
            />
            <span class="pl-cur" aria-hidden="true">€</span>
          </span>
        </li>
      </ul>

      <p v-if="loading && !classics.length" class="pl-empty">cargando catálogo…</p>
      <p v-else-if="!classics.length" class="pl-empty">
        Todavía no hay clásicos. Guarda alguno desde el formulario de pedido.
      </p>

      <p class="pl-hint">// media en blanco = la mitad del entero, redondeada</p>
    </div>
  </div>
</template>

<style scoped>
/* la entrada y la salida las pone el <Transition name="modal"> de App.vue:
   antes entraba con @keyframes y se desmontaba de golpe, sin salida */
.pl-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: clamp(0.8rem, 3vw, 2rem);
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.pl-panel:focus { outline: none; }
.pl-panel {
  width: min(100%, 560px);
  max-height: min(86vh, 720px);
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: clamp(1rem, 3vw, 1.6rem);
  box-shadow: var(--hairline), var(--shadow-lg);
}

.pl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--line-2);
}
.pl-head h3 {
  font-size: var(--fs-3);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hash { color: var(--ink-faint); }
.pl-x {
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink-faint);
  font-size: var(--fs-3);
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.pl-x:hover { color: var(--bg); background: var(--ink); }

.pl-note {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--ink-dim);
  margin: 0.9rem 0 1.1rem;
}
.pl-note b { color: var(--ink); font-weight: 700; }

.pl-error {
  font-size: var(--fs-2);
  color: var(--g6);
  border: 1px solid var(--g6);
  border-radius: var(--radius);
  padding: 0.5rem 0.8rem;
  margin-bottom: 0.9rem;
}

.pl-cols,
.pl-row {
  display: grid;
  grid-template-columns: 1fr 6.4rem 6.4rem;
  align-items: center;
  gap: 0.6rem;
}
.pl-cols {
  font-size: var(--fs-1);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
  padding-bottom: 0.5rem;
}
.pl-cols span:not(:first-child) { text-align: right; padding-right: 0.7rem; }

.pl-rows { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; }
.pl-row {
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.5rem 0.6rem;
}
.pl-name {
  min-width: 0;
  font-size: var(--fs-3);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pl-money { position: relative; display: inline-flex; align-items: center; }
.pl-money input {
  width: 100%;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.3rem 1.5rem 0.3rem 0.6rem;
  transition: border-color 0.15s;
}
.pl-money input::placeholder { color: var(--ink-faint); }
.pl-money input:focus { border-color: var(--ink); }
/* guardando: se ve que la petición está en vuelo */
.pl-money.busy input { border-color: var(--ink-dim); opacity: 0.6; }
.pl-cur { position: absolute; right: 0.65rem; font-size: var(--fs-2); color: var(--ink-faint); pointer-events: none; }

.pl-empty, .pl-hint {
  font-size: var(--fs-2);
  color: var(--ink-faint);
  margin-top: 1rem;
}
.pl-empty { text-align: center; font-style: italic; }

@media (max-width: 460px) {
  .pl-cols { display: none; }
  .pl-row { grid-template-columns: 1fr 5.4rem 5.4rem; }
}

@media (prefers-reduced-motion: reduce) {
  .pl-overlay,
  .pl-panel { animation: none; }
}
</style>
