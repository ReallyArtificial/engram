# Multi-stage build for engram
# Memory management library with MCP server and init CLI

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install SQLite (required by better-sqlite3)
RUN apk add --no-cache sqlite

# Create non-root user
RUN addgroup -g 1001 -S engram && \
    adduser -S engram -u 1001 -G engram

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Create data directory for engram databases
RUN mkdir -p /app/data && \
    chown -R engram:engram /app

# Switch to non-root user
USER engram

# Set environment variables
ENV NODE_ENV=production \
    ENGRAM_DATA_DIR=/app/data

# Volume for persistent storage
VOLUME ["/app/data"]

# Default command: run MCP server
# Override with engram-init via: docker run <image> npx engram-init
CMD ["node", "dist/bin/engram-mcp.js"]
