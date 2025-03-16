import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { z, ZodType, ZodTypeDef } from 'zod';

interface GeminiProviderSettings {
  apiKey: string;
  model?: string;
}

type GeminiModelFunction = {
  <T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<{ object: T }>;
  objectGenerationMode: boolean;
  generateObject: <T>(prompt: string, schema: z.ZodType<T>) => Promise<{ object: T }>;
};

export function createGemini(settings: GeminiProviderSettings) {
  const genAI = new GoogleGenerativeAI(settings.apiKey);
  const model = genAI.getGenerativeModel({ model: settings.model || 'gemini-pro' });

  const geminiModel = async function geminiModel<T>(
    system: string,
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<{ object: T }> {
    try {
      // Prepare a more structured prompt that explicitly asks for JSON
      const schemaDescription = describeZodSchema(schema);
      const fullPrompt = `${system}

Инструкции:
1. Вы ДОЛЖНЫ ответить валидным JSON объектом.
2. JSON объект должен соответствовать этой структуре:
${schemaDescription}

Запрос пользователя: ${prompt}

Ответ (ТОЛЬКО валидный JSON):`;
      
      // Generate response
      const result = await model.generateContent(fullPrompt);
      const response = result.response;
      const text = response.text();
      
      // Try to parse as JSON first
      try {
        const jsonResponse = JSON.parse(text);
        const parsed = schema.parse(jsonResponse);
        return { object: parsed };
      } catch (e) {
        // If JSON parsing fails, try to extract structured data from the text
        const parsed = schema.parse(extractStructuredData(text, schema));
        return { object: parsed };
      }
    } catch (error) {
      console.error('Error in Gemini provider:', error);
      throw error;
    }
  };

  // Add required properties for compatibility with generateObject
  const typedGeminiModel = geminiModel as GeminiModelFunction;
  typedGeminiModel.objectGenerationMode = true;
  typedGeminiModel.generateObject = async <T>(prompt: string, schema: z.ZodType<T>): Promise<{ object: T }> => {
    return geminiModel('', prompt, schema);
  };

  return typedGeminiModel;
}

function describeZodSchema(schema: z.ZodType<any>): string {
  const description = schema.description || '';
  
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape();
    const fields = Object.entries(shape)
      .map(([key, value]) => `    "${key}": ${describeZodType(value as z.ZodType<any>)}`)
      .join(',\n');
    
    return `{
${fields}
}

Description: ${description}`;
  }
  
  if (schema instanceof z.ZodArray) {
    const elementSchema = schema._def.type;
    return `[
    ${describeZodType(elementSchema)}
]

Description: ${description}`;
  }
  
  return describeZodType(schema);
}

function describeZodType(type: z.ZodType<any>): string {
  if (type instanceof z.ZodString) return '"string"';
  if (type instanceof z.ZodNumber) return 'number';
  if (type instanceof z.ZodBoolean) return 'boolean';
  if (type instanceof z.ZodArray) return `array of ${describeZodType(type._def.type)}`;
  if (type instanceof z.ZodObject) return 'object';
  return 'any';
}

// Helper function to try to extract structured data from text
function extractStructuredData(text: string, schema: z.ZodType<any>): any {
  // Try to find JSON-like structures in the text
  const jsonPattern = /\{[\s\S]*\}|\[[\s\S]*\]/;
  const match = text.match(jsonPattern);
  
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      return createSimpleStructure(text, schema);
    }
  }
  
  return createSimpleStructure(text, schema);
}

function createSimpleStructure(text: string, schema: z.ZodType<any>): any {
  const lines = text.split('\n').filter(line => line.trim());
  
  if (schema instanceof z.ZodArray) {
    return { items: lines };
  }
  
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape();
    const obj: any = {};
    
    Object.keys(shape).forEach((key, index) => {
      if (lines[index]) {
        obj[key] = lines[index];
      }
    });
    
    return obj;
  }
  
  if (lines.some(line => line.includes(':'))) {
    const obj: any = {};
    lines.forEach(line => {
      const [key, ...values] = line.split(':');
      if (key && values.length) {
        obj[key.trim()] = values.join(':').trim();
      }
    });
    return obj;
  }
  
  return { text: lines.join('\n') };
} 