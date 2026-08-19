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
- 💳 **Quién puso el dinero** — la deuda tiene **acreedor**: baja uno al bar, paga
  los cuarenta euros de todos y luego le devuelven. Por defecto paga **quien
  recoge**, se corrige a mano, y el panel lo dice con nombre y apellidos:
  *«debes 3,50 € a Alba»*, *«te debe 4,50 € Marta · ✓ cobrado»*. Los bocatas del
  que pone el dinero quedan pagados solos (no se debe nada a sí mismo) y, si él
  los desmarca, no se le vuelven a marcar. Lo que no se sabe a quién devolver se
  cuenta aparte, no se esconde.
- 🔁 **Lo de siempre** — tres chips con los bocatas que más repite cada uno,
  sacados de su propio histórico. Un clic rellena el pedido con el precio del
  catálogo de hoy.
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
- ↩️ **Todo se puede deshacer** — tanto una baja como el `rm -rf *` que vacía el
  día: la cola desaparece al instante y el borrado no sale hacia el servidor
  hasta que expira el plazo. Los diálogos son de la casa, no del navegador.
- 🎨 **Tema a tu gusto** — elige el color de fondo (8 presets o color libre); se
  guarda en tu navegador y no afecta a los demás. La paleta se recalcula sola
  para seguir siendo legible.
- 📅 **Fecha de hoy** — la lista se organiza por día; cada jornada empieza limpia
  y la anterior se queda guardada en el histórico.
- 📲 **Instalable en el móvil** — es una PWA: icono en la pantalla de inicio,
  ventana sin barra del navegador y arranque desde la caché. Sin red **abre
  igual** y lo dice, en vez de mostrar el error del navegador. Necesita HTTPS
  (ver más abajo).

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
#    APP_DIR · APP_PORT · NGINX_PORT · SERVER_IP · ENABLE_TLS · TLS_PORT
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
| `ENABLE_TLS` | `1`              | Añade el bloque HTTPS (0 = solo HTTP).   |
| `TLS_PORT`   | `8443`           | Puerto público HTTPS.                    |
| `CERT_DIR`   | `/etc/nginx/ssl/bocatones` | Dónde vive el certificado.    |

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

### 📲 Para poder instalarla en el móvil: HTTPS

Una PWA solo se instala (y solo registra su service worker) en **contexto
seguro**: HTTPS o `localhost`. Una IP por HTTP **no** vale, así que el script
levanta también un `server` en HTTPS —`https://SERVER_IP:8443`— con un
certificado autofirmado que genera él mismo (con `subjectAltName` de IP, sin el
cual los navegadores modernos ni ofrecen la excepción). **El puerto en claro se
conserva y no se redirige**, para no dejar a nadie fuera de golpe.

> ⚠️ **El certificado autofirmado no basta por sí solo.** Chrome seguirá
> tratando el origen como inseguro —y por tanto **no** registrará el service
> worker ni ofrecerá instalar la app— hasta que ese certificado se instale como
> **CA de confianza en cada dispositivo**:
>
> - **Android:** Ajustes → Seguridad → Cifrado y credenciales → Instalar un
>   certificado → Certificado de CA, y elige el `.crt` copiado del servidor.
> - **iOS:** abre el `.crt` para instalar el perfil y actívalo en Ajustes →
>   General → Información → Ajustes de confianza de certificados.
>
> Sin ese paso la app funciona igual que siempre por HTTP: simplemente no se
> instala ni guarda nada en caché. Y si algún día tenéis un nombre de host con
> certificado de confianza de la empresa, basta apuntar `CERT_FILE`/`KEY_FILE`
> a ese certificado: el bloque de nginx ya está puesto.

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
**PWA:** manifest + service worker escritos a mano, sin workbox ni plugins: los
assets ya salen del build con hash, así que la estrategia cabe en un fichero.

```
bocatones/
├─ index.html               # carga fuentes, favicon y manifest
├─ vite.config.js           # proxy de /api y /ws → :3017
├─ public/
│  ├─ bocata.jpg            # origen de los iconos
│  ├─ icon-192.png · icon-512.png · icon-maskable-512.png
│  ├─ manifest.webmanifest  # nombre, colores e iconos de la PWA
│  ├─ sw.js                 # service worker: shell en caché, /api nunca
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
   │  ├─ MoneyValue.vue     # importe que cuenta hasta su valor nuevo
   │  ├─ Notices.vue        # avisos: errores, confirmaciones y deshacer
   │  ├─ ConfirmDialog.vue  # el diálogo de la casa (adiós window.confirm)
   │  └─ ThemePicker.vue    # selector de color de fondo
   └─ composables/
      ├─ useOrders.js       # lista del día + dinero + deuda con acreedor
      ├─ usePayer.js        # quién puso el dinero hoy (sigue al sorteo)
      ├─ useConfirm.js      # preguntas antes de actuar, con foco y Escape
      ├─ useDraw.js         # sorteo compartido y papeletas
      ├─ useHistory.js      # modo histórico (carga perezosa)
      ├─ useClassics.js     # catálogo de clásicos y sus precios
      ├─ useNotices.js      # canal de avisos del sistema
      ├─ useModal.js        # foco, focus trap y Escape de los diálogos
      ├─ useMe.js           # quién eres tú, para distinguir lo tuyo
      ├─ useCountUp.js      # interpolación de los importes
      ├─ useReveal.js       # directiva v-reveal (entrar en pantalla)
      ├─ useSettle.js       # confirmación de saldar, compartida
      ├─ usePersonEmoji.js  # emoji determinista por nombre
      └─ useTheme.js        # tema/color persistente por navegador
```

### Datos

- Todo se guarda en **`server/bocatones.db`** (SQLite). Está en `.gitignore`.
- Cinco tablas:
  - `classics` — catálogo de rellenos con su precio (`price_whole`, `price_half`).
  - `orders` — pedidos, con `day`, `size` (`whole`/`half`), `price` y `paid`.
  - `draws` — quién recogió cada día (`day` es la clave: resortear reemplaza).
  - `unavailable` — quién no podía ir cada día (clave `day` + `person`).
  - `payers` — quién puso el dinero cada día. **Solo guarda las correcciones a
    mano**: si un día no está en esta tabla, paga quien recogió (`draws.winner`),
    así que el histórico entero ya tiene acreedor sin migrar ni una fila, y
    borrar la fila es volver a seguir al sorteo.
- **El dinero va siempre en céntimos** (enteros), nunca en decimales.
- `orders.paid_auto` distingue quién marcó un pago, en tres estados: `0` a mano,
  `1` lo marcó solo el pagador del día, `2` su dueño lo **desmarcó** a mano. El
  `2` es el que garantiza que ni un resorteo ni un cambio de pagador vuelvan a
  pisar la decisión de una persona.
- El precio del pedido es una **foto del momento**: cambiar el catálogo no altera
  lo que ya está pedido, así que el histórico no se mueve.
- Las migraciones son `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE` idempotentes
  al arrancar: se puede desplegar sobre una base de datos antigua sin tocar nada
  (los pedidos viejos se quedan a precio 0 y sin pagar).
- La primera vez se siembra el catálogo con unos clásicos de ejemplo.
- En el navegador (`localStorage`) solo viven dos cosas personales: el **tema**
  (`bocatones:bg`) y **tu nombre** (`bocatones:me`), para no reescribirlo cada vez.

### Interfaz: las reglas de la casa

- **El color solo vive en el movimiento y en los estados** (`src/assets/base.css`). El
  esqueleto es monocromo; la paleta *glitch* de 8 colores está reservada a
  animaciones y a significados concretos: verde pagado, naranja deuda, azul
  nuevo, magenta destructivo, amarillo esperando.
- **Todo pasa por tokens**: la tipografía tiene 7 pasos (`--fs-1` … `--fs-7`), el
  espaciado 6 (`--sp-1` … `--sp-6`), y hay tokens de radio, sombra y z-index. Si
  necesitas un tamaño que no está, es más probable que sobre el tamaño que que
  falte el token.
- **Las sombras y los halos se derivan del tema**, no son absolutos
  (`--shadow-*`, `--glow-*`, `--sink`). Por eso los 8 presets funcionan, incluido
  el claro: `useTheme.js` recalcula la paleta y garantiza **4.5:1 de contraste**
  en todos ellos con un solucionador de contraste, en vez de confiar en
  coeficientes fijos.
- **Nada se anima con propiedades que provoquen reflow.** Las barras usan
  `transform: scaleX()`, no `width`; los barridos usan `translateX`, no
  `background-position`. Y todo respeta `prefers-reduced-motion`.
- **Ninguna mutación falla en silencio.** Todas avisan por `useNotices.js`, y
  ni borrar un pedido ni vaciar el día mandan el DELETE hasta que expira el plazo
  de *deshacer* (5 s para una baja, 8 s para el día entero).
- **Ni un diálogo del navegador.** Las preguntas las pinta `ConfirmDialog.vue`
  con el mismo contrato que los demás modales (`useModal.js`: foco, focus trap,
  Escape y foco devuelto al botón que lo abrió). Donde había un `window.confirm`
  hay ahora o un diálogo de la casa o, mejor, un *deshacer*.
- **Lo automático no pisa a una persona.** El pagador del día marca sus propios
  bocatas como pagados, pero si él los desmarca no vuelven a marcarse solos
  (`orders.paid_auto = 2`).

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
| `GET`    | `/api/orders/usual?person=`   | Lo que más repite esa persona (`limit`, 3 por defecto): `{ filling, bread, notes, size, times }`. Sin precio a propósito: vale el del catálogo de hoy. |
| `POST`   | `/api/orders`                 | Crea pedido `{ day, person, filling, bread, notes, size, price?, clientId }`. Sin `price` se aplica el del catálogo. |
| `PUT`    | `/api/orders/:id`             | Edición **parcial**: solo se toca lo que llega (incluye `price` y `paid`). |
| `DELETE` | `/api/orders/:id`             | Borra un pedido.                         |
| `DELETE` | `/api/orders?day=YYYY-MM-DD`  | Vacía el día entero.                     |
| `POST`   | `/api/payments/settle`        | Salda lo que debe alguien: `{ person, day?, creditor? }`. Con `creditor` salda **solo** los días que puso ese acreedor. |
| `GET`    | `/api/debts`                  | Deuda con acreedor (`from`, `to`): `rows` con `kind` (`pair`/`self`/`orphan`/`anon`), `byPerson` (el total de cada deudor) y `totals`. |
| `GET`    | `/api/payers?day=`            | Quién puso el dinero: `{ payer, source: 'manual'\|'draw'\|null, settled, auto }`. |
| `PUT`    | `/api/payers`                 | Fija a mano `{ day, person }`. **`person` vacío no es un error**: suelta la corrección y vuelve a pagar quien recoja. |
| `GET`    | `/api/unavailable?day=`       | Quién no puede ir ese día.                |
| `PUT`    | `/api/unavailable`            | Marca o desmarca `{ day, person, unavailable }`. |
| `GET`    | `/api/draw/odds?day=`         | Papeletas y probabilidad de cada candidato (con `available`). |
| `POST`   | `/api/draw`                   | Sortea `{ day, clientId }` y lo guarda.  |
| `PUT`    | `/api/draws/:day`             | Corrige a mano quién recogió `{ winner }`. |
| `GET`    | `/api/history/days`           | Un resumen por día (`from`, `to`, `limit`), con `winner` y `payer`. |
| `GET`    | `/api/history/day?day=`       | Detalle: pedidos + quién recogió + quién pagó + totales. |
| `GET`    | `/api/history/people`         | Por persona: gasto, deuda y veces que ha ido. |

Mensajes que salen por el WebSocket (`/ws`):

| Mensaje | Cuándo |
| ------- | ------ |
| `{ type: 'orders', day, orders, by }`                | cualquier cambio en los pedidos de un día |
| `{ type: 'classics', classics }`                     | cambios en el catálogo o al conectar |
| `{ type: 'draw', day, people, odds, winner, payer, … }` | al sortear; con `announce: true` si es solo para el banner. Lleva el pagador dentro: un ganador nuevo es el acreedor nuevo |
| `{ type: 'paid', person, days, creditor, by }`        | alguien ha saldado una cuenta |
| `{ type: 'payer', day, payer, source, settled, auto }` | ha cambiado quién puso el dinero ese día |
| `{ type: 'unavailable', day, people }`               | ha cambiado quién puede ir hoy |

Al conectar, el servidor reenvía el catálogo y los **últimos 7 sorteos** con
`announce: true` (el cliente se queda con el de su día), más los **pagadores
fijados a mano** de esos días (los que salen del sorteo ya viajan dentro del
propio mensaje `draw`).

---

<div align="center">

<img src="public/rm-technology-128.png" width="56" height="56" alt="Logotipo de RM Technology" />

<sub>Hecho con pan y código por <b>RM Technology</b>. 🥪</sub>

</div>