// ADR-0195: resumo da conferência pós-escrita no Mercado Livre, para Progresso e Relatório.

export interface DivergenteMl { sku: string; enviado: number; observado: number | null }

export interface ConfirmacaoMl {
  id: string;
  familia_id: string;
  codigo_pai: string;
  item_externo_id: string;
  status: string;
  divergentes: DivergenteMl[];
  capados: number;
  enviado_em: string;
}

export interface ResumoConfirmacoes {
  confirmadas: number;
  aguardando: number;
  inconclusivas: number;
  semConferencia: number;
  falhas: ConfirmacaoMl[];
  capados: number;
}

// As 3 leituras terminam em ~14 min. Passou disso, o job se perdeu e a linha nunca vai fechar.
const TETO_AGUARDANDO_MS = 20 * 60 * 1000;
const INTERVALO_MS = 5000;
const GRAVIDADE = ['confirmado', 'aguardando', 'inconclusivo', 'falhou'];

const aguardandoNoPrazo = (l: ConfirmacaoMl, agora: Date): boolean =>
  l.status === 'aguardando' && agora.getTime() - Date.parse(l.enviado_em) <= TETO_AGUARDANDO_MS;

const statusEfetivo = (l: ConfirmacaoMl, agora: Date): string =>
  l.status === 'aguardando' && !aguardandoNoPrazo(l, agora) ? 'inconclusivo' : l.status;

export function resumirConfirmacoes(
  linhas: ConfirmacaoMl[], familiasPublicadas: string[], agora: Date,
): ResumoConfirmacoes {
  const piorPorFamilia = new Map<string, string>();
  for (const l of linhas) {
    const status = statusEfetivo(l, agora);
    const atual = piorPorFamilia.get(l.familia_id);
    if (!atual || GRAVIDADE.indexOf(status) > GRAVIDADE.indexOf(atual)) piorPorFamilia.set(l.familia_id, status);
  }
  const contar = (status: string) => [...piorPorFamilia.values()].filter((s) => s === status).length;
  return {
    confirmadas: contar('confirmado'),
    aguardando: contar('aguardando'),
    inconclusivas: contar('inconclusivo'),
    semConferencia: linhas.length === 0 ? 0 : familiasPublicadas.filter((id) => !piorPorFamilia.has(id)).length,
    falhas: linhas.filter((l) => l.status === 'falhou'),
    capados: linhas.reduce((soma, l) => soma + l.capados, 0),
  };
}

/** Com o lote publicando relê mesmo sem linhas: a tela abre antes da primeira escrita. */
export function intervaloConfirmacoes(linhas: ConfirmacaoMl[], lotePublicando: boolean, agora: Date): number | false {
  return lotePublicando || linhas.some((l) => aguardandoNoPrazo(l, agora)) ? INTERVALO_MS : false;
}
