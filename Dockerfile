# syntax=docker/dockerfile:1
# Immagine di produzione per "Fascicolo Tecnico Macchina" (Next.js 16 + Prisma).
# Build multi-stage: base -> deps -> builder(=tools) -> runner (standalone).

# ---------- base: runtime comune ----------
# NB: i repository Debian sono forzati su HTTPS perché su alcune VPS (es. OVH)
# la porta 80 in uscita è bloccata e `apt-get update` andrebbe in timeout.
# `openssl` (libssl3) è indispensabile a Prisma: non è incluso in node:*-slim.
FROM node:22-bookworm-slim AS base
RUN set -eux; \
    for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do \
      [ -f "$f" ] && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' "$f" || true; \
    done; \
    apt-get update; \
    apt-get install -y --no-install-recommends openssl ca-certificates tini; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- deps: solo dipendenze ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- builder: build Next + client Prisma ----------
# Questo stage serve ANCHE come "tools": ha sorgenti e node_modules completi,
# quindi si usa per `prisma db push`, seed e script di manutenzione (tsx).
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` esegue anche `prisma generate`
RUN npm run build

# ---------- runner: immagine finale ----------
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

# Output standalone: contiene server.js + node_modules minimi tracciati
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Client Prisma (engine) — necessario a runtime
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# I file caricati (foto, firme, PDF) vivono su volume persistente
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data /app
USER nextjs

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
