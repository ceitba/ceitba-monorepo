import { 
    DatabaseClient, 
    DatabaseResult,
    QueryOptions,
    InsertOptions,
    UpdateOptions,
    DeleteOptions
} from '@/shared/database/database.interface';
import { DatabaseError } from '@/shared/database/database-errors';
import { PrismaClient } from '@prisma/client';

export class PrismaDatabaseClient implements DatabaseClient {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = new PrismaClient({
            log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
    }

    async select<T>(table: string, options: QueryOptions = {}): Promise<DatabaseResult<T[]>> {
        try {
            const model = this.getModel(table);
            
            const where = this.buildWhereClause(options);
            
            const queryOptions: any = {
                where,
                ...(options.select && { select: this.parseSelectString(options.select) }),
                ...(options.limit && { take: options.limit }),
                ...(options.offset && { skip: options.offset }),
                ...(options.orderBy && { 
                    orderBy: { 
                        [options.orderBy.column]: options.orderBy.ascending !== false ? 'asc' : 'desc' 
                    } 
                }),
            };

            const data = await model.findMany(queryOptions);
            
            return {
                data: data as T[],
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapPrismaError(error as Error, `selecting from ${table}`)
            };
        }
    }

    async selectOne<T>(table: string, options: QueryOptions = {}): Promise<DatabaseResult<T>> {
        try {
            const model = this.getModel(table);
            
            const where = this.buildWhereClause(options);
            
            const queryOptions: any = {
                where,
                ...(options.select && { select: this.parseSelectString(options.select) }),
            };

            const data = await model.findFirst(queryOptions);
            
            return {
                data: data as T,
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapPrismaError(error as Error, `selecting one from ${table}`)
            };
        }
    }

    async insert<T>(table: string, options: InsertOptions<T>): Promise<DatabaseResult<T | T[]>> {
        try {
            const model = this.getModel(table);
            
            if (Array.isArray(options.data)) {
                const data = await model.createMany({
                    data: options.data,
                    skipDuplicates: false
                });
                
                return {
                    data: data as T | T[],
                    error: null
                };
            } else {
                const data = await model.create({
                    data: options.data
                });
                
                return {
                    data: data as T,
                    error: null
                };
            }
        } catch (error) {
            return {
                data: null,
                error: this.mapPrismaError(error as Error, `inserting into ${table}`)
            };
        }
    }

    async update<T>(table: string, options: UpdateOptions<T>): Promise<DatabaseResult<T | T[]>> {
        try {
            const model = this.getModel(table);
            
            const where = this.buildWhereClause({ eq: options.where });
            
            const data = await model.updateMany({
                where,
                data: options.data
            });
            
            return {
                data: data as T | T[],
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapPrismaError(error as Error, `updating ${table}`)
            };
        }
    }

    async delete(table: string, options: DeleteOptions): Promise<DatabaseResult<void>> {
        try {
            const model = this.getModel(table);
            
            const where = this.buildWhereClause({ eq: options.where });
            
            await model.deleteMany({
                where
            });
            
            return {
                data: null,
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapPrismaError(error as Error, `deleting from ${table}`)
            };
        }
    }

    async rpc<T>(functionName: string, params: Record<string, any> = {}): Promise<DatabaseResult<T>> {
        try {
            // For raw SQL functions, use Prisma's raw query capability
            const result = await this.prisma.$queryRaw`SELECT ${functionName}(${params})`;
            
            return {
                data: result as T,
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapPrismaError(error as Error, `calling function ${functionName}`)
            };
        }
    }

    async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(async (prismaTransaction: PrismaClient) => {
            const transactionClient = new PrismaDatabaseClient();
            // TODO: Fix this with transaction client
            (transactionClient as any).prisma = prismaTransaction;
            return callback(transactionClient);
        });
    }

    private getModel(table: string): any {
        const modelMap: Record<string, any> = {
            users: this.prisma.user,
            proposals: this.prisma.proposal,
        };

        const model = modelMap[table];
        if (!model) {
            throw new Error(`Unknown table: ${table}`);
        }

        return model;
    }

    private buildWhereClause(options: QueryOptions): any {
        const where: any = {};

        if (options.eq) {
            Object.assign(where, options.eq);
        }

        if (options.in) {
            Object.entries(options.in).forEach(([key, values]) => {
                where[key] = { in: values };
            });
        }

        if (options.like) {
            Object.entries(options.like).forEach(([key, pattern]) => {
                where[key] = { contains: pattern.replace('%', '') };
            });
        }

        if (options.ilike) {
            Object.entries(options.ilike).forEach(([key, pattern]) => {
                where[key] = { contains: pattern.replace('%', ''), mode: 'insensitive' };
            });
        }

        if (options.is) {
            Object.entries(options.is).forEach(([key, value]) => {
                where[key] = value;
            });
        }

        return where;
    }

    private parseSelectString(select: string): Record<string, boolean> {
        if (select === '*') return {};
        
        const fields = select.split(',').map(field => field.trim());
        const selectObject: Record<string, boolean> = {};
        
        fields.forEach(field => {
            selectObject[field] = true;
        });
        
        return selectObject;
    }

    private mapPrismaError(error: Error, context?: string): DatabaseError {
        return DatabaseError.fromRawError(error, context);
    }

    async disconnect(): Promise<void> {
        await this.prisma.$disconnect();
    }
}
