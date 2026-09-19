FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY sql ./sql
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-tra tesseract-ocr-chi-sim tesseract-ocr-jpn tesseract-ocr-kor python3 python3-pip ca-certificates \
  && pip3 install --break-system-packages --no-cache-dir "yt-dlp[default,curl-cffi]==2026.8.19" "gallery-dl==1.32.12" "youtube-transcript-api==1.2.4" \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY sql ./sql
COPY assets ./assets
CMD ["node", "dist/src/api/main.js"]
