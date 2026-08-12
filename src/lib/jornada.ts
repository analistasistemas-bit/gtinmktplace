import type { LoteStatus } from '@/lib/tipos-dominio';

export interface EtapaJornada {
  chave: string;
  label: string;
  /** Rótulo quando a etapa está em erro — "Publicado" em vermelho continua lendo como
   *  publicado, e o ponto todo é dizer que não publicou. */
  labelErro?: string;
}

/** As 4 etapas visíveis da jornada do lote. `erro` é estado lateral, não etapa. */
export const ETAPAS_JORNADA: EtapaJornada[] = [
  { chave: 'enviado', label: 'Enviado' },
  { chave: 'processando', label: 'Processando' },
  { chave: 'revisao', label: 'Revisão' },
  { chave: 'publicado', label: 'Publicado', labelErro: 'Não publicado' },
];

export interface EstadoJornada {
  /** Índice da etapa atual (0-3); ETAPAS_JORNADA.length (4) = tudo concluído. */
  indiceAtual: number;
  erro: boolean;
}

/** Desfecho da publicação, quando conhecido. Sem ele a jornada segue só o status do lote. */
export interface ResultadoPublicacao {
  publicadas: number;
  erros: number;
}

/** Mapeia o status técnico do lote para a posição na jornada visível.
 *
 *  `concluido` significa "o lote terminou de rodar", não "publicou": um lote cujas famílias
 *  foram todas recusadas pelo ML fecha como concluído do mesmo jeito. Com `resultado` em mão,
 *  esse caso para na etapa Publicado em estado de erro — antes o stepper acendia as 4 etapas em
 *  verde na mesma tela que dizia "0 publicada(s) · 1 com erro" (lote #46). */
export function jornadaDoLote(status: LoteStatus, resultado?: ResultadoPublicacao): EstadoJornada {
  if (status === 'concluido' && resultado && resultado.publicadas === 0 && resultado.erros > 0) {
    return { indiceAtual: ETAPAS_JORNADA.length - 1, erro: true };
  }
  switch (status) {
    case 'importando':
      return { indiceAtual: 0, erro: false };
    case 'processando':
      return { indiceAtual: 1, erro: false };
    case 'revisao':
      return { indiceAtual: 2, erro: false };
    case 'publicando':
      return { indiceAtual: 3, erro: false };
    case 'concluido':
      return { indiceAtual: ETAPAS_JORNADA.length, erro: false };
    case 'erro':
      // Falha global de ingest/processamento: marca a etapa Processando.
      return { indiceAtual: 1, erro: true };
  }
}

/** Destino de retomada do lote conforme o status ("continuar de onde parei"). */
export function destinoDoLote(status: LoteStatus, id: string): string {
  if (status === 'revisao') return `/revisao/${id}`;
  if (status === 'concluido' || status === 'erro') return `/relatorio/${id}`;
  return `/progresso/${id}`;
}
