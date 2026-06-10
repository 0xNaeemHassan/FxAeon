import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('🔄 *TWAP Orders*

Time-Weighted Average Price orders:

`/twap xETH buy 10 4 15m`

Buy 10 xETH in 4 intervals of 15 minutes each.', { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('TWAP error:', error);
    await ctx.reply('❌ Error creating TWAP order. Please try again.');
  }
}
