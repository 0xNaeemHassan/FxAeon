import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { computeHealthPercent, HEALTH_LEVELS } from "@fxbot/shared";

function getHealthBar(health: number): string {
  const filled = Math.round(health * 10);
  const empty = 10 - filled;
  
  if (health < HEALTH_LEVELS.URGENT) {
    return "🔴 " + "█".repeat(Math.max(1, filled)) + "░".repeat(empty) + " CRITICAL";
  } else if (health < HEALTH_LEVELS.WARNING) {
    return "🟡 " + "█".repeat(filled) + "░".repeat(empty) + " WARNING";
  } else {
    return "🟢 " + "█".repeat(filled) + "░".repeat(empty) + " HEALTHY";
  }
}

function getHealthEmoji(health: number): string {
  if (health < HEALTH_LEVELS.URGENT) return "🔴";
  if (health < HEALTH_LEVELS.WARNING) return "🟡";
  return "🟢";
}

export async function portfolioCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const user = await prisma.user.findUnique({ 
      where: { telegramId }, 
      include: { positions: true } 
    });

    if (!user) {
      await ctx.reply(
        `🔐 *Wallet Not Connected*

` +
        `You need to connect a wallet first.

` +
        `Use /start to begin the setup process.`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔐 Connect Wallet", callback_data: "nav_start" }]
            ]
          }
        }
      );
      return;
    }

    const walletShort = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
    
    let msg = `📊 *Portfolio Overview*

`;
    msg += `Wallet: \`${walletShort}\`
`;
    msg += `Positions: ${user.positions.length}

`;

    if (user.positions.length === 0) {
      msg += `*No active positions*

`;
      msg += `Get started with your first trade or mint some fxUSD.

`;
      msg += `💡 *New to f(x) Protocol?*
`;
      msg += `• /trade — Open a leveraged position
`;
      msg += `• /mint — Borrow fxUSD (no leverage)
`;
      msg += `• /save — Deposit into fxSAVE for yield`;
      
      await ctx.reply(msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "⚡ Trade", callback_data: "nav_trade" },
              { text: "💰 Mint fxUSD", callback_data: "nav_mint" }
            ],
            [
              { text: "📖 Learn More", callback_data: "help_trading" }
            ]
          ]
        }
      });
      return;
    }

    // Show positions with health bars
    msg += `*Active Positions:*

`;
    
    for (let i = 0; i < user.positions.length; i++) {
      const pos = user.positions[i];
      const health = computeHealthPercent(pos.debtRatio);
      const healthBar = getHealthBar(health);
      
      msg += `${i + 1}. *${pos.market} ${pos.side.toUpperCase()}* ${pos.leverage}x
`;
      msg += `   ${healthBar}
`;
      msg += `   Collateral: ${pos.collateral} | Debt: ${pos.debt}
`;
      msg += `   Liq. Price: $${pos.liquidationPrice.toFixed(2)}

`;
    }

    // Add risk summary
    const avgHealth = user.positions.reduce((sum, p) => sum + computeHealthPercent(p.debtRatio), 0) / user.positions.length;
    const riskLevel = avgHealth < HEALTH_LEVELS.URGENT ? "🔴 HIGH" : avgHealth < HEALTH_LEVELS.WARNING ? "🟡 MEDIUM" : "🟢 LOW";
    
    msg += `*Risk Summary:* ${riskLevel}
`;
    msg += `Avg Health: ${(avgHealth * 100).toFixed(1)}%

`;
    msg += `Use /trade to adjust positions or /auto to set up stop-losses.`;

    await ctx.reply(msg, { 
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⚡ New Trade", callback_data: "nav_trade" },
            { text: "🤖 Automation", callback_data: "nav_auto" }
          ],
          [
            { text: "💰 Deposit", callback_data: "nav_deposit" },
            { text: "📤 Withdraw", callback_data: "nav_withdraw" }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('[portfolioCommand] Error:', error);
    await ctx.reply(
      `❌ *Couldn't load portfolio*

` +
      `Please try again. If the issue persists, your funds are safe — this is just a display issue.`,
      { parse_mode: "Markdown" }
    );
  }
}
