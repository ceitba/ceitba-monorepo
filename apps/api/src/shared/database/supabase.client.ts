import { 
    DatabaseClient, 
    DatabaseResult,
    QueryOptions,
    InsertOptions,
    UpdateOptions,
    DeleteOptions,
    JoinOptions
} from './database.interface';
import { DatabaseError } from './database-errors';
import supabase from '../config/supabase';

export class SupabaseDatabaseClient implements DatabaseClient {
    async select<T>(table: string, options: QueryOptions = {}): Promise<DatabaseResult<T[]>> {
        try {
            // Build select string with joins (Supabase-specific syntax)
            const selectString = this.buildSelectString(options);
            let query = supabase.from(table).select(selectString);
            
            // Apply filters
            if (options.eq) {
                Object.entries(options.eq).forEach(([key, value]) => {
                    query = query.eq(key, value);
                });
            }
            
            if (options.in) {
                Object.entries(options.in).forEach(([key, values]) => {
                    query = query.in(key, values);
                });
            }
            
            if (options.like) {
                Object.entries(options.like).forEach(([key, pattern]) => {
                    query = query.like(key, pattern);
                });
            }
            
            if (options.ilike) {
                Object.entries(options.ilike).forEach(([key, pattern]) => {
                    query = query.ilike(key, pattern);
                });
            }
            
            if (options.is) {
                Object.entries(options.is).forEach(([key, value]) => {
                    query = query.is(key, value);
                });
            }
            
            // Apply ordering
            if (options.orderBy) {
                query = query.order(options.orderBy.column, { 
                    ascending: options.orderBy.ascending ?? true 
                });
            }
            
            // Apply pagination
            if (options.limit) {
                query = query.limit(options.limit);
            }
            
            if (options.offset) {
                query = query.range(options.offset, options.offset + (options.limit || 1000) - 1);
            }
            
            const { data, error } = await query;
            
            return {
                data: data as T[],
                error: error ? this.mapSupabaseError(error, `selecting from ${table}`) : null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapGenericError(error as Error, `selecting from ${table}`)
            };
        }
    }
    
    async selectOne<T>(table: string, options: QueryOptions = {}): Promise<DatabaseResult<T>> {
        const result = await this.select<T>(table, { ...options, single: true });
        
        if (result.error) {
            return {
                data: null,
                error: result.error
            };
        }
        
        const data = result.data && result.data.length > 0 ? result.data[0] : null;
        
        return {
            data,
            error: null
        };
    }
    
    async insert<T>(table: string, options: InsertOptions<T>): Promise<DatabaseResult<T | T[]>> {
        try {
            const baseQuery = supabase.from(table).insert(options.data as any);
            
            const { data, error } = options.returning !== false 
                ? await baseQuery.select()
                : await baseQuery;
            
            if (error) {
                return {
                    data: null,
                    error: this.mapSupabaseError(error, `inserting into ${table}`)
                };
            }
            
            // Return single item if input was single item, array if input was array
            const result = Array.isArray(options.data) ? data : (data?.[0] || null);
            
            return {
                data: result as T | T[],
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapGenericError(error as Error, `inserting into ${table}`)
            };
        }
    }
    
    async update<T>(table: string, options: UpdateOptions<T>): Promise<DatabaseResult<T | T[]>> {
        try {
            let query = supabase.from(table).update(options.data as any);
            
            // Apply where conditions
            Object.entries(options.where).forEach(([key, value]) => {
                query = query.eq(key, value);
            });
            
            const { data, error } = options.returning !== false 
                ? await query.select()
                : await query;
            
            return {
                data: data as T | T[],
                error: error ? this.mapSupabaseError(error, `updating ${table}`) : null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapGenericError(error as Error, `updating ${table}`)
            };
        }
    }
    
    async delete(table: string, options: DeleteOptions): Promise<DatabaseResult<void>> {
        try {
            let query = supabase.from(table).delete();
            
            // Apply where conditions
            Object.entries(options.where).forEach(([key, value]) => {
                query = query.eq(key, value);
            });
            
            const { error } = await query;
            
            return {
                data: null,
                error: error ? this.mapSupabaseError(error, `deleting from ${table}`) : null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapGenericError(error as Error, `deleting from ${table}`)
            };
        }
    }
    
    async rpc<T>(functionName: string, params: Record<string, any> = {}): Promise<DatabaseResult<T>> {
        try {
            const { data, error } = await supabase.rpc(functionName, params);
            
            return {
                data: data as T,
                error: error ? this.mapSupabaseError(error, `calling RPC ${functionName}`) : null
            };
        } catch (error) {
            return {
                data: null,
                error: this.mapGenericError(error as Error, `calling RPC ${functionName}`)
            };
        }
    }
    
    async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
        return callback(this);
    }
    
    private mapSupabaseError(error: any, context?: string): DatabaseError {
        return DatabaseError.fromRawError(error, context);
    }
    
    private mapGenericError(error: Error, context?: string): DatabaseError {
        return DatabaseError.fromRawError(error, context);
    }

    private buildSelectString(options: QueryOptions): string {
        let selectString = options.select || '*';
        
        if (options.joins && options.joins.length > 0) {
            const joinStrings = options.joins.map(join => {
                const alias = join.alias || join.table;
                const selectFields = join.select || 'id, name';
                return `${alias} (${selectFields})`;
            });
            
            if (selectString === '*') {
                selectString = `*, ${joinStrings.join(', ')}`;
            } else {
                selectString = `${selectString}, ${joinStrings.join(', ')}`;
            }
        }
        
        return selectString;
    }
}
