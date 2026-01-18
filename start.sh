#!/bin/bash

set -e

echo "========================================"
echo "Antigravity2API Start Script"
echo "========================================"
echo

echo "[1/2] Installing dependencies..."
npm install

echo
echo "[2/2] Starting service..."
npm start
