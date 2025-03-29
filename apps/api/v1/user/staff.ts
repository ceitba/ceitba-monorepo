import supabase from "../config/supabase";

const getStaffMembers = async (): Promise<{ staff: any[], error: string | null }> => {
    const { data, error } = await supabase.rpc('get_staff_members');
    if (error) {
        return { staff: [], error: error.message };
    }
    return { staff: data, error: null };
};

const getSignatureData = async (file_number: number): Promise<{data: any[], error: string | null}> => {
    const { data, error } = await supabase.rpc('get_signature_data', { filenum: file_number })
    if (error){
        return { data: [], error: error.message };
    }
    return { data: data, error: null };
}


export { getStaffMembers, getSignatureData };