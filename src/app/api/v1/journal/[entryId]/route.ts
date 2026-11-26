import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { postEntry, reverseEntry, updateDraft } from "@/server/ledger/journalService";

// PATCH /api/v1/journal/:entryId { version, lines: [{ id, accountId }] } -> taslak satır hesaplarını değiştir
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/journal/[entryId]">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof updateDraft>[2];
    return NextResponse.json(await updateDraft(context, (await ctx.params).entryId, body));
  } catch (error) {
    return errorResponse(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("post"), version: z.number().int().positive(), saveRule: z.boolean().optional() }),
  z.object({ action: z.literal("reverse"), reason: z.string() }),
]);

// POST /api/v1/journal/:entryId { action: "post", version, saveRule? } | { action: "reverse", reason }
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/journal/[entryId]">) {
  try {
    const context = await apiContext(request);
    const entryId = (await ctx.params).entryId;
    const body = actionSchema.parse(await readJson(request));
    if (body.action === "post") return NextResponse.json(await postEntry(context, entryId, { version: body.version, saveRule: body.saveRule }));
    return NextResponse.json(await reverseEntry(context, entryId, { reason: body.reason }));
  } catch (error) {
    return errorResponse(error);
  }
}
