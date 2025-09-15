import { DomainException } from '@/shared/exceptions';

export class CareerNotFoundException extends DomainException {
    constructor(careerId: string, cause?: Error) {
        super(`Career with ID '${careerId}' not found`, cause);
    }
}

export class SubjectNotFoundException extends DomainException {
    constructor(subjectId: string, cause?: Error) {
        super(`Subject with ID '${subjectId}' not found`, cause);
    }
}

export class SubjectPlanNotFoundException extends DomainException {
    constructor(planId: string, subjectId: string, cause?: Error) {
        super(`Subject plan not found for plan '${planId}' and subject '${subjectId}'`, cause);
    }
}

export class CareerAlreadyExistsException extends DomainException {
    constructor(careerId: string, cause?: Error) {
        super(`Career with ID '${careerId}' already exists`, cause);
    }
}

export class ForeignKeyConstraintViolationException extends DomainException {
    constructor(entity: string, cause?: Error) {
        super(`Operation failed due to foreign key constraint on '${entity}'`, cause);
    }
}

export class SubjectAlreadyExistsException extends DomainException {
    constructor(subjectId: string, cause?: Error) {
        super(`Subject with ID '${subjectId}' already exists`, cause);
    }
}

export class SubjectPlanDependencyException extends DomainException {
    constructor(subjectId: string, missingDependencies: string[], cause?: Error) {
        super(
            `Subject '${subjectId}' has unmet dependencies: ${missingDependencies.join(', ')}`, 
            cause
        );
    }
}
