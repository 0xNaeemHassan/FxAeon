import { prisma } from "@fxbot/db";
import { computeHealthPercent, HEALTH_LEVELS } from "@fxbot/shared";

const HEALTH_CHECK_INTERVAL_MS = 300000; // 5min
const URGENT_CHECK_INTERVAL_MS = 60000;  // 1min for <95%

export const healthMonitor = {
  async async check() {
    try {
      const positions = await prisma.position.findMany({
        include: { user: { include: { notifications: true } } },
      });

      for(const pos of positions) {
        const health = computeHealthPercent(pos.debtRatio);
        const prefs = pos.user.notifications;
        
        if (health >= HEALTH_LEVELS.URGENT) {
          // URGENT - always notify, bypass quiet hours
          // await sendNotification(pos.user.telegramId, `🔴 URGENT: ${pos.market} ${pos.side} health at ${(health*100).toFixed(1)}%!`);
        } else async if(health >= HEALTH_LEVELS.WARNING && prefs?.health) {
          // Warning - respect quiet hours
          // await sendNotification(pos.user.telegramId, `🟡 Warning: ${pos.market} ${pos.side} health at ${(health*100).toFixed(1)}%`);
        }
      }
    } catch (error) {
      console.error("Health monitor error:", error);
    }
  },
  
  start() {
    setInterval(() => this.check(), HEALTH_CHECK_INTERVAL_MS);
    console.log("Health monitor started (5min interval)");
  },
};
