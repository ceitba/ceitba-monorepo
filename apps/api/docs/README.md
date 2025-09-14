# CEITBA API Documentation

## Overview

CEITBA API is a NestJS-based REST API for managing ITBA (Instituto Tecnológico de Buenos Aires).

## Architecture

### Domain-Driven Design Structure

```
src/
├── domain/                 # Domain Layer (Business Logic)
│   ├── user/              # User Domain
│   │   ├── models/        # Domain Entities
│   │   ├── interfaces/    # Repository & Service Contracts
│   │   ├── services/      # Domain Services
│   │   └── repositories/  # Repository Implementations
│   └── itba/              # ITBA Academic Domain
│       ├── models/        # Academic Entities (Career, Subject, etc.)
│       ├── interfaces/    # Contracts
│       ├── services/      # Academic Services
│       └── repositories/  # Repository Implementations
├── presentation/          # Presentation Layer
│   └── v1/
│       ├── controllers/   # NestJS Controllers
│       ├── dto/          # Data Transfer Objects
│       └── modules/      # NestJS Modules
├── shared/               # Shared Infrastructure
│   ├── database/         # Database Configuration
│   ├── exceptions/       # Domain Exceptions
│   ├── external-apis/    # External API Clients
│   ├── mappers/         # Entity-DTO Mappers
│   └── types/           # Type Definitions
└── main.ts              # NestJS Bootstrap
```

### Key Principles

- **Clean Architecture**: Clear separation of concerns
- **Dependency Injection**: NestJS IoC container
- **SOLID Principles**: Single responsibility, Open/closed, etc.
- **Repository Pattern**: Data access abstraction
- **Domain Services**: Business logic encapsulation

## Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL
- npm or yarn
- docker (desired)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd CEITBA-API

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Database setup
npm run db:migrate
npm run db:seed

# Start development
npm run start:dev
```

### Available Scripts

```bash
npm run start:dev      # Development mode with hot reload
npm run start:debug    # Debug mode
npm run build          # Production build
npm run start:prod     # Production mode
npm run test           # Run tests
npm run test:watch     # Tests in watch mode
npm run test:cov       # Test coverage
```

## API Documentation

### Swagger/OpenAPI

The API documentation is automatically generated from code decorators and available at:

- **Development**: http://localhost:3000/api/docs
- **Production**: https://your-domain.com/api/docs

### API Endpoints

#### Health Check
- `GET /api/` - API status
- `GET /api/health` - Detailed health information

#### User Management
- `GET /api/v1/users` - Get all users
- `POST /api/v1/users/create` - Create new user

#### ITBA Academic Data
- `GET /api/v1/itba/careers` - Get all careers
- `GET /api/v1/itba/careers/plans` - Get careers with plans
- `GET /api/v1/itba/classrooms` - Get classroom information
- `GET /api/v1/itba/subject-plans/plan/:planId/subjects` - Get subjects by plan

## Development

### Adding New Features

1. **Domain Layer**: Create models, interfaces, and services
2. **Infrastructure**: Implement repositories
3. **Presentation**: Add controllers with DTOs
4. **Module**: Wire dependencies in NestJS modules

### Code Style

- Use TypeScript strict mode
- Follow NestJS conventions
- Implement proper error handling
- Add comprehensive tests
- Document with JSDoc comments

### Database

- **ORM**: Prisma
- **Database**: PostgreSQL
- **Migrations**: `npm run db:migrate`
- **Seeding**: `npm run db:seed`

## Testing

```bash
npm run test           # Unit tests
npm run test:e2e       # End-to-end tests
npm run test:cov       # Coverage report
```

## Deployment

### Docker

```bash
npm run docker:prod    # Production container
npm run docker:dev     # Development container
```

### Environment Variables

Required environment variables:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/ceitba
ITBA_API_TOKEN=your_token
ITBA_API_BASE_URL=https://api.itba.edu.ar
SUPABASE_ACCESS_TOKEN=your_token
```

## Contributing

1. Follow the existing architecture patterns
2. Write tests for new features
3. Update documentation
4. Follow conventional commits
5. Ensure all tests pass

## Troubleshooting

### Common Issues

1. **Port already in use**: Change PORT in .env
2. **Database connection**: Check DATABASE_URL
3. **Missing dependencies**: Run `npm install`
4. **Build errors**: Check TypeScript configuration

### Support

- Check existing GitHub issues
- Review API documentation
- Contact development team

