import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  getPlantConfig,
  savePlantConfig,
  getPermissions,
  savePermissions,
  userCan,
} from "@/lib/settings";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "settings.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  return NextResponse.json({
    plantConfig: await getPlantConfig(),
    permissions: await getPermissions(),
  });
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "settings.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json();
  if (b.plantConfig) {
    if (!Array.isArray(b.plantConfig))
      return NextResponse.json({ error: "plantConfig non valido" }, { status: 400 });
    const cfg = b.plantConfig
      .map((p: { name?: string; models?: string[] }) => ({
        name: String(p?.name || "").trim(),
        models: Array.isArray(p?.models)
          ? p.models.map((m) => String(m).trim()).filter(Boolean)
          : [],
      }))
      .filter((p: { name: string }) => p.name);
    await savePlantConfig(cfg);
  }
  if (b.permissions && typeof b.permissions === "object") {
    await savePermissions(b.permissions);
  }
  return NextResponse.json({ ok: true });
}
