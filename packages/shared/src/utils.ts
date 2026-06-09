export function safeJSONStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

export function safeJSONParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function safeEquals(a: number, b: number, epsilon = 0.0001): boolean {
  return Math.abs(a - b) < epsilon;
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function sanitizeKey(key: string): string {
  // Prevent prototype pollution
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new Error('Invalid key: prototype pollution attempt');
  }
  return key;
}
