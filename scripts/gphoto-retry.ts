/**
 * Copia su Google Foto le foto rimaste indietro: quelle scattate prima di
 * attivare il backup e quelle il cui caricamento è fallito (token scaduto,
 * rete, quota). Idempotente: salta tutto ciò che ha già un `gphotoId`.
 *
 *   npm run gphoto:retry            # fino a 200 foto
 *   npm run gphoto:retry -- 1000    # quante provarne
 *
 * Serve perché il backup gira dopo la risposta HTTP: se fallisce lì, nessuno
 * se ne accorge — l'errore resta su `Photo.gphotoError` e lo si recupera da qui.
 */
import { config } from "dotenv";
config();

async function main() {
  const limit = Number(process.argv[2] ?? 200) || 200;
  const { prisma } = await import("../src/lib/db");
  const { backupPhotos, pendingBackupPhotoIds } = await import("../src/lib/googlePhotos");

  const ids = await pendingBackupPhotoIds(limit);
  if (!ids.length) {
    console.log("Niente da copiare: nessuna foto in attesa.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Foto da copiare: ${ids.length}`);
  const r = await backupPhotos(ids);
  console.log(`Copiate: ${r.done} · non riuscite: ${r.failed}`);

  if (r.failed) {
    const errs = await prisma.photo.findMany({
      where: { id: { in: ids }, gphotoId: null, gphotoError: { not: null } },
      select: { id: true, path: true, gphotoError: true, authorName: true },
      take: 10,
    });
    console.log("\nPrimi errori:");
    for (const e of errs) console.log(` - ${e.path} (${e.authorName ?? "—"}): ${e.gphotoError}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
