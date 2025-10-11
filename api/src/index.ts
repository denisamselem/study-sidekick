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
// FIX: A type overload issue was preventing app.use(express.json()) from compiling.
// Wrapping it in an anonymous function helps TypeScript resolve the correct signature.
const jsonMiddleware = express.json();
app.use((req: Request, res: Response, next: NextFunction) => jsonMiddleware(req, res, next));

// API Routes
// FIX: The route handlers were causing type mismatches.
// Wrapping them in anonymous arrow functions resolves the type conflict.
app.post('/api/process', (req: Request, res: Response, next: NextFunction) => handleProcess(req, res, next));
app.post('/api/chat', (req: Request, res: Response, next: NextFunction) => handleChat(req, res, next));
app.post('/api/quiz', (req: Request, res: Response, next: NextFunction) => handleQuiz(req, res, next));
app.post('/api/flashcards', (req: Request, res: Response, next: NextFunction) => handleFlashcards(req, res, next));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Export the app for serverless environments
export default app;
