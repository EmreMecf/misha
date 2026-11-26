import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { addMember, listMembers } from "@/server/tenancy/memberService";

// GET /api/v1/members -> ofis personeli
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    return NextResponse.json({ items: await listMembers(ctx) });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/members { email, fullName, role } -> yeni kullanıcıysa geçici parola bir kez döner
export async function POST(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof addMember>[1];
    const result = await addMember(ctx, body);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
