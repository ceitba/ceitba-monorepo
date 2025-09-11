import { DatabaseError } from './database-errors';

export interface DatabaseResult<T> {
    data: T | null;
    error: DatabaseError | null;
}

export interface JoinOptions {
    table: string;
    foreignKey: string;
    select?: string;
    alias?: string;
}

export interface QueryOptions {
    select?: string;
    eq?: Record<string, any>;
    in?: Record<string, any[]>;
    like?: Record<string, string>;
    ilike?: Record<string, string>;
    is?: Record<string, null>;
    single?: boolean;
    limit?: number;
    offset?: number;
    orderBy?: {
        column: string;
        ascending?: boolean;
    };
    joins?: JoinOptions[];
}

export interface InsertOptions<T> {
    data: T | T[];
    returning?: boolean;
}

export interface UpdateOptions<T> {
    data: Partial<T>;
    where: Record<string, any>;
    returning?: boolean;
}

export interface DeleteOptions {
    where: Record<string, any>;
}

export interface DatabaseClient {
    // Query operations
    select<T>(table: string, options?: QueryOptions): Promise<DatabaseResult<T[]>>;
    selectOne<T>(table: string, options?: QueryOptions): Promise<DatabaseResult<T>>;
    
    // Mutation operations
    insert<T>(table: string, options: InsertOptions<T>): Promise<DatabaseResult<T | T[]>>;
    update<T>(table: string, options: UpdateOptions<T>): Promise<DatabaseResult<T | T[]>>;
    delete(table: string, options: DeleteOptions): Promise<DatabaseResult<void>>;
    
    // RPC (Remote Procedure Call) for stored procedures/functions
    rpc<T>(functionName: string, params?: Record<string, any>): Promise<DatabaseResult<T>>;
    
    // Transaction support
    transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T>;
}
