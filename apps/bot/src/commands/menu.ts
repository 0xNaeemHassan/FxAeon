import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    const menuText = `
📋 *fxBot Menu*

Choose an action:

🔄 /trade - Open a position
📊 /position - View positions
💰 /balance - Check balance
⚙️ /settings - Bot settings
📈 /leverage - Adjust leverage
🛑 /stoploss - Set stop loss
🎯 /limit - Place limit order
🔄 /twap - TWAP orders
📦 /batch - Batch operations
⛽ /gas - Gas estimates
💵 /price - Price feeds
📜 /history - Trade history
🔔 /alert - Set alerts
🤖 /auto - Automation rules
❓ /help - Help & docs
`;
    await ctx.reply(menuText, { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Menu error:', error);
    await ctx.reply('❌ Error displaying menu. Please try again.');
  }
}
