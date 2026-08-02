# Fresh Context Studio — production image (Coolify service).
# Build context: apps/studio (small; the asset library is a volume, not baked in).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3440
EXPOSE 3440

# The identity embed is generated at start from the mounted library
# (STUDIO_LIBRARY_DIR/brand-guideline/whoweare.html). Non-fatal if the volume
# isn't populated yet — the Identity tab is empty until the first library sync.
CMD ["sh", "-c", "node scripts/build-identity-embed.js || echo '[start] identity embed skipped (library not populated yet)'; exec node server.js"]
