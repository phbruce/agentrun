#!/bin/bash
# Keeps cloudflared tunnel alive and restarts on crash
# Usage: ./tunnel.sh

PORT=${PORT:-3001}

while true; do
    echo "[tunnel] Starting cloudflared → localhost:$PORT ..."
    cloudflared tunnel --url http://localhost:$PORT --no-autoupdate 2>&1 | tee /tmp/cloudflared.log &
    PID=$!

    # Wait for URL to appear
    for i in {1..15}; do
        URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | head -1)
        if [ -n "$URL" ]; then
            echo ""
            echo "============================================="
            echo "  TUNNEL URL: $URL/gchat"
            echo "  Atualiza no Cloud Console e manda mensagem"
            echo "============================================="
            echo ""
            break
        fi
        sleep 1
    done

    # Wait for process to die
    wait $PID
    echo "[tunnel] Crashed. Restarting in 3s..."
    sleep 3
done
