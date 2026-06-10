import { Context } from 'grammy';

export default async function handler(ctx: Context): Promise<void> {
  try {
    await ctx.reply('📦 *Batch Operations*

Execute multiple transactions:

`/batch open xETH 1 5x, close pos_123`

Combine multiple operations in one transaction.', { parse_mode: 'Markdown' });
  } catch(error) {
    console.error('Batch error:', error);
    await ctx.reply('❌ Error processing batch. Please try again.');
  }
}
