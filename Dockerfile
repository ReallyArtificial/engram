# Multi-stage Dockerfile for engram
# Production-ready: multi-stage build, non-root user, minimal image

FROM node:22-alpine AS builder

# Install build dependencies for native modules (better-sqlite3, sqlite-vec)
RUN apk add --no-cache python3 make g++

WORKDIR /build

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine

# Install runtime dependencies for native modules
RUN apk add --no-cache libstdc++

# Create non-root user
RUN addgroup -g 1001 engram && \
    adduser -D -u 1001 -G engram engram

WORKDIR /app

# Copy built artifacts and dependencies from builder
COPY --from=builder --chown=engram:engram /build/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /build/dist ./dist
COPY --from=builder --chown=engram:engram /build/package*.json ./

# Switch to non-root user
USER engram

# Default: run MCP server
# Override CMD to run other binaries: docker run engram-mcp engram-init
CMD ["node", "dist/bin/engram-mcp.js"]
