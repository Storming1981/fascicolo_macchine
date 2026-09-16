import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { absoluteUrl } from "@/lib/absoluteUrl";

export async function POST(req: Request) {
  await destroySession();
  // Form POST (es. portale cliente) → redirect a /login; fetch/JSON → { ok }.
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("form-urlencoded") || ctype.includes("multipart/form-data")) {
    return NextResponse.redirect(absoluteUrl(req, "/login"), { status: 303 });
  }
  return NextResponse.json({ ok: true });
}
