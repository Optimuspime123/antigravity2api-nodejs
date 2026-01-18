#!/bin/bash

set -e

echo "========================================"
echo "Antigravity2API One-Click Setup Script"
echo "========================================"
echo

echo "[1/6] Cloning project..."
if [ -d "antigravity2api-nodejs" ]; then
    echo "A folder with the same name already exists in the current directory. Exiting."
    exit 1
fi

if ! git clone https://github.com/liuw1535/antigravity2api-nodejs.git; then
    echo "Clone failed. Please check your network or whether Git is installed."
    exit 1
fi

echo
echo "[2/6] Entering project directory..."
cd antigravity2api-nodejs

echo
echo "[3/6] Installing dependencies..."
if ! npm install; then
    echo "Dependency installation failed"
    exit 1
fi

echo
echo "[4/6] Copying configuration files..."
cp .env.example .env
cp config.json.example config.json

echo
echo "[5/6] Configuring administrator credentials..."
read -p "Enter admin username (default: admin): " ADMIN_USER
read -p "Enter admin password (default: admin123): " ADMIN_PASS
read -p "Enter API key (default: sk-text): " API_KEY

ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASS=${ADMIN_PASS:-admin123}
API_KEY=${API_KEY:-sk-text}

cat > .env <<EOF_ENV
API_KEY=${API_KEY}
ADMIN_USERNAME=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASS}
JWT_SECRET=$(openssl rand -hex 32)
EOF_ENV

echo

echo "Setup completed! Starting the service..."

echo "Available services:"
echo "1. Admin UI: http://127.0.0.1:8045"
echo "   - Username: ${ADMIN_USER}"
echo "   - Password: ${ADMIN_PASS}"
echo "   - Log in first to configure Antigravity or Gemini CLI credentials"
echo "2. Antigravity API endpoints:"
echo "   - OpenAI format: http://127.0.0.1:8045/v1"
echo "   - Gemini format: http://127.0.0.1:8045/v1beta"
echo "   - Claude format: http://127.0.0.1:8045/v1"
echo "3. Gemini CLI API endpoints:"
echo "   - OpenAI format: http://127.0.0.1:8045/cli/v1"
echo "   - Gemini format: http://127.0.0.1:8045/cli/v1beta"

echo
echo "[6/6] Starting service..."
npm start
