import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase URL and Anon Key are required. Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set in your project's environment variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);