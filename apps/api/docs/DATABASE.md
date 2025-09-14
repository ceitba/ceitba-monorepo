# Database Setup Guide

This guide covers the database setup for the CEITBA API, including both local development with PostgreSQL and the transition away from Supabase.

## Quick Start

### 1. Start Local Database
```bash
# Start PostgreSQL container
npm run docker:db:up

# Or with docker-compose directly
docker-compose up postgres -d
```

### 2. Generate Prisma Client & Run Migrations
```bash
# Generate Prisma client
npm run db:generate

# Run migrations (creates tables)
npm run db:migrate

# Seed the database with sample data
npm run db:seed
```

### 3. Start Development Server
```bash
# Start the API (connects to local PostgreSQL)
npm run dev

# Or with Docker (includes database)
npm run docker:dev
```

## Database Commands

### Development Workflow
```bash
# Generate Prisma client after schema changes
npm run db:generate

# Create and apply new migration
npm run db:migrate

# Seed database with sample data
npm run db:seed

# Reset database (drops all data and re-runs migrations)
npm run db:reset

# Push schema changes without migration (for prototyping)
npm run db:push

# Open Prisma Studio (database GUI)
npm run db:studio
```

### Docker Commands
```bash
# Start only the database
npm run docker:db:up

# Stop the database
npm run docker:db:down

# Start full development environment
npm run docker:dev

# View application logs
npm run docker:logs
```

## Database Configuration

### Environment Variables
Create a `.env` file with:

```env
# Local PostgreSQL (for development)
DATABASE_URL="postgresql://ceitba_user:ceitba_password@localhost:5432/ceitba_db"

# Supabase (legacy - being phased out)
SUPABASE_ACCESS_TOKEN="your_supabase_token"
```

### Database Selection
The application automatically selects the database based on environment variables:
- If `DATABASE_URL` is set → Uses PostgreSQL with Prisma
- If `SUPABASE_ACCESS_TOKEN` is set → Uses Supabase (legacy)
- Default → PostgreSQL with Prisma

## Migration from Supabase

### Why Move Away from Supabase?
1. **Version Control**: Database schema changes are hard to track
2. **Deployment Management**: Complex to manage across environments
3. **Local Development**: Requires internet connection and shared database
4. **Cost Control**: Better control over infrastructure costs
5. **Performance**: Direct PostgreSQL connection is faster

### Migration Steps
1. **Export Supabase Data** (if needed):
   ```bash
   # Export from Supabase dashboard or use their CLI
   supabase db dump --file backup.sql
   ```

2. **Update Environment Variables**:
   - Remove `SUPABASE_ACCESS_TOKEN`
   - Add `DATABASE_URL` for PostgreSQL

3. **Run Database Setup**:
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. **Test Application**:
   - The database factory automatically switches to PostgreSQL
   - All existing code continues to work unchanged

## Database Schema

### Current Tables
- `users`: User management with social media links and preferences
- `proposals`: Community proposals with status tracking

### Adding New Tables
1. Update `prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Update seed file if needed
4. Add to Prisma client mapping in `prisma.client.ts`

## Seeding System

### Default Seeds
The seeding system creates:
- **3 Users**: Admin, regular student, and moderator
- **5 Proposals**: Various states (OPEN, ACCEPTED, DENIED)

### Custom Seeds
Modify `prisma/seed.ts` to add your own data:

```typescript
// Add custom users
const customUser = await prisma.user.create({
  data: {
    email: 'custom@example.com',
    discord: 'custom#1234',
    // ... other fields
  },
});

// Add custom proposals
await prisma.proposal.create({
  data: {
    title: 'My Custom Proposal',
    description: 'Description here',
    userId: customUser.id,
  },
});
```

## Production Deployment

### Database Migration
```bash
# Deploy migrations to production
npm run db:migrate:prod
```

### Environment Setup
1. Set up PostgreSQL instance (AWS RDS, Google Cloud SQL, etc.)
2. Configure `DATABASE_URL` with production credentials
3. Run migrations and optionally seed data

### Docker Production
The production Docker setup doesn't include a database container. You'll need:
1. External PostgreSQL instance
2. `DATABASE_URL` pointing to production database
3. Migration run during deployment

## Troubleshooting

### Common Issues

**Prisma Client Not Found**:
```bash
npm run db:generate
```

**Migration Errors**:
```bash
# Reset and start fresh (CAUTION: Deletes all data)
npm run db:reset
```

**Connection Refused**:
- Ensure PostgreSQL container is running: `npm run docker:db:up`
- Check DATABASE_URL in .env file

**Seeding Fails**:
- Ensure migrations have run: `npm run db:migrate`
- Check for unique constraint violations in seed data

### Database GUI
Use Prisma Studio for a visual interface:
```bash
npm run db:studio
# Opens at http://localhost:5555
```

## Next Steps

1. **Remove Supabase Dependencies**: Once fully migrated, remove `@supabase/supabase-js` and related files
2. **Add More Tables**: Extend the schema based on your application needs
3. **Set Up Backups**: Implement regular database backups for production
4. **Performance Monitoring**: Add database query monitoring and optimization
