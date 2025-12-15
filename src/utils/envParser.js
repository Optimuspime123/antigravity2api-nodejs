import fs from 'fs';

/**
 * Parse a .env file into an object.
 */
export function parseEnvFile(filePath) {
  const envData = {};
  const content = fs.readFileSync(filePath, 'utf8');
  
  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key) {
        envData[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  
  return envData;
}

/**
 * Update key-value pairs inside a .env file.
 */
export function updateEnvFile(filePath, updates) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  Object.entries(updates).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
}
