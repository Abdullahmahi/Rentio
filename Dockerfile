# Coolify builds this from the repo root (build pack: Dockerfile, port 3000).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
# Compiled into the browser bundle, so it must exist at build time.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    NITRO_PRESET=node-server
RUN bun run build

# .output is self-contained: Nitro bundles the server's dependencies.
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
