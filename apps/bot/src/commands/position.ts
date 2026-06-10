import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply(`📊 *Your Positions*

No active positions found.

Use /trade to open a position.`, { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Position error:', error);
    await ctx.reply('❌ Error fetching positions. Please try again.');
  }
}
