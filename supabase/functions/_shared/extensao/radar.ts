// Radar do Pulse no painel (ADR-0189 D-2, Task 18): só o que o Pulse JÁ coletou para a org; nada da página vai ao Pulse.
// Puro: recebe as linhas lidas (já filtradas por org) e devolve a resposta do painel.

export interface LinhaProdutoPulse {
  id: string;
  status: string;
  ultimo_snapshot_em: string | null;
  ptw_status: string | null;
  ptw_preco_sugerido: number | null;
  ptw_aplicavel: boolean | null;
  ptw_atualizado_em: string | null;
  meu_item_id: string | null;
  meu_preco: number | null;
}
export interface LinhaAlertaPulse { tipo: string; payload: unknown; severidade: string | null; criado_em: string }

export interface AlertaRadar {
  tipo: 'preco_caiu' | 'novo_concorrente' | 'concorrente_saiu';
  criadoEm: string;
  acao: boolean; // severidade 'acao' do Pulse (afeta o nosso preço)
  de: number | null; para: number | null; // preco_caiu
  preco: number | null; vendedor: string | null; // concorrente
}

export type RespostaRadar =
  | { modulo: false }
  | { modulo: true; noRadar: false }
  | {
    modulo: true; noRadar: true;
    status: 'ativo' | 'pausado';
    ultimaColetaEm: string | null; // null = aguardando a 1ª coleta
    /** Referência de preço do ML (`/suggestions` do NOSSO anúncio; o coletor só grava com anúncio próprio publicado).
     *  Só quando o ML a marca como aplicável. Não é o "preço para ganhar" do catálogo. */
    referenciaML: { preco: number; atualizadoEm: string | null } | null;
    ofertasAtivas: number | null; // null = sem coleta (não é zero)
    menorPrecoObservado: number | null; // menor oferta ativa da última coleta (não é o "menor relevante" do Pulse)
    meuPreco: number | null;
    alertas: AlertaRadar[];
  };

const TIPOS = new Set(['preco_caiu', 'novo_concorrente', 'concorrente_saiu']);
// numeric do Postgres pode chegar como texto conforme o cliente; texto vazio ou não numérico → null.
const numero = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const texto = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v.slice(0, 60) : null);

/** Só os campos que o painel mostra; o resto do payload (ids de item/vendedor) não sai da edge. */
function alerta(a: LinhaAlertaPulse): AlertaRadar | null {
  if (!TIPOS.has(a.tipo)) return null;
  const p = (a.payload ?? {}) as Record<string, unknown>;
  return {
    tipo: a.tipo as AlertaRadar['tipo'], criadoEm: a.criado_em, acao: a.severidade === 'acao',
    de: numero(p.de), para: numero(p.para), preco: numero(p.preco), vendedor: texto(p.nickname),
  };
}

export function montarRadar(produto: LinhaProdutoPulse | null, precosAtivos: number[], alertas: LinhaAlertaPulse[]): RespostaRadar {
  if (!produto || (produto.status !== 'ativo' && produto.status !== 'pausado')) return { modulo: true, noRadar: false };
  const coletado = produto.ultimo_snapshot_em !== null;
  const referencia = produto.ptw_aplicavel === true ? numero(produto.ptw_preco_sugerido) : null;
  return {
    modulo: true, noRadar: true,
    status: produto.status,
    ultimaColetaEm: produto.ultimo_snapshot_em,
    referenciaML: referencia !== null ? { preco: referencia, atualizadoEm: produto.ptw_atualizado_em } : null,
    ofertasAtivas: coletado ? precosAtivos.length : null,
    menorPrecoObservado: coletado && precosAtivos.length > 0 ? Math.min(...precosAtivos) : null,
    meuPreco: numero(produto.meu_preco),
    alertas: alertas.map(alerta).filter((a): a is AlertaRadar => a !== null),
  };
}
