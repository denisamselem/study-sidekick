
import React, { useState } from 'react';
import { Quiz } from '../types';

interface QuizViewProps {
    quiz: Quiz;
}

export const QuizView: React.FC<QuizViewProps> = ({ quiz }) => {
    const [selectedAnswers, setSelectedAnswers] = useState<(string | null)[]>(Array(quiz.questions.length).fill(null));
    const [showResults, setShowResults] = useState(false);

    const handleSelectAnswer = (questionIndex: number, option: string) => {
        if (showResults) return;
        const newAnswers = [...selectedAnswers];
        newAnswers[questionIndex] = option;
        setSelectedAnswers(newAnswers);
    };

    const handleSubmit = () => {
        setShowResults(true);
    };

    const calculateScore = () => {
        return selectedAnswers.reduce((score, answer, index) => {
            return answer === quiz.questions[index].correctAnswer ? score + 1 : score;
        }, 0);
    };
    
    const getButtonClass = (questionIndex: number, option: string) => {
        if (!showResults) {
            return selectedAnswers[questionIndex] === option
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600';
        }

        const isCorrect = option === quiz.questions[questionIndex].correctAnswer;
        const isSelected = selectedAnswers[questionIndex] === option;

        if (isCorrect) return 'bg-green-500 text-white';
        if (isSelected && !isCorrect) return 'bg-red-500 text-white';
        return 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg h-full overflow-y-auto">
            <h2 className="text-3xl font-bold mb-6 text-slate-800 dark:text-slate-100">{quiz.title}</h2>
            {quiz.questions.map((q, qIndex) => (
                <div key={qIndex} className="mb-8 p-6 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                    <p className="text-lg font-semibold mb-4 text-slate-700 dark:text-slate-200">{qIndex + 1}. {q.questionText}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {q.options.map((option, oIndex) => (
                            <button
                                key={oIndex}
                                onClick={() => handleSelectAnswer(qIndex, option)}
                                className={`w-full p-4 rounded-lg text-left transition-colors duration-200 ${getButtonClass(qIndex, option)}`}
                                disabled={showResults}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            {!showResults ? (
                 <button
                    onClick={handleSubmit}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                    disabled={selectedAnswers.some(a => a === null)}
                >
                    Submit Answers
                </button>
            ) : (
                <div className="text-center p-6 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg">
                    <h3 className="text-2xl font-bold text-indigo-800 dark:text-indigo-200">Quiz Complete!</h3>
                    <p className="text-xl mt-2 text-indigo-700 dark:text-indigo-300">
                        You scored {calculateScore()} out of {quiz.questions.length}
                    </p>
                </div>
            )}
        </div>
    );
};
