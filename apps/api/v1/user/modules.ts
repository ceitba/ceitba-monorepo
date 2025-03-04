import { UUID } from "crypto"

/**
 * Branch types available in the system
 */
export enum Branch {
    IT = "IT",
    MEDIA = "MEDIA",
    INFRA = "INFRA",
    DEPORTES = "DEPORTES",
    NAUTICA = "NAUTICA",
    EVENTOS = "EVENTOS",
    DIRECTIVOS = "DIRECTIVOS"
}

/**
 * Staff role types available in the system
 */
export enum StaffType {
    PRESIDENTE = "PRESIDENTE",
    VICEPRESIDENTE = "VICEPRESIDENTE",
    SECRETARIA = "SECRETARIA",
    TESORERIA = "TESORERIA",
    LIDER = "LIDER",
    MIEMBRO = "MIEMBRO"
}

/**
 * Represents a user in the system
 */
interface User {
    id: UUID
    email: string
    file_number?: number | null
    name?: string | null
    career_id?: string | null
    plan?: string | null
    role?: Role | null
    organizations?: Organization[] | null
}

/**
 * Represents an organization that a user belongs to
 */
interface Organization {
    organization_name: string
    role: string
}

/**
 * Represents a role that a user can have
 */
interface Role {
    branch: Branch | string
    role: StaffType | string
    start: Date
    end?: Date | null
}

export { User, Role, Organization }
