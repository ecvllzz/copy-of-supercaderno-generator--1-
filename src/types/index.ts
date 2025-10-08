export interface DocumentStructureSection {
  topico: string;
  subtopicos: string[];
}

export interface DocumentStructure {
  titulo_documento: string;
  conteudo: DocumentStructureSection[];
}

export interface ExtractionResult {
  fonte: string;
  conteudo: string;
}

export interface GenerationJobProgress {
  status: 'IDLE' | 'RUNNING' | 'FAILED' | 'COMPLETED';
  progress: number;
  message?: string;
  errorDetails?: string;
}
