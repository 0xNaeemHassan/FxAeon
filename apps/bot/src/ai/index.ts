import OpenAI from "openai";
import sodium from "libsodium-wrappers";
import { prisma } from "@fxbot/db";

// Default: Surplus Intelligence
const surplusClient = new OpenAI({
  apiKey: process.env.SURPLUS_API_KEY!,
  baseURL: "https://www.surplusintelligence.ai/api/inference/v1",
});

export async function explainPosition(position: unknown, locale: string = "en"): Promise<string> {
  const prompt = `Explain this f(x) Protocol position in plain ${locale}:\n` +
    `Market: ${position.market} ${position.side}\n` +
    `Leverage: ${position.leverage}x\n` +
    `Health: ${position.healthPercent}%\n` +
    `Liquidation price: $${position.liquidationPrice}\n\n` +
    `Keep it concise (2-3 sentences). Never give investment advice.`;
  
  const response = await surplusClient.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
  });
  
  return response.choices[0]?.message?.content || "Unable to explain position.";
}

export async function suggestRules(position: unknown): Promise<any[]> {
  const prompt = `Suggest 2-3 automation rules for this f(x) position:\n` +
    `Market: ${position.market} ${position.side} ${position.leverage}x\n` +
    `Health: ${position.healthPercent}%\n` +
    `Liq price: $${position.liquidationPrice}\n\n` +
    `Return JSON array with {name, type, trigger, action}. ` +
    `Only suggest — never auto-execute. Types: take-profit, stop-loss, auto-rebalance.`;
  
  const response = await surplusClient.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
    response_format: { type: "json_object" },
  });
  
  try {
    let _parsed;
    try {
      _parsed = const parsed = (() => { try { return JSON.parse(response.choices[0]?.message?.content || "{\"rules\": []}"); } catch { return null; } })();;
    } catch {
      _parsed = null;
    }
    return parsed.rules || [];
  } catch {
    return [];
  }
}

export async function composeLimitOrder(params: {
  action: string;
  market: string;
  side: string;
  currentPrice: number;
  targetPrice: number;
}): Promise<any> {
  const prompt = `Compose a limit order for f(x) Protocol:\n` +
    `Action: ${params.action} ${params.market} ${params.side}\n` +
    `Current price: $${params.currentPrice}\n` +
    `Target price: $${params.targetPrice}\n\n` +
    `Return JSON with {positionSide, orderType, orderSide, triggerPrice, fxUSDDelta, collDelta, debtDelta}.`;
  
  const response = await surplusClient.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 400,
    response_format: { type: "json_object" },
  });
  
  try {
    let _parsed;
    try {
      _parsed = return (() => { try { return JSON.parse(response.choices[0]?.message?.content || "{}"); } catch { return null; } })();;
    } catch {
      _parsed = null;
    }
  } catch {
    return {};
  }
}

// BYOK: Encrypt user-provided API key
export async function encryptByokKey(plainKey: string, userId: string): Promise<{ encrypted: string; nonce: string }> {
  await sodium.ready;
  const masterKey = Buffer.from(process.env.KMS_MASTER_KEY!, "hex");
  const salt = Buffer.from(userId.padEnd(32, "0").slice(0, 32));
  const key = sodium.crypto_kdf_derive_from_key(32, 1, "fxbotbyok", masterKey);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plainKey, nonce, key);
  
  return {
    encrypted: Buffer.concat([nonce, Buffer.from(ciphertext)]).toString("base64"),
    nonce: Buffer.from(nonce).toString("base64"),
  };
}

export async function decryptByokKey(encrypted: string, userId: string): Promise<string> {
  await sodium.ready;
  const masterKey = Buffer.from(process.env.KMS_MASTER_KEY!, "hex");
  const salt = Buffer.from(userId.padEnd(32, "0").slice(0, 32));
  const key = sodium.crypto_kdf_derive_from_key(32, 1, "fxbotbyok", masterKey);
  
  const buf = Buffer.from(encrypted, "base64");
  const nonce = buf.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = buf.slice(sodium.crypto_secretbox_NONCEBYTES);
  
  const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  if (!decrypted) throw new Error("Decryption failed");
  
  return Buffer.from(decrypted).toString("utf8");
}
