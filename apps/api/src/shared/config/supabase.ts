import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.SUPABASE_ACCESS_TOKEN) {
    throw new Error('Missing Supabase access token');
}

const supabase = createClient(
    "https://yafawebqzogkzwhxojbh.supabase.co",
    process.env.SUPABASE_ACCESS_TOKEN
);

export default supabase; 