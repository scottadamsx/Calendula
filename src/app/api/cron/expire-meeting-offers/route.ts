import { NextResponse, type NextRequest } from "next/server";
import { expireMeetingOffers } from "@/app/actions/meetings";

/** spec §13 — one of the three explicitly named crons: "meeting offer expiry hourly." */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await expireMeetingOffers();
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}
