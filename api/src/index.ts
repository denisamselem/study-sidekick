import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { handleProcess } from './handlers/processHandler';
import { handleChat } from './handlers/chatHandler';
import { handleQuiz } from './handlers/quizHandler';
import { handleFlashcards } from './handlers/flashcardsHandler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
// FIX: Using an inline function for the middleware to resolve potential type
// conflicts between different versions of @types/express. This ensures the
// middleware function signature matches what app.use() expects.
const jsonParser = express.json();
app.use((req: Request, res: Response, next: NextFunction) => jsonParser(req, res, next));

// API Routes
// FIX: Using inline arrow functions to wrap handlers. This helps TypeScript
// correctly infer types from the call site (`app.post`) and avoids
// issues with potentially mismatched RequestHandler type definitions.
app.post('/api/process', (req: Request, res: Response) => handleProcess(req, res));
app.post('/api/chat', (req: Request, res: Response) => handleChat(req, res));
app.post('/api/quiz', (req: Request, res: Response) => handleQuiz(req, res));
app.post('/api/flashcards', (req: Request, res: Response) => handleFlashcards(req, res));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Export the app for serverless environments
export default app;
