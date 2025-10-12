
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { handleProcessDocument, handleGetDocumentStatus, handleProcessChunk, handleExtractAndChunk } from './handlers/documentHandler';
import { handleChat } from './handlers/chatHandler';
import { handleQuiz } from './handlers/quizHandler';
import { handleFlashcards } from './handlers/flashcardsHandler';
import { handleConfig } from './handlers/configHandler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json() as any);

const asyncHandler = (fn: any): any => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Denis was here - trying to trigger a new build on Vercel

// API Routes
app.get('/api/config', asyncHandler(handleConfig));

// Asynchronous Document Processing Routes
app.post('/api/document/process', asyncHandler(handleProcessDocument));
app.post('/api/document/extract-and-chunk', asyncHandler(handleExtractAndChunk)); // Worker for Stage 1
app.post('/api/document/process-chunk', asyncHandler(handleProcessChunk)); // Worker for Stage 2
app.get('/api/document/status/:documentId', asyncHandler(handleGetDocumentStatus)); // Controller

// RAG Routes
app.post('/api/chat', asyncHandler(handleChat));
app.post('/api/quiz', asyncHandler(handleQuiz));
app.post('/api/flashcards', asyncHandler(handleFlashcards));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Export the app for serverless environments
export default app;