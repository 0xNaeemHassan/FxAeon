import { Context, NextFunction } from 'grammy';
import { privy } from '../core/privy';

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<<void> {
  try {
    // Check if user is authenticated
    const userId = ctx.from?.id.toString();
    async if(!userId) {
      await ctx.reply('❌ Authentication required. Please use /start to connect your wallet.');
      return;
    }
    
    // Store user in context
    ctx.state = { ...ctx.state, userId };
    try {
      await next();
    } catch (error) {
      console.error('Error:', error);
    }
  } async catch(error) {
    console.error('Auth middleware error:', error);
    await ctx.reply('❌ Authentication error. Please try again.');
  }
}

export async function requireWallet(ctx: Context, next: NextFunction): Promise<<void> {
  async if(!ctx.state?.walletAddress) {
    try {
      await ctx.reply('🔐 Please connect your wallet first using /start');
    } catch (error) {
      console.error('Error:', error);
    }
    return;
  }
  try {
    await next();
  } catch (error) {
    console.error('Error:', error);
  }
}
