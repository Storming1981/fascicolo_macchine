import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

/** URL assoluto sul dominio pubblico (dietro reverse proxy). */
function absolute(req: Request, path: string): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "localhost";
  return `${proto}://${host}${path}`;
}

/**
 * Login. Accetta sia una POST di FORM nativa (redirect dal server: robusto su
 * iOS Safari, dove il Set-Cookie va applicato durante una navigazione reale) sia
 * una POST JSON (retrocompatibile, risponde in JSON).
 */
export async function POST(req: Request) {
  const ctype = req.headers.get("content-type") || "";
  const isForm = ctype.includes("form-urlencoded") || ctype.includes("multipart/form-data");

  let email = "";
  let password = "";
  try {
    if (isForm) {
      const fd = await req.formData();
      email = String(fd.get("email") || "");
      password = String(fd.get("password") || "");
    } else {
      const b = await req.json();
      email = String(b?.email || "");
      password = String(b?.password || "");
    }
  } catch {
    return isForm
      ? NextResponse.redirect(absolute(req, "/login?error=1"), { status: 303 })
      : NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  const fail = (msg: string, status: number) =>
    isForm
      ? NextResponse.redirect(absolute(req, "/login?error=1"), { status: 303 })
      : NextResponse.json({ error: msg }, { status });

  if (!email || !password) return fail("Email e password obbligatori", 400);

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      return fail("Credenziali non valide", 401);
    }
    // Firma la sessione e imposta il cookie DIRETTAMENTE sulla risposta (incl.
    // redirect): garantisce che il Set-Cookie accompagni la navigazione anche
    // su iOS Safari.
    const token = await signSession({ id: user.id, name: user.name, email: user.email, role: user.role });
    // I clienti (ruolo CLIENTE) vanno al portale, non alla dashboard operatori.
    const home = user.role === "CLIENTE" ? "/portale" : "/dashboard";
    const res = isForm
      ? NextResponse.redirect(absolute(req, home), { status: 303 })
      : NextResponse.json({ ok: true, home });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch {
    return fail("Errore di accesso", 500);
  }
}
