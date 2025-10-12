

/**
 * A singleton class to manage the text embedding pipeline.
 * This ensures that the AI model is loaded only once per server instance,
 * saving memory and initialization time on subsequent requests.
 */
class EmbeddingPipeline {
    // FIX: Explicitly type `task` as a string literal to match the expected `PipelineType`.
    static task: 'feature-extraction' = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    // The instance is a Promise that resolves to the pipeline itself.
    // Use `any` to avoid a top-level import of an ES module, which causes issues in CommonJS.
    static instance: Promise<any> | null = null;

    static async getInstance(): Promise<any> {
        if (this.instance === null) {
            console.log('Dynamically importing @xenova/transformers and initializing embedding model...');
            // Use a dynamic import() which is compatible with CommonJS environments like Vercel's Node.js runtime.
            this.instance = new Promise(async (resolve, reject) => {
                try {
                    // 1. Dynamically import the library
                    const { pipeline } = await import('@xenova/transformers');
                    // 2. Initialize the pipeline, which downloads the model on first run.
                    const extractor = await pipeline(this.task, this.model);
                    console.log('Embedding model initialized successfully.');
                    resolve(extractor);
                } catch (e) {
                    console.error("Fatal: Failed to load or initialize the embedding model.", e);
                    this.instance = null; // Reset on failure to allow a subsequent retry.
                    reject(e);
                }
            });
        }
        return this.instance;
    }
}

/**
 * Creates a vector embedding for a given text using a local, open-source model.
 * This is significantly faster and more reliable than using a remote generative API.
 * @param text The text to embed.
 * @returns A promise that resolves to a vector (array of numbers).
 */
export async function createEmbedding(text: string): Promise<number[]> {
    try {
        const extractor = await EmbeddingPipeline.getInstance();

        // Compute the embedding. The model runs locally, processing the text in milliseconds.
        const output = await extractor(text, {
            pooling: 'mean',
            normalize: true,
        });

        // Convert the tensor data to a standard JavaScript array.
        return Array.from(output.data);
    } catch (error) {
        console.error(`Failed to create embedding for text: "${text.substring(0, 100)}..."`, error);
        // Re-throw the error to be handled by the calling function (e.g., to mark a chunk as FAILED).
        throw error;
    }
}