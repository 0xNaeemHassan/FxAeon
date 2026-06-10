import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('🎯 *Trailing Stop*

Set trailing stop to lock in profits:

`/trailing pos_123 3%`

Stop will trail price by 3%.', { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Trailing stop error:', error);
    await ctx.reply('❌ Error setting trailing stop. Please try again.');
  }
}
