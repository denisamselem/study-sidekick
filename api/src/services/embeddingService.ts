// This block is a workaround for the Vercel bundler.
// The bundler's static analysis needs to "see" the dependency to include it
// in the serverless function bundle. A dynamic import() on its own is not always detected.
// This `require` statement will never be executed due to the `if (false)` condition,
// but it is enough to signal the bundler to include the '@xenova/transformers' package.
if (false) {
    require('@xenova/transformers');
}


// The instance is a Promise that resolves to the pipeline itself.
// Use `any` to avoid a top-level import of an ES module, which causes issues in CommonJS.
let pipelinePromise: Promise<any> | null = null;

/**
 * Initializes and retrieves the singleton text embedding pipeline.
 * This ensures that the AI model is loaded only once per server instance,
 * saving memory and initialization time on subsequent requests.
 */
const getPipeline = (): Promise<any> => {
    if (pipelinePromise === null) {
        console.log('Dynamically importing @xenova/transformers and initializing embedding model...');
        // A dynamic import() is the correct way to load an ES Module from a CommonJS module.
        // We use string concatenation to "hide" the package name from the Vercel bundler's
        // static analysis, preventing it from incorrectly converting this to a `require` call.
        pipelinePromise = new Promise(async (resolve, reject) => {
            try {
                const { pipeline } = await import('@xenova/trans' + 'formers');

                // 2. Initialize the pipeline, which downloads the model on first run.
                const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

                console.log('Embedding model initialized successfully.');
                resolve(extractor);
            } catch (e) {
                console.error("Fatal: Failed to load or initialize the embedding model.", e);
                pipelinePromise = null; // Reset on failure to allow a subsequent retry.
                reject(e);
            }
        });
    }
    return pipelinePromise;
}


/**
 * Creates a vector embedding for a given text using a local, open-source model.
 * This is significantly faster and more reliable than using a remote generative API.
 * @param text The text to embed.
 * @returns A promise that resolves to a vector (array of numbers).
 */
export async function createEmbedding(text: string): Promise<number[]> {
    try {
        const extractor = await getPipeline();

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