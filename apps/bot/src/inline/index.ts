import type { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { parseIntent, intentToTradeParams } from '../agent/intentParser.js';

export function registerInlineQueries(bot: Bot<any>) {
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim().toLowerCase();
    const botUsername = ctx.me?.username || 'FxAeonBot';
    const miniAppUrl = process.env.NEXT_PUBLIC_MINI_APP_URL || 'https://fxaeon.app';

    const results: any[] = [];

    // Case 1: Trade Intent query (e.g. "long eth 3x 500", "short btc 5x")
    const intent = parseIntent(query);
    if (intent && (intent.action === 'open_long' || intent.action === 'open_short')) {
      const isLong = intent.action === 'open_long';
      const market = intent.market ?? 'wstETH';
      const leverage = intent.leverage ?? 3;
      const amount = intent.amount ? ` ${intent.amount} ${intent.token ?? 'ETH'}` : '';

      const title = `${isLong ? '📈 Long' : '📉 Short'} ${market} · ${leverage}× Leverage`;
      const description = `Pre-fill ${market} ${isLong ? 'Long' : 'Short'}${amount} in FxAeon Mini App`;

      const keyboard = new InlineKeyboard().url(
        `🚀 Open ${isLong ? 'Long' : 'Short'} in Mini App`,
        `https://t.me/${botUsername}/app?startapp=trade_${market}_${isLong ? 'long' : 'short'}_${leverage}`
      );

      results.push({
        type: 'article',
        id: `trade_${market}_${isLong ? 'long' : 'short'}_${Date.now()}`,
        title,
        description,
        input_message_content: {
          message_text: `⚡ *FxAeon Trade Intent*\n\n*Market:* \`${market}\`\n*Direction:* \`${isLong ? 'Long ↗' : 'Short ↘'}\`\n*Leverage:* \`${leverage}×\`\n\n_Tap below to review the live on-chain simulation and execute self-custodially in Telegram._`,
          parse_mode: 'Markdown',
        },
        reply_markup: keyboard,
      });
    }

    // Case 2: Market shortcut cards (ETH, BTC, price)
    if (!query || query.includes('eth') || query.includes('price')) {
      results.push({
        type: 'article',
        id: `market_eth_${Date.now()}`,
        title: '💎 wstETH Market · Up to 10× Leverage',
        description: 'Trade decentralized Ethereum collateral with instant execution on Base & Ethereum.',
        input_message_content: {
          message_text: `💎 *wstETH / fxUSD Market*\n\n*Max Leverage:* \`10.0×\`\n*Collateral:* \`wstETH\`\n*Debt Asset:* \`fxUSD\`\n\nTrade on-chain with zero counterparty risk and automated liquidation protection.`,
          parse_mode: 'Markdown',
        },
        reply_markup: new InlineKeyboard().url('🚀 Trade ETH', `https://t.me/${botUsername}/app?startapp=trade_wstETH`),
      });
    }

    if (!query || query.includes('btc') || query.includes('bitcoin')) {
      results.push({
        type: 'article',
        id: `market_btc_${Date.now()}`,
        title: '₿ WBTC Market · Up to 10× Leverage',
        description: 'Trade decentralized Bitcoin collateral with transparent on-chain liquidation buffers.',
        input_message_content: {
          message_text: `₿ *WBTC / fxUSD Market*\n\n*Max Leverage:* \`10.0×\`\n*Collateral:* \`WBTC\`\n*Debt Asset:* \`fxUSD\`\n\nTrade BTC on-chain directly from Telegram.`,
          parse_mode: 'Markdown',
        },
        reply_markup: new InlineKeyboard().url('🚀 Trade BTC', `https://t.me/${botUsername}/app?startapp=trade_WBTC`),
      });
    }

    // Case 3: Earn & Bridge shortcuts
    if (!query || query.includes('earn') || query.includes('save')) {
      results.push({
        type: 'article',
        id: `earn_fxsave_${Date.now()}`,
        title: '🪙 fxSAVE Stability Pool · Real Yield',
        description: 'Deposit fxUSD to earn stability pool liquidation rewards and protocol yield.',
        input_message_content: {
          message_text: `🪙 *fxSAVE Stability Pool*\n\nEarn liquidation premiums and protocol yields on your fxUSD deposits with instant self-custodial redemptions.`,
          parse_mode: 'Markdown',
        },
        reply_markup: new InlineKeyboard().url('🪙 Open fxSAVE', `https://t.me/${botUsername}/app?startapp=earn`),
      });
    }

    await ctx.answerInlineQuery(results, {
      cache_time: 5,
      is_personal: true,
    });
  });
}
