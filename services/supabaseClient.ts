import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabasePromise: Promise<SupabaseClient> | null = null;

async function initializeSupabase(): Promise<SupabaseClient> {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();

        if (!response.ok) {
            throw new Error(config.message || 'Failed to fetch Supabase configuration from server.');
        }

        const { supabaseUrl, supabaseAnonKey } = config;

        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Supabase URL and Anon Key are missing in the configuration provided by the server.");
        }
        
        return createClient(supabaseUrl, supabaseAnonKey);

    } catch (error) {
        console.error("Fatal error during Supabase client initialization:", error);
        // Re-throw to make it clear that the app cannot proceed without this.
        throw error;
    }
}

/**
 * Returns a promise that resolves to the singleton Supabase client instance.
 * The client is initialized asynchronously on the first call by fetching
 * configuration from the backend.
 */
export const getSupabase = (): Promise<SupabaseClient> => {
    if (!supabasePromise) {
        supabasePromise = initializeSupabase();
    }
    return supabasePromise;
};
