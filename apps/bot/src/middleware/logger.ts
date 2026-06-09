import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  base: { service: "fxbot", version: process.env.npm_package_version || "1.0.0" },
  redact: {
    paths: ["*.privateKey", "*.apiKey", "*.secret", "*.token", "*.password", "*.authorization", "headers.authorization", "body.telegramInitData", "body.privateKey"],
    remove: true,
  },
});

export const botLogger = logger.child({ component: "bot" });
export const privyLogger = logger.child({ component: "privy" });
export const fxLogger = logger.child({ component: "fx-sdk" });
export const ruleLogger = logger.child({ component: "rules" });
export const notifLogger = logger.child({ component: "notifications" });
export const aiLogger = logger.child({ component: "ai" });
