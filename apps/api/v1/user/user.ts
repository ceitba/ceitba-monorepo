import supabase from "../../src/shared/config/supabase";
import { Role, User, Organization } from "./modules"

/**
 * Retrieves a user by their email address using a single database query
 * @param email The email address of the user to retrieve
 * @returns A Promise that resolves to the User object or null if not found
 */
const getUserByEmail = async (email: string): Promise<User | null> => {
    try {
        const { data, error } = await supabase.rpc('get_user_with_details', { email_param: email });

        if (error) {
            console.error('RPC error:', error);
            if (error.message.includes('User not found')) {
                return null;
            }
            throw new Error(error.message);
        }
        
        if (!data || !data.id) {
            return null;
        }

        const user: User = {
            id: data.id,
            email: data.email,
            file_number: data.file_number,
            name: data.name,
            career_id: data.career_id,
            plan: data.plan,
            role: data.role ? {
                branch: data.role.branch,
                role: data.role.role,
                start: new Date(data.role.start),
                end: data.role.end ? new Date(data.role.end) : null
            } : null,
            organizations: data.organizations ? 
                data.organizations.map((org: { organization_name: string; role: string }) => ({
                    organization_name: org.organization_name,
                    role: org.role
                })) 
                : null
        };

        return user;
    } catch (e) {
        console.error('getUserByEmail error:', e);
        // Don't crash the API, just return null
        return null;
    }
}

/**
 * Updates a user's role information
 * @param email The email address of the user to update
 * @param role The new role information to assign to the user
 * @returns A Promise that resolves to true if successful, or an error message if failed
 */
const updateUserRole = async (email: string, role: Role): Promise<{ success: boolean, message?: string }> => {
    try {
        const { data, error } = await supabase.rpc('update_user_role', {
            email_param: email,
            branch_param: role.branch,
            role_param: role.role,
            start_param: role.start,
            end_param: role.end
        });

        if (error) {
            console.error('RPC error:', error);
            return { 
                success: false, 
                message: error.message 
            };
        }

        
        return { success: true };
    } catch (e) {
        console.error('updateUserRole error:', e);
        return { 
            success: false, 
            message: e instanceof Error ? e.message : 'Unknown error occurred' 
        };
    }
}

/**
 * Creates a new user record
 * @param email The email address of the user
 * @param userData Additional user data
 * @returns A Promise that resolves to the created User object or an error object
 */
const createUser = async (email: string, userData: {
    file_number?: number;
    name?: string;
    career_id?: string;
    plan?: string;
}): Promise<User | { error: string }> => {
    try {
        const { data, error } = await supabase.rpc('create_user', {
            email_param: email,
            file_number_param: userData.file_number || null,
            name_param: userData.name || null,
            career_id_param: userData.career_id || null,
            plan_param: userData.plan || null
        });
        
        if (error) {
            console.error('RPC error:', error);
            return { error: error.message };
        }
        
        if (!data || !data.id) {
            return { error: "Failed to create user" };
        }
        
        return {
            id: data.id,
            email: data.email,
            file_number: data.file_number,
            name: data.name,
            career_id: data.career_id,
            plan: data.plan,
            role: null,
            organizations: null
        };
    } catch (e) {
        console.error('createUser error:', e);
        return { error: e instanceof Error ? e.message : 'Unknown error occurred' };
    }
};

// Ver si queremos obtener tambien por ejemplo los mails necesitamos auth.users
const getAllUsers = async (): Promise<{ users: any[], error: string | null }> => {
    const { data, error } = await supabase.rpc('get_all_users');
    if (error) {
        return { users: [], error: error.message };
    }
    
    return { users: data || [], error: null };
}

export { getUserByEmail, updateUserRole, createUser, getAllUsers };
