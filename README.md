<div align="center">

# `<BOCATONES/>` 🥪

### La lista de bocatas del bar, en directo y con estilo *hacker*.

Pide tu bocata, mira cómo se llena la cola en **tiempo real** desde cualquier
equipo, y cópiale al bar el recuento listo para mandar. Todo en blanco y negro,
con un título *glitch* que imita la terminal.

</div>

---

## ✨ Qué hace

- 🥪 **Pedido del día compartido** — cada uno añade su bocata desde su equipo y
  todos ven la misma cola. El servidor es la fuente de verdad.
- ⚡ **En directo por WebSocket** — las altas y bajas aparecen al instante en
  todas las pantallas, sin recargar.
- 🔔 **Avisos divertidos** — cuando otra persona pide, cae un bocata con su
  frase (*¡marchando!*); cuando alguien se arrepiente, salta un 🗑️ en rojo
  tenue (*alguien se ha arrepentido…*).
- 🗂️ **Catálogo de clásicos** — registra los bocadillos de siempre para pedirlos
  con un clic. Cualquiera puede añadir o borrar.
- 📋 **Copiar para el bar** — un botón copia el recuento agrupado, sin nombres:
  `2x Lomo con queso`, listo para WhatsApp.
- ✏️ **Editar sobre la marcha** — corrige cualquier pedido en línea si alguien
  se equivoca.
- 🎨 **Tema a tu gusto** — elige el color de fondo (8 presets o color libre); se
  guarda en tu navegador y no afecta a los demás. La paleta se recalcula sola
  para seguir siendo legible.
- 📅 **Fecha de hoy** — la lista se organiza por día; cada jornada empieza limpia.

---

## 🚀 Puesta en marcha

> Requiere **Node ≥ 22.12** (usa el SQLite integrado de Node, `node:sqlite`).

```sh
# 1. instalar dependencias
npm install

# 2. arrancar en desarrollo (frontend + backend a la vez)
npm run dev
```

Abre la URL que indique Vite (normalmente <http://localhost:5173>).
El backend levanta en el puerto **3017** y Vite le hace de proxy en `/api` y `/ws`.

> 💡 **Pruébalo en directo:** abre dos pestañas (o dos equipos de la red local).
> Añade un bocata en una y velo aparecer destacado en la otra.

---

## 📦 Producción

```sh
npm run build   # compila el frontend a dist/
npm start       # sirve la web + la API juntas en http://localhost:3017
```

En producción todo va por el mismo puerto: el servidor sirve `dist/` y la API,
y el WebSocket usa el mismo origen sin configuración extra.

Para cambiar el puerto: `PORT=8080 npm start`.

---

## 🧰 Scripts

| Comando            | Qué hace                                                        |
| ------------------ | --------------------------------------------------------------- |
| `npm run dev`      | Frontend (Vite) + backend (API) en paralelo, con recarga.       |
| `npm run dev:web`  | Solo el frontend.                                               |
| `npm run server`   | Solo el backend / API.                                          |
| `npm run build`    | Compila el frontend a `dist/`.                                  |
| `npm start`        | Sirve web + API ya compiladas (producción).                     |
| `npm run preview`  | Previsualiza el `dist/` con el servidor de Vite.                |

---

## 🏗️ Cómo está hecho

**Frontend:** Vue 3 (`<script setup>`) + Vite.
**Backend:** Express + SQLite integrado de Node (`node:sqlite`) — sin dependencias nativas.
**Tiempo real:** WebSocket (`ws`).

```
bocatones/
├─ index.html               # carga fuentes y favicon (bocata.jpg)
├─ vite.config.js           # proxy de /api y /ws → :3017
├─ public/
│  ├─ bocata.jpg            # favicon
│  └─ bocatones_hacker.gif  # gif original que inspira el título
├─ server/
│  └─ index.js              # API REST + WebSocket + SQLite
└─ src/
   ├─ App.vue               # layout, avisos (toasts), estado de conexión
   ├─ api.js                # cliente HTTP + clientId + día local
   ├─ realtime.js           # WebSocket único con reconexión automática
   ├─ assets/               # tema CRT (base.css) y layout (main.css)
   ├─ components/
   │  ├─ GlitchTitle.vue    # título "BOCATONES" con efecto glitch
   │  ├─ OrderForm.vue      # alta de pedido + gestión de clásicos
   │  ├─ OrderList.vue      # cola, edición en línea, destello de llegada
   │  └─ ThemePicker.vue    # selector de color de fondo
   └─ composables/
      ├─ useOrders.js       # lista del día (REST + WebSocket)
      ├─ useClassics.js     # catálogo de clásicos
      └─ useTheme.js        # tema/color persistente por navegador
```

### Datos

- Todo se guarda en **`server/bocatones.db`** (SQLite). Está en `.gitignore`.
- Dos tablas: `classics` (catálogo) y `orders` (pedidos, con columna `day`).
- La primera vez se siembra el catálogo con unos clásicos de ejemplo.
- El **tema** es lo único que vive en el navegador (`localStorage`), porque es
  personal de cada uno.

### Tiempo real, sin sustos

- Cada navegador tiene un `clientId` para **ignorar sus propios cambios** (no se
  auto-notifica ni duplica lo que tú mismo añades o borras).
- Si el WebSocket se cae, reconecta solo (backoff) y hay un **refresco de
  seguridad cada 30 s** que también detecta el cambio de día a medianoche.
- El indicador de la cabecera muestra el estado: **EN DIRECTO / CONECTANDO / RECONECTANDO**.

---

## 🔌 API

Base: `/api` · El día viaja siempre como `YYYY-MM-DD`.

| Método   | Ruta                          | Descripción                              |
| -------- | ----------------------------- | ---------------------------------------- |
| `GET`    | `/api/classics`               | Lista de clásicos.                       |
| `POST`   | `/api/classics`               | Añade un clásico `{ name }`.             |
| `DELETE` | `/api/classics/:id`           | Borra un clásico.                        |
| `GET`    | `/api/orders?day=YYYY-MM-DD`  | Pedidos de ese día.                      |
| `POST`   | `/api/orders`                 | Crea pedido `{ day, person, filling, bread, notes, clientId }`. |
| `PUT`    | `/api/orders/:id`             | Edita un pedido.                         |
| `DELETE` | `/api/orders/:id`             | Borra un pedido.                         |
| `DELETE` | `/api/orders?day=YYYY-MM-DD`  | Vacía el día entero.                     |

Cada cambio en pedidos se difunde por WebSocket (`/ws`) a todos los clientes
conectados como `{ type: 'orders', day, orders, by }`, y los cambios en el
catálogo como `{ type: 'classics', classics }`.

---

<div align="center">
<sub>Hecho con pan y código. 🥪</sub>
</div>