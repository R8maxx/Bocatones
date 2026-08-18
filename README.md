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
- 🗂️ **Catálogo de clásicos** — registra los bocadillos de siempre, con su
  precio, para pedirlos con un clic. Cualquiera puede añadir o borrar.
- 💰 **Precios y quién ha pagado** — el precio se autorellena desde el catálogo y
  se puede ajustar en cada pedido. Un check por pedido marca quién ha pagado, y
  el panel resume la **deuda acumulada** de cada uno sumando todos los días
  pendientes (con un botón para saldar la cuenta de golpe).
- 🎰 **Sorteo de quién recoge** — una tragaperras decide quién baja al bar, y gira
  a la vez en todas las pantallas con el mismo resultado.
- ⚖️ **Y es un sorteo justo** — no es 100% aleatorio: **quien menos ha ido tiene
  más papeletas**. Con 0, 1 y 5 recogidas a la espalda las probabilidades quedan
  en ~78% / 19% / 2%. Nadie llega nunca al 0%, así que sigue habiendo emoción, y
  los porcentajes están **a la vista antes de tirar de la palanca** para que no
  haya discusiones.
- 🚫 **Quien hoy no puede ir** — si alguien tiene reunión o está fuera, se le
  marca en la propia tragaperras con un clic: queda tachado, sin papeletas y no
  aparece ni en los rodillos. Es **por día**, se ve al instante en todas las
  pantallas, y no le cuenta como haber ido (así que no pierde su turno).
- 📜 **Modo histórico** — consulta los días anteriores: qué se pidió, cuánto
  costó, quién pagó y **quién lo recogió** (corregible a mano si al final fue
  otro). Incluye resumen por persona y el ranking de a quién le toca.
- 📋 **Copiar para el bar** — un botón copia el recuento agrupado, sin nombres:
  `2x Lomo con queso`, listo para WhatsApp.
- ✏️ **Editar sobre la marcha** — corrige cualquier pedido en línea si alguien
  se equivoca.
- 🎨 **Tema a tu gusto** — elige el color de fondo (8 presets o color libre); se
  guarda en tu navegador y no afecta a los demás. La paleta se recalcula sola
  para seguir siendo legible.
- 📅 **Fecha de hoy** — la lista se organiza por día; cada jornada empieza limpia
  y la anterior se queda guardada en el histórico.

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

## 🖥️ Despliegue en un servidor propio (PM2 + nginx)

Para dejarlo corriendo en un servidor Linux de forma permanente, hay un script
listo en **[`deploy/install.sh`](deploy/install.sh)** que automatiza todo:
instala PM2, compila el frontend, arranca la app como servicio (con reinicio
automático y logs) y configura nginx como proxy inverso (incluido el WebSocket).

**Requisitos previos en el servidor:**

- Node ≥ 22.12 y npm
- nginx instalado
- el proyecto clonado en la ruta que uses como `APP_DIR` (por defecto `/opt/Bocatones`)

**Pasos:**

```sh
# 1. clona el proyecto en el servidor
sudo git clone https://github.com/TU_USUARIO/bocatones.git /opt/Bocatones

# 2. edita las variables del principio del script a tu gusto
#    APP_DIR · APP_PORT · NGINX_PORT · SERVER_IP
sudo nano /opt/Bocatones/deploy/install.sh

# 3. ejecútalo como root
cd /opt/Bocatones
sudo bash deploy/install.sh
```

Al terminar tendrás la app en `http://SERVER_IP:NGINX_PORT`.

| Variable     | Por defecto      | Qué es                                   |
| ------------ | ---------------- | ---------------------------------------- |
| `APP_DIR`    | `/opt/Bocatones` | Dónde está clonado el proyecto.          |
| `APP_PORT`   | `3017`           | Puerto interno del servidor Node.        |
| `NGINX_PORT` | `8080`           | Puerto público que sirve nginx.          |
| `SERVER_IP`  | —                | IP o dominio del servidor.               |

**Gestión del servicio** (PM2):

```sh
pm2 status            # estado
pm2 logs bocatones    # ver logs en vivo
pm2 restart bocatones # reiniciar
```

**Actualizar tras un cambio de código:**

```sh
cd /opt/Bocatones
sudo git pull
npm install
npm run build
pm2 restart bocatones
```

> El WebSocket necesita las cabeceras `Upgrade`/`Connection` en nginx; el script
> ya las pone en el bloque `location /ws` (colocado **antes** de `location /`).
> Los datos (SQLite) viven en `APP_DIR/server/bocatones.db` y persisten entre
> reinicios y actualizaciones.

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
   ├─ App.vue               # layout, avisos (toasts), estado de conexión, vista hoy/histórico
   ├─ api.js                # cliente HTTP + clientId + día local
   ├─ money.js              # euros ⇄ céntimos (formato y parseo)
   ├─ realtime.js           # WebSocket único con reconexión automática
   ├─ assets/               # tema CRT (base.css) y layout (main.css)
   ├─ components/
   │  ├─ GlitchTitle.vue    # título "BOCATONES" con efecto glitch
   │  ├─ OrderForm.vue      # alta de pedido + precio + gestión de clásicos
   │  ├─ OrderList.vue      # cola, edición en línea, importe y check de pagado
   │  ├─ SlotMachine.vue    # tragaperras del sorteo, con las papeletas a la vista
   │  ├─ HistoryPanel.vue   # modo histórico: días, por persona, a quién le toca
   │  ├─ PriceList.vue      # editor del catálogo de precios
   │  └─ ThemePicker.vue    # selector de color de fondo
   └─ composables/
      ├─ useOrders.js       # lista del día + dinero + deuda (REST + WebSocket)
      ├─ useDraw.js         # sorteo compartido y papeletas
      ├─ useHistory.js      # modo histórico (carga perezosa)
      ├─ useClassics.js     # catálogo de clásicos y sus precios
      ├─ usePersonEmoji.js  # emoji determinista por nombre
      └─ useTheme.js        # tema/color persistente por navegador
```

### Datos

- Todo se guarda en **`server/bocatones.db`** (SQLite). Está en `.gitignore`.
- Tres tablas:
  - `classics` — catálogo de rellenos con su precio (`price_whole`, `price_half`).
  - `orders` — pedidos, con `day`, `size` (`whole`/`half`), `price` y `paid`.
  - `draws` — quién recogió cada día (`day` es la clave: resortear reemplaza).
  - `unavailable` — quién no podía ir cada día (clave `day` + `person`).
- **El dinero va siempre en céntimos** (enteros), nunca en decimales.
- El precio del pedido es una **foto del momento**: cambiar el catálogo no altera
  lo que ya está pedido, así que el histórico no se mueve.
- Las migraciones son `ALTER TABLE` idempotentes al arrancar: se puede desplegar
  sobre una base de datos antigua sin tocar nada (los pedidos viejos se quedan a
  precio 0 y sin pagar).
- La primera vez se siembra el catálogo con unos clásicos de ejemplo.
- En el navegador (`localStorage`) solo viven dos cosas personales: el **tema**
  (`bocatones:bg`) y **tu nombre** (`bocatones:me`), para no reescribirlo cada vez.

### Tiempo real, sin sustos

- Cada navegador tiene un `clientId` para **ignorar sus propios cambios** (no se
  auto-notifica ni duplica lo que tú mismo añades o borras).
- Si el WebSocket se cae, reconecta solo (backoff) y hay un **refresco de
  seguridad cada 30 s** que también detecta el cambio de día a medianoche.
- El indicador de la cabecera muestra el estado: **EN DIRECTO / CONECTANDO / RECONECTANDO**.

---

## 🔌 API

Base: `/api` · El día viaja siempre como `YYYY-MM-DD`.

Los importes son **céntimos** (`350` = 3,50 €).

| Método   | Ruta                          | Descripción                              |
| -------- | ----------------------------- | ---------------------------------------- |
| `GET`    | `/api/classics`               | Catálogo con `priceWhole` / `priceHalf`. |
| `POST`   | `/api/classics`               | Añade un clásico `{ name }`.             |
| `PUT`    | `/api/classics/:id`           | Edita `{ name?, priceWhole?, priceHalf? }`. |
| `DELETE` | `/api/classics/:id`           | Borra un clásico.                        |
| `GET`    | `/api/people`                 | Nombres ya usados (para autocompletar).  |
| `GET`    | `/api/orders?day=YYYY-MM-DD`  | Pedidos de ese día.                      |
| `POST`   | `/api/orders`                 | Crea pedido `{ day, person, filling, bread, notes, size, price?, clientId }`. Sin `price` se aplica el del catálogo. |
| `PUT`    | `/api/orders/:id`             | Edición **parcial**: solo se toca lo que llega (incluye `price` y `paid`). |
| `DELETE` | `/api/orders/:id`             | Borra un pedido.                         |
| `DELETE` | `/api/orders?day=YYYY-MM-DD`  | Vacía el día entero.                     |
| `POST`   | `/api/payments/settle`        | Salda lo que debe alguien: `{ person, day? }`. |
| `GET`    | `/api/unavailable?day=`       | Quién no puede ir ese día.                |
| `PUT`    | `/api/unavailable`            | Marca o desmarca `{ day, person, unavailable }`. |
| `GET`    | `/api/draw/odds?day=`         | Papeletas y probabilidad de cada candidato (con `available`). |
| `POST`   | `/api/draw`                   | Sortea `{ day, clientId }` y lo guarda.  |
| `PUT`    | `/api/draws/:day`             | Corrige a mano quién recogió `{ winner }`. |
| `GET`    | `/api/history/days`           | Un resumen por día (`from`, `to`, `limit`). |
| `GET`    | `/api/history/day?day=`       | Detalle: pedidos + quién recogió + totales. |
| `GET`    | `/api/history/people`         | Por persona: gasto, deuda y veces que ha ido. |

Mensajes que salen por el WebSocket (`/ws`):

| Mensaje | Cuándo |
| ------- | ------ |
| `{ type: 'orders', day, orders, by }`                | cualquier cambio en los pedidos de un día |
| `{ type: 'classics', classics }`                     | cambios en el catálogo o al conectar |
| `{ type: 'draw', day, people, odds, winner, … }`     | al sortear; con `announce: true` si es solo para el banner |
| `{ type: 'paid', person, days, by }`                 | alguien ha saldado una cuenta |
| `{ type: 'unavailable', day, people }`               | ha cambiado quién puede ir hoy |

Al conectar, el servidor reenvía el catálogo y los **últimos 7 sorteos** con
`announce: true` (el cliente se queda con el de su día).

---

<div align="center">
<sub>Hecho con pan y código. 🥪</sub>
</div>