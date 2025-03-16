import { logger } from './logger.js';

export function detectLanguage(text: string): string {
    // Simple language detection based on character sets and common words
    const cyrillicPattern = /[\u0400-\u04FF]/;
    const latinPattern = /[a-zA-Z]/;
    
    // Count Cyrillic and Latin characters
    const cyrillicCount = (text.match(cyrillicPattern) || []).length;
    const latinCount = (text.match(latinPattern) || []).length;
    
    // Common Russian words
    const russianWords = ['и', 'в', 'не', 'на', 'я', 'быть', 'что', 'это', 'он', 'с'];
    const russianWordsCount = russianWords.filter(word => 
      text.toLowerCase().includes(` ${word} `) || 
      text.toLowerCase().startsWith(`${word} `) ||
      text.toLowerCase().endsWith(` ${word}`)
    ).length;
    
    logger.log('Language detection', {
      text,
      cyrillicCount,
      latinCount,
      russianWordsCount,
      russianWordsFound: russianWords.filter(word => 
        text.toLowerCase().includes(` ${word} `) || 
        text.toLowerCase().startsWith(`${word} `) ||
        text.toLowerCase().endsWith(` ${word}`)
      )
    });

    // If there are significantly more Cyrillic characters or Russian words, assume Russian
    if (cyrillicCount > latinCount || russianWordsCount >= 2) {
      logger.log('Detected Russian language');
      return 'ru';
    }
    
    // Default to English
    logger.log('Defaulting to English language');
    return 'en';
} 