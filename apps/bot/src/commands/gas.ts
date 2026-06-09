import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('⛽ *Gas Estimates*

Current gas prices:

🐢 Slow: 15 gwei
🚶 Standard: 20 gwei
🚀 Fast: 30 gwei
⚡ Rapid: 50 gwei

Use `/gas trade` for transaction estimate.', { parse_mode: 'Markdown' });
  } async catch(error) {
    console.error('Gas error:', error);
    await ctx.reply('❌ Error fetching gas estimates. Please try again.');
  }
}
