# Full-stack Next.js image — the TypeScript backend serves every endpoint.
# (The original FastAPI reference implementation builds via Dockerfile.fastapi.)
FROM node:20-slim AS build
WORKDIR /app/cockpit-next
COPY cockpit-next/package*.json ./
RUN npm ci
COPY cockpit-next ./
RUN npm run build

FROM node:20-slim
WORKDIR /app/cockpit-next
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    DB_PATH=/app/data/invoices.db \
    DOCS_DIR=/app/data/documents \
    DOCS_MD_DIR=/app/docs
COPY --from=build /app/cockpit-next/.next ./.next
COPY --from=build /app/cockpit-next/node_modules ./node_modules
COPY --from=build /app/cockpit-next/package.json ./
COPY cockpit-next/scripts ./scripts
COPY docs /app/docs
RUN mkdir -p /app/data
EXPOSE 3000
# Seeds fictional demo data on an empty database unless SEED_DEMO=0.
CMD ["node", "scripts/start.mjs"]
