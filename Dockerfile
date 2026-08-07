# Fresh Context Studio — production image (Coolify service).
# Build context: brand-studio (small; the asset library is a volume, not baked in).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3440
EXPOSE 3440

# The checked-in identity embed keeps the Identity tab available on a fresh
# deployment. When the mounted library contains whoweare.html, startup
# rebuilds the embed so the volume remains the source of truth.
CMD ["sh", "-c", "node scripts/build-identity-embed.js || echo '[start] identity embed unavailable'; exec node server.js"]
