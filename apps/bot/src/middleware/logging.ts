// INPUT VALIDATION: All user inputs must be validated with Zod schemas
import { Context, NextFunction } from 'grammy';

export async function loggingMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const start = Date.now();
  const userId = ctx.from?.id;
  const command = ctx.message?.text || ctx.callbackQuery?.data || 'unknown';
  
  console.log(`[${new Date().toISOString()}] User ${userId}: ${command}`);
  
  try {
    await next();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error for user ${userId}:`, error);
    throw error;
  }
  
  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] Completed in ${duration}ms`);
}
