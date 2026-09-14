/**
 * Riduzione foto lato browser prima di mandarle all'AI.
 *
 * Le foto dei telefoni recenti pesano 4-8 MB: oltre i 5 MB l'API rifiuta
 * l'immagine, e sotto quella soglia si paga comunque upload lento dal campo.
 * Per leggere una targhetta bastano ~1600 px sul lato lungo.
 * `createImageBitmap` con `imageOrientation: "from-image"` applica l'EXIF,
 * altrimenti le foto verticali arrivano ruotate e l'OCR peggiora.
 */
export async function downscaleImage(file: File, maxSide = 1600, quality = 0.85): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", quality));
    // Già piccola (o formato non decodificabile): meglio l'originale.
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // HEIC su browser che non lo decodificano, ecc.: si prova con l'originale.
    return file;
  }
}
