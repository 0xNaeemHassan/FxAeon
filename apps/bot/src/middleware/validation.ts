import { Context, NextFunction } from 'grammy';
import { z } from 'zod';

// Comprehensive input validation schemas
export const messageSchema = z.object({
  text: z.string().min(1).max(4096).optional(),
  chatId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

export const tradeSchema = z.object({
  asset: z.enum(['xETH', 'xUSD']),
  amount: z.number().positive().max(1000),
  leverage: z.number().int().min(1).max(31),
  side: z.enum(['long', 'short']),
});

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export async function validateInput(ctx: Context, next: NextFunction): Promise<void> {
  try {
    if (ctx.message?.text) {
      messageSchema.parse({
        text: ctx.message.text,
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
      });
    }
    await next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      await ctx.reply('❌ Invalid input: ' + error.issues.map((e: { message: string }) => e.message).join(', '));
    } else {
      throw error;
    }
  }
}
