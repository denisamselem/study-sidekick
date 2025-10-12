// A simple in-memory cache for managing chunking jobs.
// NOTE: This is suitable for a single-server-instance environment. In a scaled-out
// serverless environment, a distributed cache like Redis or a database would be needed.

interface JobData {
    documentId: string;
    chunks: string[];
    filePath: string;
}

const jobCache = new Map<string, JobData>();

/**
 * Stores the chunks and metadata for a processing job.
 * @param jobId A unique identifier for the job.
 * @param data The job data including chunks and document ID.
 */
export function storeJob(jobId: string, data: JobData) {
    jobCache.set(jobId, data);
    // Set a timeout to automatically clean up stale jobs after 30 minutes.
    setTimeout(() => {
        if (jobCache.has(jobId)) {
            console.warn(`Job ${jobId} expired and was automatically removed from cache.`);
            jobCache.delete(jobId);
        }
    }, 1000 * 60 * 30);
}

/**
 * Retrieves the data for a specific job.
 * @param jobId The ID of the job to retrieve.
 * @returns The job data, or undefined if not found.
 */
export function getJob(jobId: string): JobData | undefined {
    return jobCache.get(jobId);
}

/**
 * Deletes a job from the cache, typically after it's completed.
 * @param jobId The ID of the job to delete.
 */
export function deleteJob(jobId: string) {
    jobCache.delete(jobId);
}