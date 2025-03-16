import { generateObject } from 'ai';
import { z } from 'zod';

import { o3MiniModel } from './ai/providers.js';
import { systemPrompt } from './prompt.js';
import { detectLanguage } from './language-detector.js';

export async function generateFeedback({
  query,
  numQuestions = 3,
  language,
}: {
  query: string;
  numQuestions?: number;
  language?: string;
}) {
  const detectedLanguage = language || detectLanguage(query);
  
  const userFeedback = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(detectedLanguage),
    prompt: detectedLanguage === 'ru'
      ? `На основе следующего запроса пользователя задайте несколько уточняющих вопросов для определения направления исследования. Верните максимум ${numQuestions} вопросов, но можно меньше, если изначальный запрос понятен: <query>${query}</query>`
      : `Given the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`,
    schema: z.object({
      questions: z
        .array(z.string())
        .describe(
          detectedLanguage === 'ru'
            ? `Уточняющие вопросы для определения направления исследования, максимум ${numQuestions}`
            : `Follow up questions to clarify the research direction, max of ${numQuestions}`,
        ),
    }),
  });

  return userFeedback.object.questions.slice(0, numQuestions);
}
