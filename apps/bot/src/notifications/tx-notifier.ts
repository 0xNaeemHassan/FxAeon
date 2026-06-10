import { prisma } from "@fxbot/db";

interface WebhookEvent {
  event_type: string;
  data: {
    address?: string;
    hash?: string;
  };
}

export const txNotifier = {
  async handleWebhook(event: WebhookEvent) {
    const { event_type, data } = event;

    if (!data.address) return;

    // Find user by wallet address
    const user = await prisma.user.findFirst({
      where: { walletAddress: data.address },
      include: { notifications: true },
    });

    if (!user) return;

    switch (event_type) {
      case "transaction.broadcasted":
        // await sendNotification(user.telegramId, `📤 Transaction submitted: ${data.hash}`);
        break;
      case "transaction.confirmed":
        if (data.hash) {
          await prisma.txRecord.updateMany({
            where: { hash: data.hash },
            data: { status: "confirmed" },
          });
        }
        // await sendNotification(user.telegramId, `✅ Transaction confirmed: ${data.hash}`);
        break;
      case "transaction.execution_reverted":
        if (data.hash) {
          await prisma.txRecord.updateMany({
            where: { hash: data.hash },
            data: { status: "reverted" },
          });
        }
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
