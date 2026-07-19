FROM registry.redhat.io/ubi9/nodejs-18-minimal:latest

# Create non-root user
USER 0
RUN mkdir -p /app/uploads /app/extracted && \
    chown -R 1001:1001 /app

WORKDIR /app

# Copy package files first for layer caching
COPY --chown=1001:1001 package.json ./

# Switch to non-root user before installing
USER 1001

# Install production dependencies only
RUN npm install --omit=dev --ignore-scripts

# Copy application source
COPY --chown=1001:1001 src/ ./src/

# Expose on non-privileged port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:5000/api/health || exit 1

# Run as non-root
USER 1001

CMD ["node", "src/server.js"]
