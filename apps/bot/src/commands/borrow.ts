import { Context } from "grammy";
import { mintCommand } from "./mint.js";

export async function borrowCommand(ctx: Context) {
  await ctx.reply("Borrowing fxUSD — same as /mint. Redirecting...");
  await mintCommand(ctx);
}
