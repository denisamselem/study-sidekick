import express from 'express';
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
// FIX: Removed the explicit 'as RequestHandler' casts which were causing type conflicts.
// The previous workaround is no longer necessary and was preventing correct type inference.
app.use(express.json());

// API Routes
app.post('/api/process', handleProcess);
app.post('/api/chat', handleChat);
app.post('/api/quiz', handleQuiz);
app.post('/api/flashcards', handleFlashcards);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Export the app for serverless environments
export default app;