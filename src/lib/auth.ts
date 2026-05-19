import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { Role } from "@prisma/client";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-me"
);
const COOKIE = "ft_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 giorni

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}
export function hashPin(pin: string) {
  return bcrypt.hash(pin, 10);
}
export function verifyPin(pin: string, hash: string) {
  return bcrypt.compare(pin, hash);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return {
      id: payload.id as string,
      name: payload.name as string,
      email: payload.email as string,
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

/** Utente di sessione completo (verifica esistenza/attivazione su DB). */
export async function currentUser() {
  const s = await getSession();
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.id } });
  if (!u || !u.active) return null;
  return u;
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}
