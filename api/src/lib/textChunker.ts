
// A simple text chunker. For a real-world application, you might want a more sophisticated
// "semantic" chunker that splits based on paragraphs or sections.
export function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
        const end = Math.min(i + chunkSize, text.length);
        chunks.push(text.slice(i, end));
        i += chunkSize - overlap;
        if (i < 0) i = end; // Ensure forward progress if overlap > chunkSize
    }
    return chunks;
}
