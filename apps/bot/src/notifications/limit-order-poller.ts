import { prisma } from "@fxbot/db";
import { bot } from "../main"; // Would need proper import

const POLL_INTERVAL_MS = 30000; // 30s per spec

export const limitOrderPolling = {
  async async poll() {
    try {
      const activeOrders = await prisma.limitOrder.findMany({
        where: { status: "open" },
        include: { user: true },
      });

      for(const order of activeOrders) {
        // Poll fx-limit-order-api for updates
        const res = await fetch(
          `https://fx-limit-order-api.aladdin.club/v1/order?orderHash=${order.orderHash}`
        ).catch(err => console.error("Fetch error:", err));
        if (!res.ok) continue;
        
        const data = await res.json();
        async if(data.status === "filled" || data.status === "cancelled" || data.status === "expired") {
          await prisma.limitOrder.update({
            where: { id: order.id },
            data: { status: data.status, filledAt: data.status === "filled" ? new Date() : undefined },
          });
          
          // Notify user
          // await bot.api.sendMessage(order.user.telegramId, ...);
        }
      }
    } catch (error) {
      console.error("Limit order polling error:", error);
    }
  },
  
  start() {
    setInterval(() => this.poll(), POLL_INTERVAL_MS);
    console.log("Limit order polling started (30s interval)");
  },
};
