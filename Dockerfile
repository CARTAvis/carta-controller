# Multi-stage build for efficient, reproducible production image
# 1) Build deps + compile TypeScript + prune dev deps
# 2) Runtime image with only production deps and compiled output

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build-deps

WORKDIR /app

# Native build toolchain for node-linux-pam and TypeScript compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    g++ \
    make \
    git \
    libpam0g-dev \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy the rest of the source and build
COPY . .
# Build native modules after install (e.g., node-linux-pam)
RUN npm rebuild

# Compile TypeScript (prepare runs tsc)
RUN npm run prepare
# Remove dev dependencies to keep runtime small
RUN npm prune --omit=dev

# -------------------- Runtime Image --------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /opt/carta-controller

# Install runtime libs only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpam0g \
    tini && \
    rm -rf /var/lib/apt/lists/*

# Copy compiled app and production node_modules
COPY --from=build-deps /app/dist ./dist
COPY --from=build-deps /app/views ./views
COPY --from=build-deps /app/schemas ./schemas
COPY --from=build-deps /app/node_modules ./node_modules
COPY --from=build-deps /app/package.json ./

# Optional: bake in a default config (can be overridden by mounting)
# COPY config.json /etc/carta/config.json

# Ensure log directory exists and is writable
RUN mkdir -p /var/log/carta && chown -R node:node /var/log/carta

# Install the controller binary on PATH (uses compiled bin entry)
RUN ln -s /opt/carta-controller/dist/carta-controller /usr/local/bin/carta-controller && \
    chmod +x /opt/carta-controller/dist/carta-controller

EXPOSE 8000
USER node
ENTRYPOINT ["tini", "--"]
CMD ["carta-controller", "--config", "/etc/carta/config.json"]