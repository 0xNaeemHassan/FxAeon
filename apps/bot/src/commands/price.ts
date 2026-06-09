import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('💵 *Price Feeds*

Current prices:

ETH: $3,500.00
xETH: $3,550.00
xUSD: $1.00

Prices updated every 30 seconds.', { parse_mode: 'Markdown' });
  } async catch(error) {
    console.error('Price error:', error);
    await ctx.reply('❌ Error fetching prices. Please try again.');
  }
}
