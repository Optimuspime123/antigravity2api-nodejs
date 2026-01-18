import fs from 'fs';

/**
 * Parse a .env file into an object.
 * Supports multiline strings wrapped in double or single quotes.
 */
export function parseEnvFile(filePath) {
  const envData = {};
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  let currentKey = null;
  let currentValue = '';
  let inMultiline = false;
  let quoteChar = null;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    if (inMultiline) {
      // Keep collecting multiline values
      currentValue += '\n' + line;
      // Check if the multiline value ends (closing quote)
      if (line.trimEnd().endsWith(quoteChar)) {
        // Remove the trailing quote
        currentValue = currentValue.slice(0, -1);
        envData[currentKey] = currentValue;
        inMultiline = false;
        currentKey = null;
        currentValue = '';
        quoteChar = null;
      }
    } else {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;
      
      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1);
      
      // Check for a quoted multiline string
      const trimmedValue = value.trimStart();
      if ((trimmedValue.startsWith('"') || trimmedValue.startsWith("'")) &&
          !trimmedValue.endsWith(trimmedValue[0])) {
        // Multiline string begins
        quoteChar = trimmedValue[0];
        currentKey = key;
        currentValue = trimmedValue.slice(1); // Remove the opening quote
        inMultiline = true;
      } else {
        // Single-line value: remove wrapping quotes if present
        value = value.trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        envData[key] = value;
      }
    }
  }
  
  // Handle an unterminated multiline string
  if (inMultiline && currentKey) {
    envData[currentKey] = currentValue;
  }
  
  return envData;
}

/**
 * Update key/value pairs in a .env file.
 * Supports multiline strings (automatically wraps with double quotes).
 */
export function updateEnvFile(filePath, updates) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  Object.entries(updates).forEach(([key, value]) => {
    // Wrap values containing newlines in double quotes
    let formattedValue = value;
    if (typeof value === 'string' && value.includes('\n')) {
      // Multiline string: wrap in double quotes
      formattedValue = `"${value}"`;
    }
    
    // Match the entire key/value pair (including multiline values)
    // 1. Try single-line format first
    const singleLineRegex = new RegExp(`^${key}=.*$`, 'm');
    // 2. Then try multiline format (quoted, possibly spanning multiple lines)
    const multiLineRegex = new RegExp(`^${key}=["']([\\s\\S]*?)["']$`, 'm');
    
    if (multiLineRegex.test(content)) {
      // Replace multiline format
      content = content.replace(multiLineRegex, `${key}=${formattedValue}`);
    } else if (singleLineRegex.test(content)) {
      // Replace single-line format
      content = content.replace(singleLineRegex, `${key}=${formattedValue}`);
    } else {
      // Key not found: append to end of file
      content += `\n${key}=${formattedValue}`;
    }
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
}
