# CEITBA-API

CEITBA-API is a Node.js/TypeScript REST API for managing ITBA student and club data, including proposals, benefits, attendance, user management, and more. It is designed for the CEITBA community to streamline club operations and integrate with ITBA systems.

## Features

- User and staff management
- Proposals and voting system
- Benefits and attendance tracking
- ITBA career and classroom integration
- Scheduler and event management
- Minecraft whitelist management
- Modular and extensible architecture

## Installation

### Local Development

1. Clone the repository:
   ```sh
   git clone https://github.com/CEITBA/CEITBA-API.git
   cd CEITBA-API
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Configure environment variables:
   ```sh
   cp .env.example .env
   # Edit .env with your configuration
   ```

### Docker Development

1. Clone the repository:
   ```sh
   git clone https://github.com/CEITBA/CEITBA-API.git
   cd CEITBA-API
   ```

2. Create environment file:
   ```sh
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. Build and run with Docker Compose:
   ```sh
   # Development environment with hot reload
   docker-compose up ceitba-api-dev
   
   # Or build and run manually
   docker build -t ceitba-api:dev --target development .
   docker run -p 3000:3000 -v $(pwd):/app -v /app/node_modules ceitba-api:dev
   ```

## Usage

### Local Development

Start the development server with hot reload:

```sh
npm run dev
```

Or start the production server:

```sh
npm start
```

The API will be available at `http://localhost:3000`.

### Docker Usage

#### Development Environment

The development environment includes hot reload and development dependencies:

```sh
# Using Docker Compose (recommended)
docker-compose up ceitba-api-dev

# Using Docker directly
docker build -t ceitba-api:dev --target development .
docker run -d \
  --name ceitba-api-dev \
  -p 3000:3000 \
  -v $(pwd):/app \
  -v /app/node_modules \
  --env-file .env \
  ceitba-api:dev
```

#### Production Environment

The production environment is optimized for performance and security:

```sh
# Using Docker Compose (recommended)
docker-compose up ceitba-api-prod

# Using Docker directly
docker build -t ceitba-api:prod --target production .
docker run -d \
  --name ceitba-api-prod \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  ceitba-api:prod
```

#### Docker Commands

```sh
# Build development image
docker build -t ceitba-api:dev --target development .

# Build production image
docker build -t ceitba-api:prod --target production .

# View logs
docker logs ceitba-api-dev
docker logs ceitba-api-prod

# Stop containers
docker stop ceitba-api-dev ceitba-api-prod

# Remove containers
docker rm ceitba-api-dev ceitba-api-prod

# Health check
curl http://localhost:3000/api/health
```

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# API Tokens
ITBA_API_TOKEN=your_itba_api_token_here
SUPABASE_ACCESS_TOKEN=your_supabase_access_token_here

# Cron Jobs (optional)
ENABLE_CRON=false
```

## Documentation

To view the API documentation, start the server and open:

```
http://localhost:3000/api/docs
```

This will display the interactive API docs (Swagger UI or similar, if enabled in your configuration).

## API Structure

- `v1/app/` – Main application routes and models
- `v1/benefits/` – Benefits, attendance, and inscription endpoints
- `v1/itba/` – ITBA integration (careers, classrooms, subjects)
- `v1/minecraft/` – Minecraft whitelist management
- `v1/scheduler/` – Scheduler and event routes
- `v1/user/` – User, staff, and authentication modules
- `v1/middleware/` – Request validation middleware
- `v1/config/` – Supabase and other configuration

## Development

### Local Development Setup

- TypeScript is used throughout the project.
- Linting and formatting are recommended (add ESLint/Prettier as needed).
- Tests can be run with:
  ```sh
  npm test
  ```

### Docker Development Setup

The Docker development environment provides:
- Hot reload with nodemon
- All development dependencies
- Volume mounting for live code changes
- Isolated environment consistent across team members

To start developing with Docker:

```sh
# Start development environment
docker-compose up ceitba-api-dev

# View logs
docker-compose logs -f ceitba-api-dev

# Stop development environment
docker-compose down
```

### Production Deployment

The production Docker image is optimized with:
- Multi-stage build for smaller image size
- Non-root user for security
- Health checks for monitoring
- Only production dependencies
- Automatic restarts

Deploy to production:

```sh
# Build production image
docker build -t ceitba-api:latest --target production .

# Run in production
docker run -d \
  --name ceitba-api \
  -p 80:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  ceitba-api:latest
```

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License

MIT License. See [LICENSE](LICENSE) for details.
