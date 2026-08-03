import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST(req: Request) {
  await destroySession();
  // Form POST (es. portale cliente) → redirect a /login; fetch/JSON → { ok }.
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("form-urlencoded") || ctype.includes("multipart/form-data")) {
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost";
    return NextResponse.redirect(`${proto}://${host}/login`, { status: 303 });
  }
  return NextResponse.json({ ok: true });
}
