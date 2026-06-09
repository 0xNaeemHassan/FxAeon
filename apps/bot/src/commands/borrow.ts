import { Context } from "grammy";
import { mintCommand } from "./mint";

export async function async borrowCommand(ctx: Context) {
  await ctx.reply("Borrowing fxUSD — same as /mint. Redirecting...");
  await mintCommand(ctx);
}
