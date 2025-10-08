import { useCallback, useMemo, useState } from 'react';
import { analyzeStructure, consolidateContent, extractContent, generateFinalSections, generateSynopsis } from './services/geminiService.js';
import type { DocumentStructure, ExtractionResult, GenerationJobProgress } from './types/index.js';
import CacheStats from './components/CacheStats.js';

interface UploadedPdf {
  id: string;
  name: string;
  text: string;
}

function createInitialProgress(): GenerationJobProgress {
  return { status: 'IDLE', progress: 0 };
}

export function App(): JSX.Element {
  const [pdfs, setPdfs] = useState<UploadedPdf[]>([]);
  const [structure, setStructure] = useState<DocumentStructure | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [job, setJob] = useState<GenerationJobProgress>(createInitialProgress);

  const keywords = useMemo(() => structure?.conteudo.flatMap((section) => [section.topico, ...section.subtopicos]) ?? [], [structure]);

  const updateJob = useCallback((status: GenerationJobProgress['status'], progress: number, message?: string, errorDetails?: string) => {
    setJob({ status, progress, message, errorDetails });
  }, []);

  const handlePdfUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const readers = Array.from(files).map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      text: await file.text(),
    }));

    setPdfs(await Promise.all(readers));
    setStructure(null);
    setMarkdown('');
    setJob(createInitialProgress());
  }, []);

  const runPipeline = useCallback(async () => {
    if (pdfs.length === 0) {
      updateJob('FAILED', 0, 'Envie ao menos um PDF para iniciar.');
      return;
    }

    updateJob('RUNNING', 0, 'Analisando estrutura do documento...');

    try {
      const fullText = pdfs.map((pdf) => pdf.text).join('\n\n');
      const structureResult = await analyzeStructure(fullText);

      if (!structureResult) {
        updateJob('FAILED', 0, 'Não foi possível identificar a estrutura do documento.');
        return;
      }

      setStructure(structureResult);
      updateJob('RUNNING', 10, 'Extraindo tópicos relevantes...');

      const extracts: ExtractionResult[] = [];

      for (const section of structureResult.conteudo) {
        const sectionText = await extractContent(fullText, section.topico);
        if (sectionText) {
          extracts.push({ fonte: section.topico, conteudo: sectionText });
        }
      }

      updateJob('RUNNING', 55, 'Consolidando conteúdo em Supercaderno...');

      const consolidatedSections = await Promise.all(
        structureResult.conteudo.map(async (section) => {
          const sectionExtracts = extracts.filter((extract) => extract.fonte === section.topico);
          return consolidateContent(section.topico, sectionExtracts);
        }),
      );

      const mergedMarkdown = consolidatedSections.join('\n\n');
      updateJob('RUNNING', 75, 'Gerando seções finais obrigatórias...');

      const finalSections = await generateFinalSections(mergedMarkdown);
      const synopsis = await generateSynopsis(mergedMarkdown, structureResult.titulo_documento);

      const fullMarkdown = `${synopsis}\n\n${mergedMarkdown}\n\n${finalSections}`;
      setMarkdown(fullMarkdown);
      updateJob('COMPLETED', 100, 'Supercaderno concluído com sucesso!');
    } catch (error) {
      console.error(error);
      updateJob('FAILED', job.progress, 'Falha ao gerar Supercaderno.', error instanceof Error ? error.message : String(error));
    }
  }, [job.progress, pdfs, updateJob]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Supercaderno Generator</h1>
        <p className="text-sm text-slate-600">
          Implementação focada em cache inteligente, rate limiting e uso correto dos modelos do Gemini.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">1. Envie seus PDFs</h2>
        <input
          aria-label="Enviar arquivos PDF"
          type="file"
          accept="application/pdf"
          multiple
          onChange={(event) => handlePdfUpload(event.target.files)}
          className="mt-3 w-full rounded border border-dashed border-slate-300 p-3"
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">2. Gerar Supercaderno</h2>
        <button
          type="button"
          onClick={runPipeline}
          className="mt-3 rounded bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-700"
        >
          Gerar
        </button>
        {job.message && (
          <p className="mt-4 text-sm text-slate-600">
            <strong>Status:</strong> {job.message} ({job.progress.toFixed(0)}%)
          </p>
        )}
        {job.errorDetails && <p className="mt-2 text-sm text-red-600">{job.errorDetails}</p>}
      </section>

      {markdown && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Resultado</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">{markdown}</pre>
        </section>
      )}

      <CacheStats />

      <footer className="pb-6 text-center text-xs text-slate-500">
        Palavras-chave detectadas: {keywords.length > 0 ? keywords.join(', ') : 'Nenhuma' }
      </footer>
    </main>
  );
}

export default App;
