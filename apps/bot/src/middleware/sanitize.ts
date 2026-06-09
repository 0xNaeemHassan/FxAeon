import { Context, NextFunction } from 'grammy';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

export function sanitizeInput(ctx: Context, next: NextFunction): Promise<void> {
  // Check message text for prototype pollution attempts
  const text = ctx.message?.text;
  if (text) {
    for (const key of FORBIDDEN_KEYS) {
      if (text.includes(key)) {
        ctx.reply('❌ Invalid input detected');
        return Promise.resolve();
      }
    }
  }
  return next();
}

export function sanitizeObject(obj: Record<<<>): Record<<<> {
  const sanitized: Record<<<> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`Forbidden key: ${key}`);
    }
    sanitized[key] = value;
  }
  return sanitized;
}
