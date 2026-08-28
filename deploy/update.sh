#!/usr/bin/env bash
#
# Actualizar Bocatones en producción.
#
# Lo que hace el instalador (deploy/install.sh) es montar la máquina: pm2,
# nginx, certificado. Esto es lo de todos los días: bajar, compilar, reiniciar
# y COMPROBAR que ha entrado.
#
#   sudo bash deploy/update.sh
#
# Los navegadores que tengan la app abierta se enteran solos: el build sella
# dist/version.json con el commit, el servidor lo anuncia al reconectar el
# WebSocket y al compañero le sale un aviso con botón de recargar. La caché
# vieja del service worker la barre el propio despliegue, porque el nombre de
# la caché lleva el mismo sello (public/sw.js).

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/Bocatones}
APP_PORT=${APP_PORT:-3017}

cd "$APP_DIR"

echo "Bajando cambios..."
# --ff-only: si alguien ha tocado algo en el servidor, que falle aquí y se vea,
# en vez de abrir un merge a medias en mitad del despliegue
git pull --ff-only

echo "Instalando dependencias..."
# ci y no install: instala EXACTAMENTE lo del package-lock. `npm install` puede
# mover una versión menor en silencio y dejar producción distinta del portátil
npm ci

echo "Compilando frontend..."
# vite vacía dist/ por su cuenta, y de paso sella sw.js y escribe version.json
npm run build

echo "Reiniciando servicio..."
pm2 restart bocatones

echo "Comprobando que ha entrado..."
# que el proceso viva no basta: preguntamos qué versión sirve. Hasta 10 s,
# porque pm2 devuelve el control antes de que Express escuche
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/version"; then
    echo
    break
  fi
  sleep 0.5
done

echo
echo "✅ Bocatones actualizado — a quien tenga la app abierta le saldrá el aviso de versión nueva"
pm2 status bocatones
