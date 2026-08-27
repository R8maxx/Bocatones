<script setup>
import { reactive, ref, watch } from 'vue'
import { useClassics } from '../composables/useClassics.js'
import { useModal, useVeilClose } from '../composables/useModal.js'
import { useDragToDismiss } from '../composables/useDragToDismiss.js'
import { toInput, parse } from '../money.js'
import MoneyInput from './MoneyInput.vue'
import { DUR, STAGGER } from '../motion.js'

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

// arrastrar la cabecera hacia abajo cierra. Mismo cierre que la ✕ y el velo:
// no es una salida nueva, es la misma puerta con otro pomo.
const { wrap, handle } = useDragToDismiss(() => emit('close'))

// pulsar el velo cierra, pero solo si el gesto empieza ahi (ver useVeilClose)
const { onVeilPointerDown, onVeilClick } = useVeilClose(() => emit('close'))

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

/*
 * Cuándo empieza a rodar cada fila.
 *
 * --dur-3 es lo que tarda el panel en entrar (base.css, .modal-enter-active):
 * antes de eso la cifra rodaría por debajo del fundido y no se vería. Y luego
 * una fila detrás de otra con --stagger, el mismo escalón con el que entran las
 * filas de la lista de pedidos. Se topa en la 12ª igual que allí: con veinte
 * clásicos, la última no puede tardar un segundo en arrancar.
 */
const rollDelay = (i) => DUR.d3 + Math.min(i, 12) * STAGGER

</script>

<template>
  <div
    class="pl-overlay"
    @pointerdown="onVeilPointerDown"
    @click="onVeilClick"
  >
    <!--
      Esta envoltura existe SOLO para separar dos transforms que se pelean: la
      entrada y la salida animan `transform` de .modal-panel por CSS, y el
      arrastre escribe un transform EN LINEA. En el mismo elemento gana el de
      linea, la salida se queda sin su translateY, y arrastrar durante los
      280ms de entrada iria con retraso. Aqui el CSS mueve el panel y anime.js
      mueve la envoltura.
    -->
    <div ref="wrap" class="pl-wrap">
    <div
      ref="panel"
      class="pl-panel modal-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pl-title"
      tabindex="-1"
    >
      <span class="modal-grabber" aria-hidden="true" />
      <div ref="handle" class="pl-head modal-grab">
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

      <!--
        Los precios entran RODANDO desde 0, fila a fila, justo cuando el panel
        acaba de aterrizar (ver rollDelay). Es un catálogo de cifras: verlas
        subir dice de un vistazo que esto es lo que se cobra, y no un formulario
        vacío más. Ver MoneyInput.
      -->
      <ul class="pl-rows">
        <li v-for="(c, i) in classics" :key="c.id" class="pl-row">
          <span class="pl-name">{{ c.name }}</span>
          <MoneyInput
            v-model="drafts[c.id].whole"
            style="--mi-w: 100%"
            roll-in
            :delay="rollDelay(i)"
            :busy="saving === c.id"
            placeholder="—"
            :aria-label="`precio del entero de ${c.name}`"
            @change="save(c, 'whole')"
            @blur="save(c, 'whole')"
          />
          <MoneyInput
            v-model="drafts[c.id].half"
            style="--mi-w: 100%"
            roll-in
            :delay="rollDelay(i)"
            :busy="saving === c.id"
            :placeholder="autoHalf(c) || '—'"
            :title="c.priceHalf === null && c.priceWhole !== null ? 'mitad del entero (automático)' : ''"
            :aria-label="`precio de la media de ${c.name}`"
            @change="save(c, 'half')"
            @blur="save(c, 'half')"
          />
        </li>
      </ul>

      <!-- la lista de arriba es hermana, no alternativa: aquí lo que saltaba era
           el relevo cargando <-> sin clásicos -->
      <Transition name="swap" mode="out-in">
        <p v-if="loading && !classics.length" key="loading" class="pl-empty">cargando catálogo…</p>
        <p v-else-if="!classics.length" key="empty" class="pl-empty">
          Todavía no hay clásicos. Guarda alguno desde el formulario de pedido.
        </p>
      </Transition>

      <p class="pl-hint">// media en blanco = la mitad del entero, redondeada</p>
    </div>
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

/* el ancho se muda aqui: la envoltura es la que ocupa la celda del grid, y si
   se quedara en `auto` seria un item fit-content y el min(100%,560px) del panel
   se resolveria contra un padre ya encogido */
.pl-wrap { width: min(100%, 560px); }

.pl-panel:focus { outline: none; }
.pl-panel {
  width: 100%;
  max-height: min(86vh, 720px);
  overflow: auto;
  /* que el final de la lista no arrastre la pagina de debajo */
  overscroll-behavior-y: contain;
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
  transition:
    color var(--dur-1) var(--ease-out),
    background var(--dur-1) var(--ease-out);
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

/* las dos cajas de precio (borde, € dentro, cifra que rueda y estado de
   guardado) son MoneyInput: aquí ya no queda nada suyo que decir */

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
</style>
