
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { handleStart, handleBatch, handleFinish } from './handlers/processingHandlers';
import { handleChat } from './handlers/chatHandler';
import { handleQuiz } from './handlers/quizHandler';
import { handleFlashcards } from './handlers/flashcardsHandler';
import { handleConfig } from './handlers/configHandler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
// FIX: The type definitions for express appear to be conflicting, causing overload resolution to fail.
// Casting to `any` bypasses the erroneous type check and resolves the error.
app.use(express.json() as any);

// FIX: The conflicting RequestHandler types cause issues with call signatures and assignability.
// Using `any` for the function parameter and return type circumvents these type-checking errors,
// ensuring that async handlers are correctly wrapped and registered.
const asyncHandler = (fn: any): any => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// API Routes
app.get('/api/config', asyncHandler(handleConfig));

// Asynchronous Processing Routes
app.post('/api/process/start', asyncHandler(handleStart));
app.post('/api/process/batch', asyncHandler(handleBatch));
app.post('/api/process/finish', asyncHandler(handleFinish));

// RAG Routes
app.post('/api/chat', asyncHandler(handleChat));
app.post('/api/quiz', asyncHandler(handleQuiz));
app.post('/api/flashcards', asyncHandler(handleFlashcards));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Export the app for serverless environments
export default app;