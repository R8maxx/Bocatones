#!/bin/bash
#
# Instalación de Bocatones en producción (PM2 + nginx).
#
# Requisitos previos en el servidor:
#   - Node >= 22.12 y npm
#   - nginx instalado
#   - el repo clonado en $APP_DIR (ver más abajo)
#
# Edita las 4 variables siguientes y ejecútalo como root:
#   sudo bash deploy/install.sh
#
set -e

APP_DIR=/opt/Bocatones      # dónde está clonado el proyecto
APP_PORT=3017               # puerto interno del servidor Node
NGINX_PORT=8080             # puerto público que sirve nginx
SERVER_IP=172.16.6.26       # IP o dominio del servidor

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

# 8. Configurar nginx
echo ""
echo "[7/7] Configurando nginx en puerto $NGINX_PORT..."
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
echo "  API:    http://127.0.0.1:${APP_PORT}/api"
echo "  Logs:   pm2 logs bocatones"
echo "  Estado: pm2 status"
echo ""