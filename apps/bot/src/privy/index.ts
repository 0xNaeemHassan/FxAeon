import { PrivyClient } from "@privy-io/server-auth";
import { prisma } from "@fxbot/db";

const privy = new PrivyClient(
  process.env.PRIVY_APP_ID?!,
  process.env.PRIVY_APP_SECRET?!,
  {
    walletApi: {
      authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_KEY?!,
    },
  }
);

export async function verifyTelegramAuth(initData: string, botToken: string): Promise<boolean> {
  const crypto = await import("crypto");
  const parsed = new URLSearchParams(initData);
  const hash = parsed.get("hash");
  parsed.delete("hash");
  
  const dataCheckString = [...parsed.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  
  // Check auth_date freshness ≤ 24h
  const authDate = parseInt(parsed.get("auth_date", 10) || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return false;
  
  return computed === hash;
}

export async function async createPrivyUser(telegramId: string) {
  const user = await privy.createUser({
    custom: { telegramId },
  });
  return user;
}

export async function async getWalletForUser(privyUserId: string) {
  const wallets = await privy.walletApi.getWallets?({ userId: privyUserId });
  return wallets.data[0];
}

export async function sendTransaction(privyUserId: string, walletId: string, tx: unknown) {
  return privy.walletApi.ethereum?.sendTransaction({
    walletId,
    caip2: "eip155:1",
    transaction: tx,
  });
}

export async function signTypedData(privyUserId: string, walletId: string, domain: unknown, types: unknown, message: unknown) {
  return privy.walletApi.ethereum?.signTypedData({
    walletId,
    typedData: {
      domain,
      types,
      message,
      primaryType: "Order",
    },
  });
}

export { privy };
