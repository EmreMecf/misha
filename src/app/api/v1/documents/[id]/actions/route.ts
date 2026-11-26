import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { JOB_HANDLERS } from "@/server/documents/documentProcessor";
import { markReviewed, rejectDocument, reprocessDocument } from "@/server/documents/documentService";
import { runPendingJobs } from "@/server/jobs/jobQueue";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review") }),
  z.object({ action: z.literal("reject"), reason: z.string() }),
  z.object({ action: z.literal("reprocess") }),
]);

// POST /api/v1/documents/:id/actions { action: "review" | "reject" (+reason) | "reprocess" }
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/documents/[id]/actions">) {
  try {
    const context = await apiContext(request);
    const id = (await ctx.params).id;
    const body = bodySchema.parse(await readJson(request));
    if (body.action === "review") return NextResponse.json(await markReviewed(context, id));
    if (body.action === "reject") return NextResponse.json(await rejectDocument(context, id, { reason: body.reason }));
    const result = await reprocessDocument(context, id);
    if (process.env.INLINE_JOBS !== "false") after(() => runPendingJobs(JOB_HANDLERS, 10).catch((e) => console.error("İş kuyruğu:", e)));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
