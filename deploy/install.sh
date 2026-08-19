#!/bin/bash
#
# Instalación de Bocatones en producción (PM2 + nginx).
#
# Requisitos previos en el servidor:
#   - Node >= 22.12 y npm
#   - nginx instalado
#   - el repo clonado en $APP_DIR (ver más abajo)
#
# Edita las variables siguientes y ejecútalo como root:
#   sudo bash deploy/install.sh
#
set -e

APP_DIR=/opt/Bocatones      # dónde está clonado el proyecto
APP_PORT=3017               # puerto interno del servidor Node
NGINX_PORT=8080             # puerto público que sirve nginx (HTTP, en claro)
SERVER_IP=172.16.6.26       # IP o dominio del servidor

# HTTPS: hace falta para que la app se pueda INSTALAR en el móvil (una PWA
# necesita "contexto seguro": HTTPS o localhost, nunca una IP por HTTP).
#
# Con un certificado autofirmado el navegador seguirá avisando, y Chrome NO
# registrará el service worker, HASTA que el certificado se instale como CA de
# confianza en cada dispositivo (ver README). Si mañana tienes un nombre de host
# con certificado de la empresa, basta apuntar CERT_FILE/KEY_FILE ahí.
ENABLE_TLS=1                            # 0 = dejarlo solo en HTTP
TLS_PORT=8443                           # puerto público HTTPS
CERT_DIR=/etc/nginx/ssl/bocatones       # dónde vive el certificado
CERT_FILE="$CERT_DIR/bocatones.crt"
KEY_FILE="$CERT_DIR/bocatones.key"

echo "==================================================="
echo "  Instalando Bocatones en producción"
echo "==================================================="

# 1. Instalar PM2 globalmente
echo ""
echo "[1/7] Instalando PM2..."
npm install -g pm2

# 2. Instalar dependencias (incluyendo devDeps para el build)
echo ""
echo "[2/7] Instalando dependencias npm..."
cd "$APP_DIR"
npm install

# 3. Compilar el frontend con Vite
echo ""
echo "[3/7] Compilando frontend..."
npm run build

# 4. Crear fichero de ecosistema PM2
echo ""
echo "[4/7] Creando configuración PM2..."
cat > "$APP_DIR/ecosystem.config.cjs" << 'ECOSYSTEM'
module.exports = {
  apps: [{
    name: 'bocatones',
    script: 'server/index.js',
    cwd: '/opt/Bocatones',
    node_args: '--experimental-sqlite',
    env: {
      NODE_ENV: 'production',
      PORT: 3017
    },
    restart_delay: 3000,
    max_restarts: 10,
    watch: false,
    instances: 1,
    exec_mode: 'fork',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    out_file: '/var/log/bocatones/app.log',
    error_file: '/var/log/bocatones/error.log'
  }]
}
ECOSYSTEM

# 5. Crear directorio de logs
mkdir -p /var/log/bocatones

# 6. Arrancar con PM2 (parar si ya estaba corriendo)
echo ""
echo "[5/7] Arrancando aplicación con PM2..."
pm2 delete bocatones 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save

# 7. Configurar arranque automático con systemd
echo ""
echo "[6/7] Configurando inicio automático en systemd..."
pm2 startup systemd -u root --hp /root
systemctl enable pm2-root 2>/dev/null || true

# 8. Certificado autofirmado (solo si no existe: es idempotente)
TLS_SERVER=""
if [ "$ENABLE_TLS" = "1" ]; then
  echo ""
  echo "[7/8] Preparando certificado HTTPS..."
  mkdir -p "$CERT_DIR"
  if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "  ya existe uno en $CERT_DIR, se reutiliza"
  else
    # el subjectAltName es imprescindible: sin él, un navegador moderno ni
    # siquiera ofrece la excepción para un certificado emitido a una IP
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -subj "/CN=${SERVER_IP}" -addext "subjectAltName=IP:${SERVER_IP}" \
      -keyout "$KEY_FILE" -out "$CERT_FILE"
    chmod 600 "$KEY_FILE"
    echo "  certificado autofirmado creado para ${SERVER_IP}"
  fi
  # mismo par de location que en claro; el WebSocket va por wss:// solo
  TLS_SERVER=$(cat << TLSBLOCK

server {
    listen ${TLS_PORT} ssl;
    http2 on;
    server_name ${SERVER_IP};

    ssl_certificate     ${CERT_FILE};
    ssl_certificate_key ${KEY_FILE};
    ssl_protocols       TLSv1.2 TLSv1.3;

    access_log /var/log/nginx/bocatones-ssl-access.log;
    error_log  /var/log/nginx/bocatones-ssl-error.log;

    location /ws {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout    60s;
    }
}
TLSBLOCK
)
fi

# 9. Configurar nginx
echo ""
echo "[8/8] Configurando nginx en puerto $NGINX_PORT..."
# el server en claro se conserva a propósito y NO se redirige: nadie se queda
# fuera de golpe por el aviso del certificado
cat > /etc/nginx/sites-available/bocatones << NGINX
server {
    listen ${NGINX_PORT};
    server_name ${SERVER_IP};

    access_log /var/log/nginx/bocatones-access.log;
    error_log  /var/log/nginx/bocatones-error.log;

    # WebSocket (debe ir antes del location /)
    location /ws {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout    60s;
    }
}
${TLS_SERVER}
NGINX

ln -sf /etc/nginx/sites-available/bocatones /etc/nginx/sites-enabled/bocatones

echo ""
echo "Verificando configuración de nginx..."
nginx -t

echo "Recargando nginx..."
systemctl reload nginx

echo ""
echo "==================================================="
echo "  ✅  Bocatones instalado correctamente"
echo "==================================================="
echo ""
echo "  URL:    http://${SERVER_IP}:${NGINX_PORT}"
if [ "$ENABLE_TLS" = "1" ]; then
echo "  HTTPS:  https://${SERVER_IP}:${TLS_PORT}   <- entra por aquí para poder INSTALARLA"
echo "          (certificado autofirmado: instálalo como CA de confianza en el"
echo "           móvil o Chrome no registrará el service worker — ver README)"
fi
echo "  API:    http://127.0.0.1:${APP_PORT}/api"
echo "  Logs:   pm2 logs bocatones"
echo "  Estado: pm2 status"
echo ""