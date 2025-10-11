
export interface Message {
  role: 'user' | 'model';
  text: string;
  sources?: Source[];
}

export interface Source {
  content: string;
}

export interface QuizQuestion {
  questionText: string;
  options: string[];
  correctAnswer: string;
}

export interface Quiz {
  title: string;
  questions: QuizQuestion[];
}

export interface Flashcard {
  front: string;
  back: string;
}

export type StudyAid = Quiz | Flashcard[] | null;
export type ViewType = 'chat' | 'quiz' | 'flashcards';