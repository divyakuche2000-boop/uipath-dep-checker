FROM registry.redhat.io/ubi9/nodejs-18-minimal:latest AS builder

USER 0
WORKDIR /app
COPY --chown=1001:1001 package.json ./
USER 1001

RUN npm install --ignore-scripts

COPY --chown=1001:1001 public/ ./public/
COPY --chown=1001:1001 src/ ./src/

# Build production bundle
ENV NODE_ENV=production
RUN npm run build

# ── Production stage: serve with nginx ──────────────────────────────────────
FROM registry.redhat.io/ubi9/nginx-120:latest

# Copy built assets from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# nginx config: proxy /api/* to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

USER 1001

CMD ["nginx", "-g", "daemon off;"]
