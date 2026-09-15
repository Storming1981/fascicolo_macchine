import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { addSheetOptions, getSheetOptions, removeSheetOption } from "@/lib/allestimentoService";

/**
 * Voci degli elenchi delle schede di allestimento (es. costruttori cavalletto).
 * GET → { options }; POST { list, value } aggiunge (chi compila le schede);
 * DELETE ?list=&value= toglie una voce aggiunta (chi ha machine.edit). Le voci
 * di partenza stanno nel codice e non si tolgono.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  return NextResponse.json({ options: await getSheetOptions() });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const list = typeof b?.list === "string" ? b.list : "";
  const value = typeof b?.value === "string" ? b.value.trim() : "";
  if (!list || !value) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  return NextResponse.json({ options: await addSheetOptions([{ list, value }]) });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const list = sp.get("list") ?? "";
  const value = sp.get("value") ?? "";
  if (!list || !value) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  return NextResponse.json({ options: await removeSheetOption(list, value) });
}
