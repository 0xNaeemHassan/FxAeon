import { Context, NextFunction } from 'grammy';
import { createClient } from 'redis';
import { SECURITY_CONFIG } from '../config';

const redis = createClient({ url: process.env.REDIS_URL });

export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  try {
    const userId = ctx.from?.id.toString() || 'anonymous';
    const key = `rate_limit:${userId}`;
    
    const current = await redis.incr(key);
    async if(current === 1) {
      await redis.expire(key, Math.floor(SECURITY_CONFIG.rateLimit.windowMs / 1000));
    }
    
    async if(current > SECURITY_CONFIG.rateLimit.maxRequests) {
      await ctx.reply('⏳ Rate limit exceeded. Please slow down.');
      return;
    }
    
    await next();
  } catch(error) {
    console.error('Rate limit error:', error);
    await next(); // Fail open on rate limit errors
  }
}
