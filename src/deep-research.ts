import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

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
  researchPlan,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  language?: string;
  researchPlan?: string[];
}): Promise<SerpQuery[]> {
  logger.log('Generating SERP queries', { 
    query, 
    numQueries, 
    learningsCount: learnings?.length,
    planSteps: researchPlan?.length
  });
  
  try {
    const res = await generateObject({
      model: o3MiniModel,
      system: systemPrompt(language),
      prompt: language === 'ru' 
        ? `На основе следующего запроса пользователя и плана исследования сгенерируйте список поисковых запросов. Каждый запрос должен быть направлен на конкретный аспект исследования. Запросы должны быть максимально информативными и специфичными:\n\nЗапрос: ${query}\n\nПлан исследования:\n${researchPlan?.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n${
          learnings
            ? `Вот что мы уже узнали из предыдущего исследования:\n${learnings.join('\n')}`
            : ''
        }`
        : `Based on the following user query and research plan, generate a list of search queries. Each query should target a specific aspect of the research. Queries should be as informative and specific as possible:\n\nQuery: ${query}\n\nResearch plan:\n${researchPlan?.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n${
          learnings
            ? `Here's what we've learned from previous research:\n${learnings.join('\n')}`
            : ''
        }`,
      schema: z.object({
        queries: z
          .array(z.object({
            query: z.string(),
            researchGoal: z.string().optional(),
          }))
          .length(numQueries),
      }),
    });

    logger.log('Generated SERP queries', { queries: res.object.queries });
    return res.object.queries;
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

// Add rate limiting configuration
const ApiRateLimit = 15; // Keep below 20 requests per minute to be safe
const rateLimiter = pLimit(1); // Only allow 1 concurrent request

// Add state persistence
interface ResearchState {
  query: string;
  learnings: string[];
  visitedUrls: string[];
  progress: ResearchProgress;
  language?: string;
  timestamp: number;
}

function saveResearchState(state: ResearchState) {
  const session = ResearchSession.getInstance();
  const stateFile = `research-${session.uuid}-state.json`;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  logger.log('Research state saved', { 
    uuid: session.uuid,
    stateFile,
    learningsCount: state.learnings.length
  });
}

function loadResearchState(uuid: string): ResearchState | null {
  const stateFile = `research-${uuid}-state.json`;
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    logger.log('Research state loaded', { 
      uuid,
      stateFile,
      learningsCount: state.learnings.length
    });
    return state;
  }
  return null;
}

// Add rate limit handling to writeFinalReport
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
  
  try {
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

    // Wrap the API call with rate limiting
    const res = await rateLimiter(async () => {
      // Add delay between requests to stay under rate limit
      await new Promise(resolve => setTimeout(resolve, 60000 / ApiRateLimit));
      
      return generateObject({
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
    });

    // Append the visited URLs section to the report with localized heading
    const urlsHeading = detectedLanguage === 'ru' ? '## Источники' : '## Sources';
    const urlsSection = `\n\n${urlsHeading}\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
    return res.object.reportMarkdown + urlsSection;
  } catch (error) {
    // Handle daily rate limit error
    if (error instanceof Error && 
        error.message.includes('Rate limit exceeded: free-models-per-day')) {
      const session = ResearchSession.getInstance();
      
      // Save current state
      saveResearchState({
        query: prompt,
        learnings,
        visitedUrls,
        progress: {
          currentDepth: 1,
          totalDepth: 1,
          currentBreadth: 1,
          totalBreadth: 1,
          totalQueries: 1,
          completedQueries: 0
        },
        language: detectedLanguage,
        timestamp: Date.now()
      });

      // Return a temporary report
      const tempReport = detectedLanguage === 'ru'
        ? `# Промежуточный отчет\n\nИсследование было приостановлено из-за достижения дневного лимита запросов. Текущие результаты сохранены и могут быть использованы для продолжения исследования завтра.\n\n## Текущие выводы\n\n${learnings.map(l => `- ${l}`).join('\n')}\n\n## Источники\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`
        : `# Interim Report\n\nResearch was paused due to reaching the daily rate limit. Current results have been saved and can be used to continue research tomorrow.\n\n## Current Findings\n\n${learnings.map(l => `- ${l}`).join('\n')}\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
      
      return tempReport;
    }
    throw error;
  }
}

// Research configuration based on user's answers
interface ResearchConfig {
  depth: number;
  breadth: number;
  stepsCount: number;
}

function parseResearchConfig(query: string): ResearchConfig {
  // Default configuration
  const defaultConfig: ResearchConfig = {
    depth: 3,
    breadth: 3,
    stepsCount: 8
  };

  try {
    // Look for depth preferences in the query
    const depthMatch = query.match(/глубина исследования:.*?(\d+)|research depth:.*?(\d+)/i);
    const breadthMatch = query.match(/широта исследования:.*?(\d+)|research breadth:.*?(\d+)/i);
    const stepsMatch = query.match(/количество шагов:.*?(\d+)|number of steps:.*?(\d+)/i);

    // Also look for qualitative descriptions
    const isDeepResearch = /глубокое исследование|подробное исследование|deep research|detailed research/i.test(query);
    const isBroadResearch = /широкое исследование|comprehensive research|broad research/i.test(query);
    const isQuickResearch = /быстрое исследование|краткое исследование|quick research|brief research/i.test(query);

    const config = { ...defaultConfig };

    // Apply numeric values if found
    if (depthMatch?.[1] || depthMatch?.[2]) {
      const depth = parseInt(depthMatch[1] || depthMatch[2] || '0');
      if (depth > 0 && depth <= 5) {
        config.depth = depth;
      }
    }
    if (breadthMatch?.[1] || breadthMatch?.[2]) {
      const breadth = parseInt(breadthMatch[1] || breadthMatch[2] || '0');
      if (breadth > 0 && breadth <= 5) {
        config.breadth = breadth;
      }
    }
    if (stepsMatch?.[1] || stepsMatch?.[2]) {
      const steps = parseInt(stepsMatch[1] || stepsMatch[2] || '0');
      if (steps > 0 && steps <= 12) {
        config.stepsCount = steps;
      }
    }

    // Apply qualitative adjustments
    if (isDeepResearch) {
      config.depth = Math.max(config.depth, 4);
    }
    if (isBroadResearch) {
      config.breadth = Math.max(config.breadth, 4);
      config.stepsCount = Math.max(config.stepsCount, 10);
    }
    if (isQuickResearch) {
      config.depth = Math.min(config.depth, 2);
      config.breadth = Math.min(config.breadth, 2);
      config.stepsCount = Math.min(config.stepsCount, 6);
    }

    return config;
  } catch (error) {
    logger.error('Error parsing research config', error);
    return defaultConfig;
  }
}

async function generateResearchPlan({
  query,
  language,
  stepsCount,
}: {
  query: string;
  language?: string;
  stepsCount: number;
}): Promise<string[]> {
  try {
    // Wrap the API call with rate limiting
    const res = await rateLimiter(async () => {
      // Add delay between requests to stay under rate limit
      await new Promise(resolve => setTimeout(resolve, 60000 / ApiRateLimit));
      
      return generateObject({
        model: o3MiniModel,
        system: systemPrompt(language),
        prompt: language === 'ru'
          ? `На основе запроса пользователя "${query}" составьте детальный план исследования из ${stepsCount} шагов. План должен быть логически структурирован, каждый шаг должен углублять понимание темы. Не включайте общие или повторяющиеся шаги.`
          : `Based on the user query "${query}", create a detailed research plan with ${stepsCount} steps. The plan should be logically structured, each step should deepen the understanding of the topic. Do not include generic or repetitive steps.`,
        schema: z.object({
          steps: z.array(z.string()).length(stepsCount)
        }),
      });
    });

    return res.object.steps;
  } catch (error) {
    if (error instanceof Error && 
        error.message.includes('Rate limit exceeded: free-models-per-day')) {
      // Return a basic research plan for temporary use
      return language === 'ru'
        ? [
            'Основные концепции и определения',
            'Исторический контекст',
            'Современное состояние',
            'Практическое применение',
            'Проблемы и вызовы',
            'Перспективы развития',
            'Сравнительный анализ',
            'Выводы и рекомендации'
          ]
        : [
            'Core concepts and definitions',
            'Historical context',
            'Current state',
            'Practical applications',
            'Challenges and issues',
            'Future perspectives',
            'Comparative analysis',
            'Conclusions and recommendations'
          ];
    }
    throw error;
  }
}

export async function deepResearch({
  query,
  learnings = [],
  visitedUrls = [],
  onProgress,
  language,
  resumeFromUuid,
}: {
  query: string;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  language?: string;
  resumeFromUuid?: string;
}): Promise<ResearchResult> {
  const session = ResearchSession.getInstance();
  
  // Try to load saved state if resumeFromUuid is provided
  if (resumeFromUuid) {
    const savedState = loadResearchState(resumeFromUuid);
    if (savedState) {
      logger.log('Resuming research from saved state', { 
        uuid: resumeFromUuid,
        savedLearnings: savedState.learnings.length
      });
      
      // Use saved state
      query = savedState.query;
      learnings = savedState.learnings;
      visitedUrls = savedState.visitedUrls;
      language = savedState.language;
    }
  }
  
  // Detect language if not provided
  const detectedLanguage = language || detectLanguage(query);
  logger.log('Language detection in deepResearch', { 
    providedLanguage: language,
    detectedLanguage,
    query
  });

  // Parse research configuration from query
  const researchConfig = parseResearchConfig(query);
  logger.log('Research configuration', {
    config: researchConfig,
    query
  });

  try {
    // Generate and show research plan
    const researchPlan = await generateResearchPlan({ 
      query, 
      language: detectedLanguage,
      stepsCount: researchConfig.stepsCount 
    });
    logger.log('Research plan', { 
      uuid: session.uuid,
      plan: researchPlan
    });

    const progress: ResearchProgress = {
      currentDepth: 1,
      totalDepth: researchConfig.depth,
      currentBreadth: 1,
      totalBreadth: researchConfig.breadth,
      totalQueries: researchConfig.stepsCount,
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
      numQueries: researchConfig.breadth,
      learnings,
      language: detectedLanguage,
      researchPlan,
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
            const newBreadth = Math.ceil(researchConfig.breadth / 2);
            const newDepth = researchConfig.depth - 1;

            const newLearnings = await processSerpResult({
              query: serpQuery.query,
              result,
              numFollowUpQuestions: newBreadth,
              language: detectedLanguage,
            });
            const allLearnings = [...learnings, ...newLearnings.learnings];
            const allUrls = [...visitedUrls, ...newUrls];

            // Save intermediate state periodically
            saveResearchState({
              query,
              learnings: allLearnings,
              visitedUrls: allUrls,
              progress,
              language: detectedLanguage,
              timestamp: Date.now()
            });

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
            if (e instanceof Error) {
              if (e.message.includes('timeout')) {
                log(
                  `Timeout error running query: ${serpQuery.query}: `,
                  e,
                );
              } else if (e.message.includes('Rate limit exceeded: free-models-per-day')) {
                // Save state on daily rate limit
                saveResearchState({
                  query,
                  learnings,
                  visitedUrls,
                  progress,
                  language: detectedLanguage,
                  timestamp: Date.now()
                });
                throw e; // Re-throw to handle at top level
              } else {
                log(`Error running query: ${serpQuery.query}: `, e);
              }
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
  } catch (error) {
    if (error instanceof Error && 
        error.message.includes('Rate limit exceeded: free-models-per-day')) {
      logger.log('Research paused due to daily rate limit', {
        uuid: session.uuid,
        learningsCount: learnings.length,
        urlsCount: visitedUrls.length
      });
      
      // Return current results
      return {
        learnings,
        visitedUrls,
      };
    }
    throw error;
  }
}
