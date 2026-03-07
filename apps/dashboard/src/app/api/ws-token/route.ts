import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { issueDashboardStreamToken } from "@/lib/stream-token";

export async function GET(req: NextRequest) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ token: issueDashboardStreamToken(user.id) });
}
