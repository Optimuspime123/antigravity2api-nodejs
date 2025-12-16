import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import { getDefaultIp } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_DIR = path.join(__dirname, '../../public/images');

// Ensure the image directory exists
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

// MIME type to extension mapping
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/**
 * Remove old images beyond the retention limit
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
 * Save a base64 image locally and return its URL
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
  
  // Return accessible URL
  const baseUrl = config.imageBaseUrl || `http://${getDefaultIp()}:${config.server.port}`;
  return `${baseUrl}/images/${filename}`;
}
