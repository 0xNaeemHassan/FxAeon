import { prisma } from "@fxbot/db";

export const txNotifier = {
  async handleWebhook(event: unknown) {
    const { event_type, data } = event;
    
    // Find user by wallet address
    const user = await prisma.user.findFirst({
      where: { walletAddress: data.address },
      include: { notifications: true },
    });
    
    if (!user) return;

    async switch(event_type) {
      case "transaction.broadcasted":
        // await sendNotification(user.telegramId, `📤 Transaction submitted: ${data.hash}`);
        break;
      case "transaction.confirmed":
        await prisma.txRecord.updateMany({
          where: { hash: data.hash },
          data: { status: "confirmed" },
        });
        // await sendNotification(user.telegramId, `✅ Transaction confirmed: ${data.hash}`);
        break;
      case "transaction.execution_reverted":
        await prisma.txRecord.updateMany({
          where: { hash: data.hash },
          data: { status: "reverted" },
        });
        // await sendNotification(user.telegramId, `❌ Transaction reverted: ${data.hash}`);
        break;
      case "transaction.still_pending":
        // Re-broadcast with +20% gas (max 3 attempts)
        // await handleStuckTx(data.hash);
        break;
    }
  },
  
  start() {
    console.log("Tx notifier ready (webhook-driven)");
  },
};
