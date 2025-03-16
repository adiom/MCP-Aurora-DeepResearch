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
      ? `На основе следующего запроса пользователя задайте несколько уточняющих вопросов для определения направления и глубины исследования. Обязательно спросите о желаемой глубине и детальности исследования, а также о конкретных аспектах, которые нужно изучить более подробно. Верните максимум ${numQuestions} вопросов, но можно меньше, если изначальный запрос понятен: <query>${query}</query>`
      : `Given the following query from the user, ask some follow up questions to clarify both the research direction and depth. Make sure to ask about the desired depth and detail level of the research, as well as specific aspects that need more thorough investigation. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`,
    schema: z.object({
      questions: z
        .array(z.string())
        .describe(
          detectedLanguage === 'ru'
            ? `Уточняющие вопросы для определения направления и глубины исследования, максимум ${numQuestions}`
            : `Follow up questions to clarify research direction and depth, max of ${numQuestions}`,
        ),
    }),
  });

  return userFeedback.object.questions.slice(0, numQuestions);
}
