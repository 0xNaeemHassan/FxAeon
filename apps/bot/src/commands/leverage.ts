import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('📈 *Leverage Settings*

Current max leverage:
• xETH: 31x
• xUSD: 10x

Use `/leverage xETH 5` to set leverage.', { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Leverage error:', error);
    await ctx.reply('❌ Error fetching leverage settings. Please try again.');
  }
}
