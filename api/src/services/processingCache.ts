import { supabase } from '../lib/supabase';

interface JobData {
    documentId: string;
    chunks: string[];
    filePath: string;
}

const JOBS_TABLE = 'processing_jobs';

/**
 * Stores the chunks and metadata for a processing job in Supabase.
 * @param jobId A unique identifier for the job.
 * @param data The job data including chunks and document ID.
 */
export async function storeJob(jobId: string, data: JobData): Promise<void> {
    const { error } = await supabase
        .from(JOBS_TABLE)
        .insert({
            id: jobId,
            document_id: data.documentId,
            chunks: data.chunks,
            file_path: data.filePath
        });

    if (error) {
        console.error(`Failed to store job ${jobId} in Supabase:`, error);
        throw new Error('Could not store processing job.');
    }
}

/**
 * Retrieves the data for a specific job from Supabase.
 * @param jobId The ID of the job to retrieve.
 * @returns The job data, or null if not found.
 */
export async function getJob(jobId: string): Promise<JobData | null> {
    const { data, error } = await supabase
        .from(JOBS_TABLE)
        .select('document_id, chunks, file_path')
        .eq('id', jobId)
        .single();

    if (error) {
        // "PGRST116" is the Supabase code for "0 rows returned" when using .single()
        if (error.code === 'PGRST116') {
            return null;
        }
        console.error(`Failed to retrieve job ${jobId} from Supabase:`, error);
        throw new Error('Could not retrieve processing job.');
    }
    
    if (!data) return null;

    return {
        documentId: data.document_id,
        chunks: data.chunks,
        filePath: data.file_path
    };
}

/**
 * Deletes a job from Supabase, typically after it's completed.
 * @param jobId The ID of the job to delete.
 */
export async function deleteJob(jobId: string): Promise<void> {
    const { error } = await supabase
        .from(JOBS_TABLE)
        .delete()
        .eq('id', jobId);

    if (error) {
        // Log the error but don't throw, as failing to delete is not critical for the user flow.
        console.warn(`Failed to delete job ${jobId} from Supabase:`, error.message);
    }
}
