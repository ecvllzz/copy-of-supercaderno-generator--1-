import { GoogleGenerativeAI, GenerativeModel, SchemaType } from '@google/genai';
import { z } from 'zod';
import { cache, hashContent } from './cacheService.js';
import { defaultRateLimiter } from '../utils/rateLimiter.js';
import type { DocumentStructure, ExtractionResult } from '../types/index.js';

const API_KEY = process.env.API_KEY ?? process.env.GOOGLE_API_KEY;

if (!API_KEY) {
  console.warn('[Gemini] Missing API key. Service methods will throw until configured.');
}

const client = API_KEY ? new GoogleGenerativeAI({ apiKey: API_KEY }) : null;

const structureSchema = {
  type: SchemaType.OBJECT,
  properties: {
    titulo_documento: {
      type: SchemaType.STRING,
      description: 'Nome do documento original',
    },
    conteudo: {
      type: SchemaType.ARRAY,
      description: 'Lista de tópicos principais extraídos do PDF',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          topico: { type: SchemaType.STRING },
          subtopicos: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
        },
        required: ['topico', 'subtopicos'],
      },
    },
  },
  required: ['titulo_documento', 'conteudo'],
} as const;

const documentStructureValidator = z.object({
  titulo_documento: z.string().min(1),
  conteudo: z
    .array(
      z.object({
        topico: z.string().min(1),
        subtopicos: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

function getModel(modelName: 'flash' | 'pro'): GenerativeModel {
  if (!client) {
    throw new Error('Gemini client not configured. Please set API_KEY or GOOGLE_API_KEY environment variable.');
  }

  const name = modelName === 'flash' ? 'gemini-flash-latest' : 'gemini-pro-latest';
  return client.getGenerativeModel({ model: name });
}

async function callModel({
  model,
  prompt,
  responseMimeType,
  responseSchema,
}: {
  model: 'flash' | 'pro';
  prompt: string;
  responseMimeType?: string;
  responseSchema?: unknown;
}): Promise<string> {
  const generativeModel = getModel(model);
  await defaultRateLimiter.throttle();
  const result = await generativeModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType,
      responseSchema,
    },
  });

  const text = result.response?.text()?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return text;
}

export async function analyzeStructure(pdfText: string): Promise<DocumentStructure | null> {
  const cacheKey = `structure:${hashContent(pdfText)}`;
  const cached = cache.get<DocumentStructure>(cacheKey);
  if (cached) {
    return cached;
  }

  const prompt = `Você é um analisador de estrutura de documentos jurídicos. Sua tarefa é extrair a hierarquia de tópicos e subtópicos de um PDF e retorná-la em JSON VÁLIDO.

CHECKLIST:
- Inclua apenas seções de conteúdo, excluindo questões, sumários e material administrativo.
- Preserve a hierarquia título → subtópicos.
- Não adicione comentários ou texto adicional. Retorne apenas JSON válido.

TEXTO PARA ANÁLISE:
---
${pdfText}
---`;

  try {
    const json = await callModel({
      model: 'flash',
      prompt,
      responseMimeType: 'application/json',
      responseSchema: structureSchema,
    });
    const parsed = JSON.parse(json);
    const result = documentStructureValidator.parse(parsed);
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('[Gemini] Failed to analyse structure:', error);
    return null;
  }
}

export async function extractContent(pdfText: string, topicName: string): Promise<string> {
  const cacheKey = `extract:${hashContent(`${topicName}|${pdfText}`)}`;
  const cached = cache.get<string>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const prompt = `Você é um extrator de conteúdo jurídico. Extraia fielmente todo o conteúdo relacionado ao tópico "${topicName}" do texto abaixo. Não resuma, não adicione interpretações e ignore questões de concurso ou notas de rodapé. Caso o tópico não esteja presente, responda apenas com [TÓPICO NÃO ENCONTRADO].

TEXTO:
---
${pdfText}
---`;

  try {
    const raw = await callModel({ model: 'flash', prompt });
    const normalised = raw.trim() === '[TÓPICO NÃO ENCONTRADO]' ? '' : raw.trim();
    cache.set(cacheKey, normalised);
    return normalised;
  } catch (error) {
    console.error(`[Gemini] Failed to extract topic "${topicName}":`, error);
    return '';
  }
}

export async function consolidateContent(title: string, extracts: ExtractionResult[]): Promise<string> {
  const extractsSignature = extracts
    .map((item) => `${item.fonte}|${item.conteudo}`)
    .join('\n');
  const cacheKey = `consolidate:${hashContent(`${title}|${extractsSignature}`)}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const formattedSources = extracts
    .map((item, index) => `--- FONTE ${index + 1}: ${item.fonte} ---\n${item.conteudo}`)
    .join('\n\n');

  const prompt = `Você é o "Escritor-Mestre" do Supercaderno. Consolide os trechos abaixo em uma única seção Markdown perfeitamente formatada seguindo o guia de estilo fornecido, SEM introduzir conteúdo novo.

Título da seção: ${title}

CHECKLIST DE CONTEÚDO:
- Integre todas as informações relevantes das fontes.
- Elimine redundâncias sem perder detalhes importantes.
- Não adicione comentários pessoais ou orientações ao estudante.

CHECKLIST DE FORMATAÇÃO (resumo):
- Inicie com o título em Markdown.
- Use enumerações com o padrão **a. Título:** descrição.
- Destaque leis e jurisprudência em tabelas de uma coluna com emojis apropriados (⚖️, 🏛️, 📌, ⚠️).
- Garanta espaçamento em branco entre parágrafos e elementos.

TRECHOS PARA CONSOLIDAR:
${formattedSources}

Retorne apenas o Markdown consolidado.`;

  try {
    const markdown = await callModel({ model: 'pro', prompt });
    cache.set(cacheKey, markdown);
    return markdown;
  } catch (error) {
    console.error(`[Gemini] Failed to consolidate "${title}":`, error);
    return `${title}\n\n*Erro ao consolidar conteúdo.*`;
  }
}

export async function generateFinalSections(fullMarkdown: string): Promise<string> {
  const cacheKey = `final-sections:${hashContent(fullMarkdown)}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const prompt = `Analise o Supercaderno abaixo e gere apenas as duas seções finais obrigatórias em Markdown.

1) ## **Pontos Essenciais e Resumo Esquemático do Capítulo**
   - Crie subtópicos em negrito com listas de marcadores.
2) ## **Legislação Citada Neste Capítulo**
   - Liste em marcadores simples todas as normas mencionadas.

Documento:
---
${fullMarkdown}
---`;

  try {
    const sections = await callModel({ model: 'pro', prompt });
    cache.set(cacheKey, sections);
    return sections;
  } catch (error) {
    console.error('[Gemini] Failed to generate final sections:', error);
    return '';
  }
}

export async function generateSynopsis(fullMarkdown: string, topicName: string): Promise<string> {
  const cacheKey = `synopsis:${hashContent(`${topicName}|${fullMarkdown}`)}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const prompt = `Crie uma sinopse executiva para "${topicName}" com a estrutura obrigatória:

# **${topicName}**

- Introdução com 5 a 8 parágrafos contextualizando o tema.
- Tabela de Ficha Sinopse conforme o padrão abaixo.

| **📋 Ficha Sinopse** |
|---|
| **Temas Principais:** ... |
| **Legislação Chave:** ... |
| **Conceito Central:** ... |
| **Jurisprudência Relevante:** ... |

Baseie-se exclusivamente no material a seguir e não inclua comentários extras.

Material:
---
${fullMarkdown}
---`;

  try {
    const synopsis = await callModel({ model: 'pro', prompt });
    cache.set(cacheKey, synopsis);
    return synopsis;
  } catch (error) {
    console.error('[Gemini] Failed to generate synopsis:', error);
    return '';
  }
}
