import React, { useState, useEffect } from 'react';
import { Flashcard } from '../types';

interface FlashcardViewProps {
    flashcards: Flashcard[];
}

export const FlashcardView: React.FC<FlashcardViewProps> = ({ flashcards }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    // Reset flip state when card changes
    useEffect(() => {
        setIsFlipped(false);
    }, [currentIndex]);

    if (!flashcards || flashcards.length === 0) {
        return (
            <div className="flex items-center justify-center h-full bg-white dark:bg-slate-800 rounded-lg shadow-lg">
                <p className="text-slate-500 dark:text-slate-400">No flashcards available to display.</p>
            </div>
        );
    }

    const currentCard = flashcards[currentIndex];

    const goToPrevious = () => {
        setCurrentIndex((prevIndex) => (prevIndex > 0 ? prevIndex - 1 : flashcards.length - 1));
    };

    const goToNext = () => {
        setCurrentIndex((prevIndex) => (prevIndex < flashcards.length - 1 ? prevIndex + 1 : 0));
    };

    const handleFlip = () => {
        setIsFlipped(!isFlipped);
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg h-full flex flex-col items-center justify-center">
            <h2 className="text-3xl font-bold mb-6 text-slate-800 dark:text-slate-100">Flashcards</h2>

            <div className="w-full max-w-2xl h-80 perspective-1000">
                <div
                    className={`relative w-full h-full transition-transform duration-700 transform-style-preserve-3d ${isFlipped ? 'rotate-y-180' : ''}`}
                    onClick={handleFlip}
                >
                    <div className="absolute w-full h-full backface-hidden rounded-lg shadow-xl bg-indigo-500 flex items-center justify-center p-6 cursor-pointer">
                        <p className="text-2xl font-semibold text-white text-center">{currentCard.front}</p>
                    </div>
                    <div className="absolute w-full h-full backface-hidden rounded-lg shadow-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center p-6 cursor-pointer rotate-y-180">
                        <p className="text-xl text-slate-800 dark:text-slate-200 text-center">{currentCard.back}</p>
                    </div>
                </div>
            </div>

            <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
                Card {currentIndex + 1} of {flashcards.length}
            </p>

            <div className="flex items-center justify-center mt-4 space-x-4">
                <button
                    onClick={goToPrevious}
                    className="px-6 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors"
                >
                    Previous
                </button>
                <button
                    onClick={handleFlip}
                    className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors"
                >
                    Flip
                </button>
                <button
                    onClick={goToNext}
                    className="px-6 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors"
                >
                    Next
                </button>
            </div>
             <style>{`
                .perspective-1000 { perspective: 1000px; }
                .transform-style-preserve-3d { transform-style: preserve-3d; }
                .rotate-y-180 { transform: rotateY(180deg); }
                .backface-hidden { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
            `}</style>
        </div>
    );
};