import { Context } from 'grammy';

export async function errorHandler(err: Error, ctx: Context) {
  console.error(`Error while handling update ${ctx.update.update_id}:`, err);
  
  try {
    await ctx.reply(
      '❌ An error occurred. Please try again or contact support.',
      { parse_mode: 'HTML' }
    );
  } catch (replyErr) {
    console.error('Failed to send error message:', replyErr);
  }
  
  // Log to monitoring
  if (process.env.SENTRY_DSN) {
    // Send to Sentry or similar
    console.error('Sentry error:', err);
  }
}
