export abstract class DomainException extends Error {
    constructor(message: string, public readonly cause?: Error) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class GenericDomainException extends DomainException {
    constructor(message: string, cause?: Error) {
        super(message, cause);
    }
}

export class ExternalApiException extends DomainException {
    constructor(service: string, operation: string, cause?: Error) {
        super(`External API error in ${service} during ${operation}`, cause);
    }
}

export class DatabaseOperationException extends DomainException {
    constructor(operation: string, cause?: Error) {
        super(`Database operation failed: ${operation}`, cause);
    }
}

export class ValidationException extends DomainException {
    constructor(field: string, value: any, reason: string, cause?: Error) {
        super(`Validation failed for field '${field}' with value '${value}': ${reason}`, cause);
    }
}

export class ResourceNotFoundException extends DomainException {
    constructor(resource: string, identifier: string, cause?: Error) {
        super(`${resource} with identifier '${identifier}' not found`, cause);
    }
}

export class ResourceAlreadyExistsException extends DomainException {
    constructor(resource: string, identifier: string, cause?: Error) {
        super(`${resource} with identifier '${identifier}' already exists`, cause);
    }
}
