
import { pipeline, Pipeline } from '@xenova/transformers';

/**
 * A singleton class to manage the text embedding pipeline.
 * This ensures that the AI model is loaded only once per server instance,
 * saving memory and initialization time on subsequent requests.
 */
class EmbeddingPipeline {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance: Promise<Pipeline> | null = null;

    static async getInstance() {
        if (this.instance === null) {
            // The pipeline function will download and cache the model on the first run.
            console.log('Initializing embedding model for the first time...');
            this.instance = pipeline(this.task, this.model);
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
