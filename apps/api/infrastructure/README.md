# Infrastructure Documentation

This directory contains all infrastructure-related configuration files for the CEITBA API project.

## Directory Structure

```
infrastructure/
├── docker/
│   ├── Dockerfile                    # Multi-stage Docker build
│   ├── docker-compose.base.yml      # Base services (postgres, networks, volumes)
│   ├── docker-compose.dev.yml       # Development-specific configuration
│   └── docker-compose.prod.yml      # Production-specific configuration
├── scripts/
│   └── deploy.sh                    # Deployment scripts
└── README.md                        # This file
```

## Docker Setup

### Architecture

We use a **multi-file Docker Compose setup** to separate concerns:

- **`docker-compose.base.yml`**: Contains shared services (PostgreSQL, networks, volumes)
- **`docker-compose.dev.yml`**: Development-specific API service with hot reload
- **`docker-compose.prod.yml`**: Production-optimized API service
- **Root `docker-compose.yml`**: Extends base + dev for local development
- **Root `docker-compose.prod.yml`**: Extends base + prod for production

### Available Commands

#### Development
```bash
# Start database only
npm run docker:db:up

# Start full development environment
npm run docker:dev

# Watch mode (auto-reload on file changes)
npm run docker:dev:watch

# View development logs
npm run docker:logs

# Stop database
npm run docker:db:down
```

#### Production
```bash
# Start production environment
npm run docker:prod

# Stop production environment
npm run docker:prod:down

# View production logs
npm run docker:logs:prod
```

### Environment Files

Make sure you have a `.env` file in the project root with:

```env
# Database
DATABASE_URL=postgresql://ceitba_user:ceitba_password@localhost:5432/ceitba_db

# API
PORT=3000
NODE_ENV=development

# Add other environment variables as needed
```

### Docker Features

#### Development Environment
- **Hot Reload**: Changes to source files automatically restart the server
- **Volume Mounting**: Source code is mounted for live editing
- **Watch Mode**: Docker Compose watch for efficient development
- **Debug Support**: Ready for debugging tools

#### Production Environment
- **Multi-stage Build**: Optimized production image
- **Security**: Non-root user, minimal attack surface
- **Health Checks**: Built-in health monitoring
- **Resource Limits**: Memory constraints for stability
- **Optimized Image**: Smaller size, faster startup

### Build Context

All Docker builds use the **project root** as the build context, ensuring access to all necessary files while keeping the infrastructure organized in subdirectories.

## Database

The PostgreSQL database is configured with:
- **Version**: PostgreSQL 16 Alpine
- **Port**: 5432
- **Database**: ceitba_db
- **User**: ceitba_user
- **Password**: ceitba_password (change in production!)
- **Initialization**: Automatic schema setup via `init.sql`
- **Health Checks**: Built-in readiness checks

## Networks

All services communicate through the `ceitba-network` bridge network, providing:
- Service discovery by name
- Isolation from host network
- Secure inter-container communication

## Volumes

- **`postgres_data`**: Persistent PostgreSQL data storage
- **Development**: Source code mounted for live editing
- **Production**: No volumes for security and immutability

## Best Practices Implemented

1. **Separation of Concerns**: Environment-specific configurations
2. **Security**: Non-root containers, minimal images
3. **Performance**: Multi-stage builds, resource limits
4. **Development Experience**: Hot reload, watch mode, easy commands
5. **Production Ready**: Health checks, proper logging, resource management
6. **Maintainability**: Clear structure, comprehensive documentation

## Troubleshooting

### Common Issues

1. **Port Conflicts**: If port 3000 or 5432 is in use, stop other services or change ports
2. **Permission Issues**: Ensure Docker has proper permissions on your system
3. **Build Failures**: Clear Docker cache with `docker system prune`
4. **Database Connection**: Verify `.env` file and network connectivity

### Useful Commands

```bash
# View all containers
docker ps -a

# View logs for specific service
docker-compose logs -f [service-name]

# Rebuild containers
docker-compose build --no-cache

# Clean up everything
docker-compose down -v
docker system prune -a
```

## Migration from Old Setup

If you're migrating from the old single docker-compose.yml:

1. The new setup maintains the same service names
2. All existing npm scripts continue to work
3. Environment variables remain the same
4. Database data is preserved in the same volume

The main benefits of this new structure:
- Better organization
- Environment-specific optimizations
- Easier maintenance and scaling
- Production-ready configuration
