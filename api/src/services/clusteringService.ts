/**
 * Simple k-means clustering for semantic sampling of vectors.
 */

type Vector = number[];

/**
 * Compute Euclidean distance between two vectors.
 */
function euclideanDistance(a: Vector, b: Vector): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

/**
 * Compute mean (centroid) of vectors.
 */
function computeMean(vectors: Vector[]): Vector {
    if (vectors.length === 0) return [];
    const dim = vectors[0].length;
    const mean: Vector = Array(dim).fill(0);
    for (const v of vectors) {
        for (let i = 0; i < dim; i++) {
            mean[i] += v[i];
        }
    }
    for (let i = 0; i < dim; i++) {
        mean[i] /= vectors.length;
    }
    return mean;
}

/**
 * K-means clustering of vectors.
 * Returns cluster assignments (indices into clusters array).
 */
export function kMeansClustering(
    vectors: Vector[],
    k: number,
    maxIterations: number = 10
): number[] {
    if (vectors.length === 0 || k <= 0) return [];
    if (k >= vectors.length) return vectors.map((_, i) => i); // One vector per cluster

    // Initialize centroids by random selection
    const centroids: Vector[] = [];
    const selectedIndices = new Set<number>();
    while (centroids.length < k) {
        const idx = Math.floor(Math.random() * vectors.length);
        if (!selectedIndices.has(idx)) {
            centroids.push([...vectors[idx]]);
            selectedIndices.add(idx);
        }
    }

    let assignments = vectors.map(() => 0);

    for (let iter = 0; iter < maxIterations; iter++) {
        // Assign each vector to nearest centroid
        const newAssignments = vectors.map((v) => {
            let minDist = Infinity;
            let cluster = 0;
            for (let i = 0; i < centroids.length; i++) {
                const dist = euclideanDistance(v, centroids[i]);
                if (dist < minDist) {
                    minDist = dist;
                    cluster = i;
                }
            }
            return cluster;
        });

        // Check convergence
        if (JSON.stringify(newAssignments) === JSON.stringify(assignments)) {
            break;
        }
        assignments = newAssignments;

        // Update centroids
        for (let c = 0; c < k; c++) {
            const clusterVectors = vectors.filter((_, i) => assignments[i] === c);
            if (clusterVectors.length > 0) {
                centroids[c] = computeMean(clusterVectors);
            }
        }
    }

    return assignments;
}

/**
 * Stratified sampling: sample N items evenly from clusters.
 */
export function stratifiedSample<T>(
    items: T[],
    clusterAssignments: number[],
    targetCount: number,
    k: number
): T[] {
    if (items.length === 0 || targetCount === 0) return [];

    // Group items by cluster
    const clusters: T[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < items.length; i++) {
        clusters[clusterAssignments[i]].push(items[i]);
    }

    // Sample evenly from each cluster
    const samplesPerCluster = Math.max(1, Math.ceil(targetCount / k));
    const result: T[] = [];

    for (const cluster of clusters) {
        const samplesToTake = Math.min(samplesPerCluster, cluster.length);
        for (let i = 0; i < samplesToTake && result.length < targetCount; i++) {
            result.push(cluster[i]);
        }
    }

    return result.slice(0, targetCount);
}
