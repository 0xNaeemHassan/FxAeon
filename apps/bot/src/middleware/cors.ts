import { Request, Response, NextFunction } from 'express';

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'https://t.me',
  'https://fxbot-mini-app.pages.dev',
];

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  
  next();
}
