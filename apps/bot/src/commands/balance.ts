import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('💰 *Your Balance*

ETH: 0.00
xETH: 0.00
xUSD: 0.00

Connect wallet to see real balances.', { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Balance error:', error);
    await ctx.reply('❌ Error fetching balance. Please try again.');
  }
}
