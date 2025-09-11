export enum DatabaseErrorCode {
    // Record not found
    NOT_FOUND = 'NOT_FOUND',
    
    // Constraint violations
    UNIQUE_VIOLATION = 'UNIQUE_VIOLATION',
    FOREIGN_KEY_VIOLATION = 'FOREIGN_KEY_VIOLATION',
    CHECK_VIOLATION = 'CHECK_VIOLATION',
    NOT_NULL_VIOLATION = 'NOT_NULL_VIOLATION',
    
    // Connection issues
    CONNECTION_ERROR = 'CONNECTION_ERROR',
    TIMEOUT = 'TIMEOUT',
    
    // Permission issues
    INSUFFICIENT_PRIVILEGE = 'INSUFFICIENT_PRIVILEGE',
    
    // Data issues
    INVALID_DATA_TYPE = 'INVALID_DATA_TYPE',
    DATA_TOO_LONG = 'DATA_TOO_LONG',
    
    // Generic errors
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR'
}

export class DatabaseErrorMapper {
    private static readonly SUPABASE_ERROR_MAP: Record<string, DatabaseErrorCode> = {
        // Supabase/PostgreSQL specific codes
        'PGRST116': DatabaseErrorCode.NOT_FOUND,           
        '23505': DatabaseErrorCode.UNIQUE_VIOLATION,       
        '23503': DatabaseErrorCode.FOREIGN_KEY_VIOLATION,  
        '23514': DatabaseErrorCode.CHECK_VIOLATION,        
        '23502': DatabaseErrorCode.NOT_NULL_VIOLATION,     
        '42501': DatabaseErrorCode.INSUFFICIENT_PRIVILEGE, 
        '22001': DatabaseErrorCode.DATA_TOO_LONG,          
        '22P02': DatabaseErrorCode.INVALID_DATA_TYPE,      
        '08000': DatabaseErrorCode.CONNECTION_ERROR,      
        '08006': DatabaseErrorCode.CONNECTION_ERROR,      
    };

    static mapErrorCode(dbSpecificCode: string): DatabaseErrorCode {
        return this.SUPABASE_ERROR_MAP[dbSpecificCode] || DatabaseErrorCode.UNKNOWN_ERROR;
    }

    static getErrorMessage(errorCode: DatabaseErrorCode, context?: string): string {
        const contextStr = context ? ` for ${context}` : '';
        
        switch (errorCode) {
            case DatabaseErrorCode.NOT_FOUND:
                return `Record not found${contextStr}`;
            case DatabaseErrorCode.UNIQUE_VIOLATION:
                return `A record with these values already exists${contextStr}`;
            case DatabaseErrorCode.FOREIGN_KEY_VIOLATION:
                return `Referenced record does not exist${contextStr}`;
            case DatabaseErrorCode.CHECK_VIOLATION:
                return `Data does not meet validation requirements${contextStr}`;
            case DatabaseErrorCode.NOT_NULL_VIOLATION:
                return `Required field is missing${contextStr}`;
            case DatabaseErrorCode.CONNECTION_ERROR:
                return `Database connection failed${contextStr}`;
            case DatabaseErrorCode.TIMEOUT:
                return `Database operation timed out${contextStr}`;
            case DatabaseErrorCode.INSUFFICIENT_PRIVILEGE:
                return `Insufficient permissions${contextStr}`;
            case DatabaseErrorCode.INVALID_DATA_TYPE:
                return `Invalid data format${contextStr}`;
            case DatabaseErrorCode.DATA_TOO_LONG:
                return `Data exceeds maximum length${contextStr}`;
            case DatabaseErrorCode.NETWORK_ERROR:
                return `Network error occurred${contextStr}`;
            case DatabaseErrorCode.UNKNOWN_ERROR:
            default:
                return `An unexpected error occurred${contextStr}`;
        }
    }
}

export class DatabaseError extends Error {
    constructor(
        public readonly code: DatabaseErrorCode,
        public readonly originalCode: string,
        message: string,
        public readonly context?: string,
        public readonly details?: any
    ) {
        super(message);
        this.name = 'DatabaseError';
    }

    static fromRawError(error: any, context?: string): DatabaseError {
        const originalCode = error.code || 'UNKNOWN';
        const standardCode = DatabaseErrorMapper.mapErrorCode(originalCode);
        const message = DatabaseErrorMapper.getErrorMessage(standardCode, context);

        return new DatabaseError(
            standardCode,
            originalCode,
            message,
            context,
            error
        );
    }

    is(errorCode: DatabaseErrorCode): boolean {
        return this.code === errorCode;
    }

    isNotFound(): boolean {
        return this.is(DatabaseErrorCode.NOT_FOUND);
    }

    isConstraintViolation(): boolean {
        return [
            DatabaseErrorCode.UNIQUE_VIOLATION,
            DatabaseErrorCode.FOREIGN_KEY_VIOLATION,
            DatabaseErrorCode.CHECK_VIOLATION,
            DatabaseErrorCode.NOT_NULL_VIOLATION
        ].includes(this.code);
    }

    isConnectionError(): boolean {
        return [
            DatabaseErrorCode.CONNECTION_ERROR,
            DatabaseErrorCode.TIMEOUT,
            DatabaseErrorCode.NETWORK_ERROR
        ].includes(this.code);
    }
}
