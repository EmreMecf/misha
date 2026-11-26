import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { classifyTransaction, matchToInvoice, setIgnored } from "@/server/bank/bankService";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("match"), documentId: z.uuid() }),
  z.object({ action: z.literal("classify"), accountId: z.string(), ruleId: z.uuid().optional(), saveKeyword: z.string().optional() }),
  z.object({ action: z.literal("ignore") }),
  z.object({ action: z.literal("unignore") }),
]);

// POST /api/v1/bank-transactions/:id { action: match | classify | ignore | unignore }
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/bank-transactions/[transactionId]">) {
  try {
    const context = await apiContext(request);
    const id = (await ctx.params).transactionId;
    const body = bodySchema.parse(await readJson(request));
    if (body.action === "match") return NextResponse.json(await matchToInvoice(context, id, body.documentId));
    if (body.action === "classify") {
      return NextResponse.json(await classifyTransaction(context, id, { accountId: body.accountId, ruleId: body.ruleId, saveKeyword: body.saveKeyword || undefined }));
    }
    return NextResponse.json(await setIgnored(context, id, body.action === "ignore"));
  } catch (error) {
    return errorResponse(error);
  }
}
