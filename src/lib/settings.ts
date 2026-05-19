import "server-only";
import { prisma } from "./db";
import { PLANT_TYPES, MODELS_BY_PLANT } from "./plant";
import {
  mergePermissions,
  type PermissionMatrix,
  type PermAction,
  can as canPure,
} from "./permissions";
import type { Role } from "@prisma/client";

export type PlantConfig = { name: string; models: string[] }[];

const DEFAULT_PLANT_CONFIG: PlantConfig = PLANT_TYPES.map((p) => ({
  name: p,
  models: MODELS_BY_PLANT[p] ?? [],
}));

async function readSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

async function writeSetting(key: string, value: unknown) {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as object },
    create: { key, value: value as object },
  });
}

export async function getPlantConfig(): Promise<PlantConfig> {
  const stored = await readSetting<PlantConfig>("plantConfig");
  if (!stored || !Array.isArray(stored) || stored.length === 0) return DEFAULT_PLANT_CONFIG;
  return stored
    .filter((p) => p && typeof p.name === "string" && p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      models: Array.isArray(p.models) ? p.models.filter((m) => m && m.trim()).map((m) => m.trim()) : [],
    }));
}

export async function savePlantConfig(cfg: PlantConfig) {
  await writeSetting("plantConfig", cfg);
}

export async function getPermissions(): Promise<PermissionMatrix> {
  const stored = await readSetting<PermissionMatrix>("permissions");
  return mergePermissions(stored);
}

export async function savePermissions(matrix: PermissionMatrix) {
  await writeSetting("permissions", mergePermissions(matrix));
}

/** Verifica permesso leggendo la matrice da DB. */
export async function userCan(role: Role, action: PermAction): Promise<boolean> {
  if (role === "ADMIN") return true;
  const matrix = await getPermissions();
  return canPure(role, action, matrix);
}
