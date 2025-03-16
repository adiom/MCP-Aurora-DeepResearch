import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';
import fs from 'fs';

import { o3MiniModel, trimPrompt } from './ai/providers.js';
import { systemPrompt } from './prompt.js';
import { detectLanguage } from './language-detector.js';
import { logger, ResearchSession } from './logger.js';

// Helper function to log to stderr
const log = (...args: any[]) => {
  process.stderr.write(args.map(arg => 
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ') + '\n');
};

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

interface SerpQuery {
  query: string;
  researchGoal?: string;
}

async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  language,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  language?: string;
}): Promise<SerpQuery[]> {
  logger.log('Generating SERP queries', { query, numQueries, learningsCount: learnings?.length });
  
  try {
    const res = await generateObject({
      model: o3MiniModel,
      system: systemPrompt(language),
      prompt: language === 'ru' 
        ? `На основе следующего запроса пользователя сгенерируйте список поисковых запросов для исследования темы. Верните максимум ${numQueries} запросов, но можно меньше, если изначальный запрос понятен. Убедитесь, что каждый запрос уникален и не похож на другие: <prompt>${query}</prompt>\n\n${
          learnings
            ? `Вот что мы уже узнали из предыдущего исследования, используйте эту информацию для генерации более конкретных запросов: ${learnings.join(
                '\n',
              )}`
            : ''
        }`
        : `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other: <prompt>${query}</prompt>\n\n${
          learnings
            ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join(
                '\n',
              )}`
            : ''
        }`,
      schema: z.object({
        queries: z
          .array(z.object({
            query: z.string(),
            researchGoal: z.string().optional(),
          }))
          .describe(language === 'ru' ? `Список поисковых запросов, максимум ${numQueries}` : `List of search queries, max of ${numQueries}`),
      }),
    });

    logger.log('Generated SERP queries', { queries: res.object.queries });
    return res.object.queries.slice(0, numQueries);
  } catch (error) {
    logger.error('Error generating SERP queries', error);
    throw error;
  }
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  language,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  language?: string;
}) {
  logger.log('Processing SERP result', { 
    query, 
    numResults: result.data?.length,
    urls: result.data?.map(item => item.url)
  });
  
  try {
    const contents = compact(result.data.map(item => item.markdown)).map(
      content => trimPrompt(content, 25_000),
    );
    const urls = compact(result.data.map(item => item.url));
    log(`Ran ${query}, found ${contents.length} contents and ${urls.length} URLs:`, urls);

    const res = await generateObject({
      model: o3MiniModel,
      abortSignal: AbortSignal.timeout(60_000),
      system: systemPrompt(language),
      prompt: language === 'ru'
        ? `На основе следующего содержимого из поискового запроса <query>${query}</query>, сгенерируйте список выводов из содержимого. Верните максимум ${numLearnings} выводов, но можно меньше, если содержимое понятно. Убедитесь, что каждый вывод уникален и не похож на другие. Выводы должны быть краткими и по существу, максимально подробными и информативными. Обязательно включайте любые сущности, такие как люди, места, компании, продукты, вещи и т.д., а также точные метрики, числа или даты. Эти выводы будут использованы для дальнейшего исследования.\n\n<contents>${contents
          .map(content => `<content>\n${content}\n</content>`)
          .join('\n')}</contents>`
        : `Based on the following content from search query <query>${query}</query>, generate a list of learnings from the content. Return a maximum of ${numLearnings} learnings, but feel free to return less if the content is clear. Make sure each learning is unique and not similar to each other. Learnings should be concise and to the point, as detailed and informative as possible. Make sure to include any entities such as people, places, companies, products, things, etc. as well as exact metrics, numbers or dates. These learnings will be used for further research.\n\n<contents>${contents
          .map(content => `<content>\n${content}\n</content>`)
          .join('\n')}</contents>`,
      schema: z.object({
        learnings: z
          .array(z.string())
          .describe(language === 'ru' ? `Список выводов, максимум ${numLearnings}` : `List of learnings, max of ${numLearnings}`),
        followUpQuestions: z
          .array(z.string())
          .describe(
            language === 'ru'
              ? `Список дополнительных вопросов для дальнейшего исследования темы, максимум ${numFollowUpQuestions}`
              : `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
          ),
      }),
    });

    return res.object;
  } catch (error) {
    logger.error('Error processing SERP result', error);
    throw error;
  }
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  language,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  language?: string;
}) {
  const detectedLanguage = language || detectLanguage(prompt);
  
  log('Writing final report with:', {
    numLearnings: learnings.length,
    numUrls: visitedUrls.length,
    urls: visitedUrls,
    language: detectedLanguage
  });

  const learningsString = trimPrompt(
    learnings
      .map(learning => `<learning>\n${learning}\n</learning>`)
      .join('\n'),
    150_000,
  );

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(detectedLanguage),
    prompt: detectedLanguage === 'ru'
      ? `На основе следующего запроса пользователя напишите итоговый отчет по теме, используя выводы из исследования. Сделайте его максимально подробным, стремитесь к 3 и более страницам, включите ВСЕ выводы из исследования:\n\n<prompt>${prompt}</prompt>\n\nВот все выводы из предыдущего исследования:\n\n<learnings>\n${learningsString}\n</learnings>`
      : `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>`,
    schema: z.object({
      reportMarkdown: z
        .string()
        .describe(detectedLanguage === 'ru' ? 'Итоговый отчет по теме в формате Markdown' : 'Final report on the topic in Markdown'),
    }),
  });

  // Append the visited URLs section to the report with localized heading
  const urlsHeading = detectedLanguage === 'ru' ? '## Источники' : '## Sources';
  const urlsSection = `\n\n${urlsHeading}\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return res.object.reportMarkdown + urlsSection;
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  language,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  language?: string;
}): Promise<ResearchResult> {
  const session = ResearchSession.getInstance();
  
  // Detect language if not provided
  const detectedLanguage = language || detectLanguage(query);
  logger.log('Language detection in deepResearch', { 
    providedLanguage: language,
    detectedLanguage,
    query
  });

  logger.log('Starting research', { 
    uuid: session.uuid,
    query,
    depth,
    breadth,
    language: detectedLanguage 
  });

  const progress: ResearchProgress = {
    currentDepth: 1,
    totalDepth: depth,
    currentBreadth: 1,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };
  
  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    logger.log('Progress update', { 
      currentProgress: progress,
      update: update 
    });
    onProgress?.(progress);
  };

  const serpQueries = await generateSerpQueries({
    query,
    numQueries: breadth,
    learnings,
    language: detectedLanguage,
  });
  
  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
    currentDepth: 1,
    currentBreadth: 1
  });
  
  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          });

          // Collect URLs from this search
          const newUrls = compact(result.data.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
            language: detectedLanguage,
          });
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls = [...visitedUrls, ...newUrls];

          if (newDepth > 0) {
            logger.log('Starting deeper research', {
              newDepth,
              newBreadth,
              currentQuery: serpQuery.query
            });
            
            reportProgress({
              currentDepth: Math.max(1, newDepth),
              currentBreadth: Math.max(1, newBreadth),
              currentQuery: serpQuery.query,
            });

            if (serpQuery.researchGoal) {
              log(`Previous research goal: ${serpQuery.researchGoal}`);
            }

            const deeperResults = await deepResearch({
              query: serpQuery.query,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
              onProgress: (deepProgress) => {
                reportProgress({
                  ...deepProgress,
                  currentQuery: serpQuery.query,
                });
              },
              language: detectedLanguage,
            });

            return {
              learnings: [...allLearnings, ...deeperResults.learnings],
              visitedUrls: [...allUrls, ...deeperResults.visitedUrls],
            };
          }

          return {
            learnings: allLearnings,
            visitedUrls: allUrls,
          };
        } catch (e) {
          if (e instanceof Error && e.message.includes('timeout')) {
            log(
              `Timeout error running query: ${serpQuery.query}: `,
              e,
            );
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings,
            visitedUrls,
          };
        } finally {
          reportProgress({
            completedQueries: progress.completedQueries + 1,
          });
        }
      }),
    ),
  );

  const allResults = results.reduce(
    (acc, result) => ({
      learnings: [...acc.learnings, ...result.learnings],
      visitedUrls: [...acc.visitedUrls, ...result.visitedUrls],
    }),
    { learnings: [], visitedUrls: [] } as ResearchResult,
  );

  // Remove duplicates
  const result = {
    learnings: [...new Set(allResults.learnings)],
    visitedUrls: [...new Set(allResults.visitedUrls)],
  };

  // Save results to file
  const outputFileName = `research-${session.uuid}-results.md`;
  const markdownReport = await writeFinalReport({
    prompt: query,
    learnings: result.learnings,
    visitedUrls: result.visitedUrls,
    language: detectedLanguage,
  });
  fs.writeFileSync(outputFileName, markdownReport);
  logger.log('Research completed', { 
    uuid: session.uuid,
    outputFile: outputFileName,
    totalLearnings: result.learnings.length,
    totalUrls: result.visitedUrls.length
  });

  return result;
}
