import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import "../globals.css";

export const dynamic = "force-dynamic";

/**
 * Guscio del PORTALE CLIENTE: minimale, separato dall'app operatori. Accessibile
 * solo agli utenti con ruolo CLIENTE.
 */
export default async function PortaleLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "CLIENTE") redirect("/dashboard");

  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: { customer: { select: { name: true } } },
  });

  return (
    <div className="portal">
      <header className="portal-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="portal-logo" src="/zato-logo.png" alt="ZATO" />
        <div className="portal-who">
          <div className="portal-cust">{full?.customer?.name ?? "Cliente"}</div>
          <form action="/api/auth/logout" method="POST">
            <button className="portal-logout" type="submit">
              Esci
            </button>
          </form>
        </div>
      </header>
      <main className="portal-main">{children}</main>
    </div>
  );
}
