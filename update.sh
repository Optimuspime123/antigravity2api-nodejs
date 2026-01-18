#!/bin/bash

set -e

echo "========================================"
echo "Antigravity2API Update Script"
echo "========================================"
echo

echo "[1/3] Saving local changes..."
git stash push -m "Auto stash before update" >/dev/null

echo
echo "[2/3] Pulling latest code..."
git pull

echo
echo "[3/3] Installing dependencies..."
npm install

echo

echo "Update completed!"
echo "To restore local changes:"
echo "  git stash pop"
echo "To drop local changes:"
echo "  git stash drop"
