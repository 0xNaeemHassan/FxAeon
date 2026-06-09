import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('🔒 *Close Position*

Please specify position ID to close:

Example: `/close pos_123`', { parse_mode: 'Markdown' });
  } async catch(error) {
    console.error('Close error:', error);
    await ctx.reply('❌ Error processing close request. Please try again.');
  }
}
