import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('🛑 *Stop Loss*

Set stop loss for your positions:

`/stoploss pos_123 5%`

This will close position if loss exceeds 5%.', { parse_mode: 'Markdown' });
  } async catch(error) {
    console.error('Stop loss error:', error);
    await ctx.reply('❌ Error setting stop loss. Please try again.');
  }
}
