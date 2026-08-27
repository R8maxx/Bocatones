<script setup>
import { ref } from 'vue'
import { useConfirm } from '../composables/useConfirm.js'
import { useModal, useVeilClose } from '../composables/useModal.js'
import { useDragToDismiss } from '../composables/useDragToDismiss.js'

/*
 * El diálogo que sustituye a los window.confirm / window.prompt.
 *
 * Mismo contrato de modal que PriceList y SlotMachine: el Teleport a body (para
 * quedar fuera del `inert` que useModal pone sobre #app) y la transición de
 * entrada/salida los pone App.vue, que es quien monta y desmonta; aquí queda el
 * panel con role, aria-modal y tabindex="-1", y useModal para el foco, el focus
 * trap y Escape.
 *
 * role="alertdialog" en vez de "dialog": aquí no se navega, se responde a una
 * pregunta, y el lector de pantalla debe anunciarla entera.
 *
 * El botón de cancelar va PRIMERO en el DOM a propósito: al tabular, la salida
 * segura queda antes que la acción, que en la mitad de los casos es destructiva.
 */

const { pending, acceptConfirm, cancelConfirm } = useConfirm()

const panel = ref(null)
useModal(panel, cancelConfirm)

/*
 * Arrastrar = CANCELAR, nunca confirmar, y por el mismo cancelConfirm() que
 * Escape, el velo y el boton. acceptConfirm no entra aqui a proposito: media app
 * pregunta antes de hacer algo destructivo (saldar no tiene deshacer barato), y
 * un gesto amplio que pudiera ACEPTAR seria el peor fallo posible de esta
 * pantalla.
 */
const { wrap, handle } = useDragToDismiss(cancelConfirm)

// pulsar el velo cancela, pero solo si el gesto empieza ahi (ver useVeilClose)
const { onVeilPointerDown, onVeilClick } = useVeilClose(cancelConfirm)
</script>

<template>
  <div
    v-if="pending"
    class="cd-overlay"
    @pointerdown="onVeilPointerDown"
    @click="onVeilClick"
  >
    <!--
      Envoltura solo para separar dos transforms: la entrada y la salida animan
      `transform` de .modal-panel por CSS y el arrastre lo escribe en linea. En
      el mismo elemento gana el de linea y la salida pierde su translateY.
    -->
    <div ref="wrap" class="cd-wrap">
    <div
      ref="panel"
      class="cd-panel modal-panel"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cd-title"
      aria-describedby="cd-text"
      tabindex="-1"
    >
      <span class="modal-grabber" aria-hidden="true" />
      <h3 id="cd-title" ref="handle" class="cd-title modal-grab">
        <span class="hash" aria-hidden="true">#</span> {{ pending.title }}
      </h3>

      <p id="cd-text" class="cd-text">{{ pending.text }}</p>
      <p v-if="pending.detail" class="cd-detail">{{ pending.detail }}</p>
      <pre v-if="pending.code" class="cd-code">{{ pending.code }}</pre>

      <div class="cd-actions">
        <button v-if="!pending.onlyOk" class="cd-btn cancel" type="button" @click="cancelConfirm()">
          {{ pending.cancelLabel }}
        </button>
        <button class="cd-btn ok" :class="{ danger: pending.danger }" type="button" @click="acceptConfirm()">
          {{ pending.confirmLabel }}
        </button>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* mismo velo que el resto de los modales (ver PriceList). La entrada y la
   salida ya no viven aquí: las pone el <Transition name="modal"> de App.vue,
   así el diálogo también se va animado en vez de desaparecer de golpe. */
.cd-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: clamp(0.8rem, 3vw, 2rem);
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

/* el foco entra en el panel para que se anuncie el diálogo antes que un botón:
   ahí no queremos anillo. En los controles sí lo pinta :focus-visible. */
/* el ancho se muda a la envoltura: sin el, bajo place-items:center seria un
   item fit-content y el min(100%,420px) del panel se resolveria contra un padre
   ya encogido */
.cd-wrap { width: min(100%, 420px); }

.cd-panel:focus { outline: none; }
.cd-panel {
  width: 100%;
  max-height: min(86vh, 720px);
  overflow: auto;
  overscroll-behavior-y: contain;
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: clamp(1rem, 3vw, 1.5rem);
  box-shadow: var(--hairline), var(--shadow-lg);
}

.cd-title {
  font-size: var(--fs-3);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line-2);
}
.hash { color: var(--ink-faint); }

.cd-text {
  margin-top: var(--sp-3);
  font-size: var(--fs-3);
  color: var(--ink);
}
.cd-detail {
  margin-top: var(--sp-1);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
}

/* bloque seleccionable: es para copiar a mano cuando el portapapeles falla */
.cd-code {
  margin-top: var(--sp-3);
  max-height: 40vh;
  overflow: auto;
  padding: var(--sp-2);
  font-family: var(--mono);
  font-size: var(--fs-1);
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--ink-dim);
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  user-select: all;
  /* su scroll no se escapa al panel. NO lleva touch-action ni user-select
     propios: tiene que seguir scrolleando con el dedo y seleccionandose entero */
  overscroll-behavior-y: contain;
}

.cd-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.cd-btn {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 700;
  letter-spacing: 0.03em;
  min-height: var(--tap);
  border-radius: var(--radius);
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  transition:
    color var(--dur-2) var(--ease-out),
    background var(--dur-2) var(--ease-out),
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}
.cd-btn.cancel {
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
}
.cd-btn.cancel:hover { color: var(--ink); border-color: var(--ink-dim); }

/* la acción principal, con el mismo peso que el botón de copiar la lista */
.cd-btn.ok {
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
}
.cd-btn.ok:hover { box-shadow: 0 0 22px -4px var(--glow-hard); }

/* magenta = destructivo, igual que el chip armado y el hover de "rm -rf *" */
.cd-btn.ok.danger {
  color: var(--bg);
  background: var(--g1);
  border-color: var(--g1);
}
.cd-btn.ok.danger:hover { box-shadow: 0 0 22px -4px var(--g1); }
</style>
