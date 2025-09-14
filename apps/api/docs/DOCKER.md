# Docker Setup for CEITBA API

## Overview

The CEITBA API uses a multi-stage Docker setup optimized for both development and production environments.

## Architecture

```
infrastructure/
├── docker/
│   ├── Dockerfile              # Multi-stage build
│   ├── docker-compose.base.yml # Base configuration
│   ├── docker-compose.dev.yml  # Development overrides
│   └── docker-compose.prod.yml # Production overrides
├── database/
└── scripts/
```

## Quick Start

### Development

```bash
# Start development environment
npm run docker:dev

# With file watching
npm run docker:dev:watch

# View logs
npm run docker:logs
```

### Production

```bash
# Start production environment
npm run docker:prod

# View production logs
npm run docker:logs:prod

# Stop production
npm run docker:prod:down
```

## Docker Stages

### 1. Builder Stage
- **Base**: `node:20-alpine`
- **Purpose**: Compile TypeScript and build the application
- **Commands**: 
  - `npm ci` (install all dependencies)
  - `npm run build` (compile TypeScript)

### 2. Production Stage
- **Base**: `node:20-alpine`
- **Purpose**: Optimized runtime environment
- **Features**:
  - Production dependencies only
  - Non-root user (`ceitba`)
  - Health checks
  - Security optimizations
- **Entry**: `npm run start:prod`

### 3. Development Stage
- **Base**: `node:20-alpine`
- **Purpose**: Development with hot reload
- **Features**:
  - All dependencies installed
  - Volume mounting for live reload
  - Development tools
- **Entry**: `npm run start:dev`

## Environment Variables

### Required

```env
NODE_ENV=development|production
PORT=3000
DATABASE_URL=postgresql://postgres:password@postgres:5432/ceitba_db
```

### Optional

```env
POSTGRES_DB=ceitba_db
POSTGRES_PASSWORD=ceitba_password
ITBA_API_TOKEN=your_token
ITBA_API_BASE_URL=https://api.itba.edu.ar
SUPABASE_ACCESS_TOKEN=your_token
```

## Database

The setup includes PostgreSQL with:
- **Container**: `ceitba-postgres`
- **Port**: `5432`
- **Health checks**: Automatic readiness detection
- **Persistence**: Named volumes for data

## Networking

- **Network**: `ceitba-network`
- **Internal communication**: Service discovery by name
- **External access**: Port 3000 mapped to host

## Health Checks

### Development
- **Endpoint**: `http://localhost:3000/api/health`
- **Interval**: Every 30s
- **Timeout**: 3s

### Production
- **Enhanced monitoring**: Resource limits and reservations
- **Memory limits**: 512M max, 256M reserved
- **Restart policy**: `unless-stopped`

## File Watching (Development)

The development setup includes file watching:

```yaml
develop:
  watch:
    - action: sync      # Live sync source changes
      path: ../../src
      target: /app/src
    - action: rebuild   # Rebuild on package.json changes
      path: ../../package*.json
```

## Security Features

- **Non-root user**: All containers run as user `ceitba` (UID 1001)
- **Minimal attack surface**: Production removes dev dependencies
- **Health monitoring**: Automatic container health checks
- **Resource limits**: Memory and CPU constraints in production

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs ceitba-api-dev

# Rebuild from scratch
docker-compose down -v
docker-compose up --build
```

### Database connection issues
```bash
# Check database health
docker-compose ps
docker-compose logs postgres

# Reset database
docker-compose down -v postgres
docker-compose up postgres
```

### Port conflicts
```bash
# Check what's using port 3000
lsof -i :3000

# Use different port
PORT=3001 docker-compose up
```

### Performance issues
```bash
# Check resource usage
docker stats

# Increase memory limits in docker-compose.prod.yml
```

## Development Workflow

1. **Start services**:
   ```bash
   npm run docker:dev
   ```

2. **Make changes**: Edit source files - they'll sync automatically

3. **View logs**: 
   ```bash
   npm run docker:logs
   ```

4. **Access API**: `http://localhost:3000/api`

5. **Access Docs**: `http://localhost:3000/api/docs`

## Production Deployment

1. **Build optimized image**:
   ```bash
   npm run docker:prod
   ```

2. **Monitor health**:
   ```bash
   curl http://localhost:3000/api/health
   ```

3. **Scale if needed**:
   ```bash
   docker-compose -f docker-compose.prod.yml up --scale ceitba-api-prod=3
   ```

## Best Practices

- Use `.dockerignore` to exclude unnecessary files
- Keep images small with multi-stage builds
- Run as non-root user for security
- Implement proper health checks
- Use specific image tags (not `latest`)
- Monitor resource usage in production
