import express, { RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { handleUpload } from './handlers/uploadHandler';
import { handleChat } from './handlers/chatHandler';
import { handleQuiz } from './handlers/quizHandler';
import { handleFlashcards } from './handlers/flashcardsHandler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
// FIX: The following middleware and handlers are cast to RequestHandler to resolve
// potential type conflicts and incorrect overload resolution by TypeScript. This can be
// caused by issues in dependency type definitions.
app.use(express.json() as RequestHandler);

// API Routes
app.post('/api/upload', handleUpload as RequestHandler);
app.post('/api/chat', handleChat as RequestHandler);
app.post('/api/quiz', handleQuiz as RequestHandler);
app.post('/api/flashcards', handleFlashcards as RequestHandler);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Export the app for serverless environments
export default app;