import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('📜 *Trade History*

No trades yet.

Your trades will appear here.', { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('History error:', error);
    await ctx.reply('❌ Error fetching history. Please try again.');
  }
}
