import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// Use the administrative service role key for all backend operations.
// This key is necessary as it bypasses Row-Level Security (RLS) policies,
// allowing the trusted server full access to the database for operations like insertions and updates.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase URL and Service Key must be provided in environment variables for the backend.');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);