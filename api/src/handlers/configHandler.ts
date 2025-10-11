import { RequestHandler } from 'express';

export const handleConfig: RequestHandler = (req, res) => {
    // These variables are prefixed with VITE_ for convention, but are read from the server's environment.
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Server is missing Supabase environment variables required by the client.");
        return res.status(500).json({ message: "Server configuration error: Missing required keys." });
    }

    res.status(200).json({
        supabaseUrl,
        supabaseAnonKey
    });
};
