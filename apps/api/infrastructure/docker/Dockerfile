# Multi-stage build for CEITBA API
# Stage 1: Build dependencies and compile TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm ci --only=production=false

COPY . .

RUN npx prisma generate

RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ceitba -u 1001

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder --chown=ceitba:nodejs /app/dist ./dist
COPY --from=builder --chown=ceitba:nodejs /app/package*.json ./
COPY --from=builder --chown=ceitba:nodejs /app/tsconfig.json ./
COPY --from=builder --chown=ceitba:nodejs /app/nest-cli.json ./
COPY --from=builder --chown=ceitba:nodejs /app/node_modules/.prisma ./node_modules/.prisma


RUN rm -rf tests/ docs/ .git/ .github/ *.md

RUN chown -R ceitba:nodejs /app
USER ceitba

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["npm", "run", "start:prod"]

# Stage 3: Development environment
FROM node:20-alpine AS development

RUN apk add --no-cache python3 make g++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ceitba -u 1001

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .
COPY prisma ./prisma
RUN npx prisma generate

RUN chown -R ceitba:nodejs /app
USER ceitba

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
