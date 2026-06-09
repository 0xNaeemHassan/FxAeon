
// FLOATING POINT SAFETY: Use epsilon comparisons
const EPSILON = 0.0001;
function safeEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}
import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from './config';
import { setupCommands } from './commands';
import { setupMiddleware } from './middleware';
import { setupNotifications } from './core/notifications';
import { errorHandler } from './middleware/errorHandler';

// Security configuration
const SECURITY_CONFIG = {
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
  },
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://t.me'],
    methods: ['GET', 'POST'],
  },
  headers: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  },
};

async function main() {
  if (process.env.NODE_ENV !== "production") console.log('🤖 Starting fxBot v1.1.0...');
  
  const bot = new Bot(config.BOT_TOKEN);
  
  // Setup middleware with rate limiting and security
  setupMiddleware(bot);
  
  // Setup commands
  setupCommands(bot);
  
  // Setup notifications
  setupNotifications(bot);
  
  // Comprehensive error handling
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error('Error in request:', e.description);
    } else if (e instanceof HttpError) {
      console.error('Could not contact Telegram:', e);
    } else {
      console.error('Unknown error:', e);
    }
    errorHandler(e as Error, ctx);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    if (process.env.NODE_ENV !== "production") console.log('SIGTERM received, stopping bot gracefully...');
    await bot.stop();
    gracefulShutdown();
  });
  
  process.on('SIGINT', async () => {
    if (process.env.NODE_ENV !== "production") console.log('SIGINT received, stopping bot gracefully...');
    await bot.stop();
    gracefulShutdown();
  });
  
  // Start bot
  await bot.start({
    onStart: (botInfo) => {
      if (process.env.NODE_ENV !== "production") console.log(`✅ fxBot v1.1.0 started as @${botInfo.username}`);
      if (process.env.NODE_ENV !== "production") console.log(`🔒 Security config: rate limiting ${SECURITY_CONFIG.rateLimit.maxRequests}req/${SECURITY_CONFIG.rateLimit.windowMs}ms`);
    },
  });
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  gracefulShutdown(1);
});

// CLEANUP: process.off('SIGTERM', sigtermHandler); process.off('SIGINT', sigintHandler);
