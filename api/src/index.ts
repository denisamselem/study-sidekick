
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { handleProcessTextDocument, handleGetDocumentStatus, handleProcessChunk } from './handlers/documentHandler.js';
import { handleChat } from './handlers/chatHandler.js';
import { handleQuiz } from './handlers/quizHandler.js';
import { handleFlashcards } from './handlers/flashcardsHandler.js';
import { handleConfig } from './handlers/configHandler.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }) as any); // Increase limit for large text payloads

const asyncHandler = (fn: any): any => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// API Routes
app.get('/api/config', asyncHandler(handleConfig));

// Asynchronous Document Processing Routes
app.post('/api/document/process-text', asyncHandler(handleProcessTextDocument)); // New initiator
app.post('/api/document/process-chunk', asyncHandler(handleProcessChunk)); // Worker for Stage 2 (Embedding)
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