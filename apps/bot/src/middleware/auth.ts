import { Context, NextFunction } from 'grammy';
import { privy } from '../core/privy.js';

// Extend Context type to include state
interface AuthState {
  userId?: string;
  walletAddress?: string;
}

// Use session or a WeakMap to store per-context state
const contextState = new WeakMap<Context, AuthState>();

export function getState(ctx: Context): AuthState {
  return contextState.get(ctx) || {};
}

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  try {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      await ctx.reply('❌ Authentication required. Please use /start to connect your wallet.');
      return;
    }

    // Store user context state
    contextState.set(ctx, { ...getState(ctx), userId });
    try {
      await next();
    } catch (error) {
      console.error('Error:', error);
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    await ctx.reply('❌ Authentication error. Please try again.');
  }
}

export async function requireWallet(ctx: Context, next: NextFunction): Promise<void> {
  const state = getState(ctx);
  if (!state?.walletAddress) {
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
