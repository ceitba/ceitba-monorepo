import { DatabaseClient } from './database.interface';
import { SupabaseDatabaseClient } from './supabase.client';

// TODO: Check if this is a correct factory implementation
export class DatabaseFactory {
    private static instance: DatabaseClient | null = null;
    
    static create(): DatabaseClient {
        if (this.instance) {
            return this.instance;
        }
       
        // TODO: Change to PrismaDatabaseClient
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
        // TODO: Change to PrismaDatabaseClient
        return new SupabaseDatabaseClient();
    }
}
