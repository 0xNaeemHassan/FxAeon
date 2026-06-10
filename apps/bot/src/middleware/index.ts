import express, { NextFunction, Request, Response } from "express";
import { rateLimiter } from "./rate-limiter";
import { logger } from "./logger";
import helmet from "helmet";
import cors from "cors";

export function applySecurityMiddleware(app: express.Application) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.privy.io", "https://*.alchemy.com"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));

  app.use(cors({
    origin: process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Privy-Signature"],
    credentials: true,
    maxAge: 86400,
  }));

  app.use(rateLimiter);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info({
        method: req.method, path: req.path, status: res.statusCode,
        duration: Date.now() - start, ip: req.ip,
      }, "Request completed");
    });
    next();
  });
}

export function errorHandler(err: Error & { status?: number; code?: string }, req: Request, res: Response, _next: NextFunction) {
  logger.error({ error: err.message, stack: err.stack, path: req.path }, "Unhandled error");
  const isDev = process.env.NODE_ENV === "development";
  res.status(err.status || 500).json({
    error: { message: isDev ? err.message : "Internal server error", code: err.code || "INTERNAL_ERROR" },
  });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
