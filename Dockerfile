FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL=file:/app/data/prod.db

RUN apk add --no-cache openssl tini

COPY --from=builder /app ./
RUN chmod +x scripts/docker-entrypoint.sh
RUN mkdir -p /app/data

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "./scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
