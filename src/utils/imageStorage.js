import fs from 'fs';
import path from 'path';
import config from '../config/config.js';
import { getDefaultIp } from './utils.js';
import { getImageDir, isPkg } from './paths.js';
import { MIME_TO_EXT } from '../constants/index.js';

const IMAGE_DIR = getImageDir();

// Ensure the image directory exists (development environment)
if (!isPkg && !fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Remove old images beyond the retention limit.
 * @param {number} maxCount - Maximum number of images to keep
 */
function cleanOldImages(maxCount = 10) {
  const files = fs.readdirSync(IMAGE_DIR)
    .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
    .map(f => ({
      name: f,
      path: path.join(IMAGE_DIR, f),
      mtime: fs.statSync(path.join(IMAGE_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length > maxCount) {
    files.slice(maxCount).forEach(f => fs.unlinkSync(f.path));
  }
}

/**
 * Save a base64 image locally and return its URL.
 * @param {string} base64Data - Base64-encoded image data
 * @param {string} mimeType - Image MIME type
 * @returns {string} Image URL
 */
export function saveBase64Image(base64Data, mimeType) {
  const ext = MIME_TO_EXT[mimeType] || 'jpg';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const filepath = path.join(IMAGE_DIR, filename);
  
  // Decode and save
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filepath, buffer);
  
  // Clean up old images
  cleanOldImages(config.maxImages);
  
  // Return URL
  const baseUrl = config.imageBaseUrl || `http://${getDefaultIp()}:${config.server.port}`;
  return `${baseUrl}/images/${filename}`;
}
