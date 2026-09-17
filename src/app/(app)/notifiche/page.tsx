import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listNotifications } from "@/lib/notifications";
import NotificheClient from "./NotificheClient";

export const dynamic = "force-dynamic";

/**
 * Le notifiche personali dell'utente: l'archivio dietro alla campanella.
 * Non ha permessi propri — ognuno vede le proprie e basta.
 *
 * Da non confondere con /service/notifiche, che è il cruscotto del service
 * (SLA, P.O.S. da validare) e guarda gli interventi di tutti.
 */
export default async function NotifichePersonaliPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENTE") redirect("/portale");

  const items = await listNotifications(user.id, 100);
  return <NotificheClient initial={items} />;
}
