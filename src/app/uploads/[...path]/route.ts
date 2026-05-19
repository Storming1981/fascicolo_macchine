import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSession } from "@/lib/auth";

const ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { path: segs } = await ctx.params;
  const rel = segs.map((s) => decodeURIComponent(s)).join("/");
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT)) return new NextResponse("Forbidden", { status: 403 });

  try {
    const data = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
