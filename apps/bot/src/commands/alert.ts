import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply(`🔔 *Price Alerts*

Set alerts for price movements:

\`/alert xETH > 4000\`
\`/alert xUSD < 0.95\``, { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Alert error:', error);
    await ctx.reply('❌ Error setting alert. Please try again.');
  }
}
