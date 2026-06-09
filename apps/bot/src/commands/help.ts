import { Context } from "grammy";

const COMMAND_CATEGORIES = [
  {
    emoji: "⚡",
    title: "Trading",
    commands: [
      { cmd: "/trade", desc: "Open leveraged position (1.1x–7x)" },
      { cmd: "/limit", desc: "Place limit/stop orders" },
      { cmd: "/orders", desc: "View active orders" },
      { cmd: "/mint", desc: "Borrow fxUSD (no leverage)" },
      { cmd: "/redeem", desc: "Redeem fxUSD for collateral" },
      { cmd: "/repay", desc: "Repay fxUSD debt" },
    ]
  },
  {
    emoji: "💰",
    title: "Yield & Governance",
    commands: [
      { cmd: "/save", desc: "fxSAVE deposit/withdraw" },
      { cmd: "/lock", desc: "Lock FXN → veFXN" },
      { cmd: "/vote", desc: "Gauge voting" },
      { cmd: "/claim", desc: "Claim rewards" },
    ]
  },
  {
    emoji: "📊",
    title: "Portfolio",
    commands: [
      { cmd: "/portfolio", desc: "View positions, balances, health" },
      { cmd: "/deposit", desc: "Show wallet address + QR" },
      { cmd: "/withdraw", desc: "Send to external address" },
      { cmd: "/bridge", desc: "Bridge fxUSD (ETH ↔ Base)" },
    ]
  },
  {
    emoji: "🤖",
    title: "Automation",
    commands: [
      { cmd: "/auto", desc: "Create/manage automation rules" },
      { cmd: "/refer", desc: "Your referral link + earnings" },
    ]
  },
  {
    emoji: "⚙️",
    title: "Settings",
    commands: [
      { cmd: "/settings", desc: "Language, slippage, MEV protection" },
      { cmd: "/security", desc: "Policies, audits, export data" },
      { cmd: "/help", desc: "This menu" },
    ]
  }
];

export async function helpCommand(ctx: Context) {
  try {
    let msg = `📚 *FxAeon Command Guide*

`;
    msg += `Tap any command below to use it, or type it directly.

`;

    for (const category of COMMAND_CATEGORIES) {
      msg += `${category.emoji} *${category.title}*
`;
      for (const { cmd, desc } of category.commands) {
        msg += `  ${cmd} — ${desc}
`;
      }
      msg += `
`;
    }

    msg += `*Key Features:*
`;
    msg += `• Non-custodial — keys in Privy TEE
`;
    msg += `• Zero on-ramps — fund your own wallet
`;
    msg += `• MEV protection toggle (Flashbots, free)
`;
    msg += `• 8 languages: en, zh, ko, ja, ru, es, ar, de

`;
    msg += `Need help? Use /start to reconnect or contact support.`;

    await ctx.reply(msg, { 
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⚡ Open Trade", callback_data: "nav_trade" },
            { text: "📊 Portfolio", callback_data: "nav_portfolio" }
          ],
          [
            { text: "⚙️ Settings", callback_data: "nav_settings" },
            { text: "🛡️ Security", callback_data: "nav_security" }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('[helpCommand] Error:', error);
    await ctx.reply(
      `❌ Couldn't load the help menu. Try /start to reconnect.`,
      { parse_mode: "Markdown" }
    );
  }
}
