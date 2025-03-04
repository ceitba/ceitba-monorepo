import supabase from "../config/supabase";

const getStaffMembers = async (): Promise<{ staff: any[], error: string | null }> => {
    const { data, error } = await supabase.rpc('get_staff_members');
    if (error) {
        return { staff: [], error: error.message };
    }
    return { staff: data, error: null };
};


export { getStaffMembers };