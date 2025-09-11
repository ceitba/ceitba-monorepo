import { DatabaseClient } from './database.interface';
import { SupabaseDatabaseClient } from './supabase.client';

export class DatabaseFactory {
    private static instance: DatabaseClient | null = null;
    
    static create(): DatabaseClient {
        if (this.instance) {
            return this.instance;
        }
        
        this.instance = new SupabaseDatabaseClient();
        return this.instance;
    }
    
    static getInstance(): DatabaseClient {
        if (!this.instance) {
            return this.create();
        }
        return this.instance;
    }
    
    static reset(): void {
        this.instance = null;
    }
    
    static createNew(): DatabaseClient {
        return new SupabaseDatabaseClient();
    }
}
