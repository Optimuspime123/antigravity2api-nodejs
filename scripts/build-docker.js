#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');
const configFile = path.join(rootDir, 'config.json');
const envExample = path.join(rootDir, '.env.example');
const configExample = path.join(rootDir, 'config.json.example');

console.log('🐳 Starting Docker image build...\n');

// Check and copy .env
if (!fs.existsSync(envFile)) {
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    console.log('✓ Created .env from .env.example');
  } else {
    console.warn('⚠ .env.example not found; default configuration will be used');
  }
} else {
  console.log('✓ .env already exists');
}

// Check and copy config.json
if (!fs.existsSync(configFile)) {
  if (fs.existsSync(configExample)) {
    fs.copyFileSync(configExample, configFile);
    console.log('✓ Created config.json from config.json.example');
  } else {
    console.warn('⚠ config.json.example not found; default configuration will be used');
  }
} else {
  console.log('✓ config.json already exists');
}

// Ensure required directories exist (prevents Docker from creating folders on mount)
const dataDir = path.join(rootDir, 'data');
const imagesDir = path.join(rootDir, 'public', 'images');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✓ Created data directory');
}

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
  console.log('✓ Created public/images directory');
}

// Build image
console.log('\n📦 Building image...\n');
try {
  execSync('docker compose build', { 
    cwd: rootDir, 
    stdio: 'inherit' 
  });
  console.log('\n✅ Image built successfully!');
  console.log('\nRun the following command to start the service:');
  console.log('  docker compose up -d');
} catch (error) {
  console.error('\n❌ Build failed');
  process.exit(1);
}
