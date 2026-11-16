// ADR-0196 emenda 2026-11-15 — atacado em Publicados: selo por produto e plano do botão "Atacado (N)". Puro (vitest).
import type { FaixaAtacado } from './atacado';
import type { PublicadoItem } from './publicados';

/** Configuração do PubliAI (não o ML). `por_cor` e `entre_lotes` só se ajustam na Revisão. */
export type SeloAtacado =
  | { tipo: 'faixas'; faixas: FaixaAtacado[] }
  | { tipo: 'por_cor' }
  | { tipo: 'entre_lotes' };

export const MSG_POR_COR = 'Atacado por cor: ajuste na Revisão';
export const MSG_ENTRE_LOTES = 'Atacado diferente entre lotes — ajuste na Revisão';

/** Por codigo_pai. Espelha `configDoProduto` do servidor: a única config não nula entre os lotes; `[]` = sem atacado. */
export function selosAtacado(
  lotes: { codigo_pai: string; atacado: unknown }[], paisPorCor: Iterable<string>,
): Map<string, SeloAtacado> {
  const porPai = new Map<string, Map<string, FaixaAtacado[]>>();
  for (const l of lotes) {
    if (!Array.isArray(l.atacado)) continue;
    const unicas = porPai.get(l.codigo_pai) ?? new Map<string, FaixaAtacado[]>();
    unicas.set(JSON.stringify(l.atacado), l.atacado as FaixaAtacado[]);
    porPai.set(l.codigo_pai, unicas);
  }
  const out = new Map<string, SeloAtacado>();
  for (const [pai, unicas] of porPai) {
    if (unicas.size > 1) { out.set(pai, { tipo: 'entre_lotes' }); continue; }
    const faixas = [...unicas.values()][0];
    if (faixas.length) out.set(pai, { tipo: 'faixas', faixas: [...faixas].sort((a, b) => a.min_unidades - b.min_unidades) });
  }
  for (const pai of paisPorCor) out.set(pai, { tipo: 'por_cor' });
  return out;
}

export interface PlanoAtacado {
  /** Uma família por produto: a chave de `atacado` no pedido do preview. */
  familias: string[];
  produtos: { codigoPai: string; familiaId: string; titulo: string; ehKit: boolean }[];
  fora: { codigoPai: string; titulo: string; motivo: string }[];
  /** Faixas comuns a todos os produtos elegíveis; senão vazio. */
  faixasIniciais: FaixaAtacado[];
}

const ATIVO = new Set(['ativo', 'pausado']);

/** `todos`: a lista inteira da tela, para achar as outras linhas do produto (split, UP). */
export function planejarAtacado(selecionados: PublicadoItem[], todos: PublicadoItem[]): PlanoAtacado {
  const plano: PlanoAtacado = { familias: [], produtos: [], fora: [], faixasIniciais: [] };
  const porPai = new Map<string, PublicadoItem[]>();
  for (const i of selecionados) porPai.set(i.codigoPai, [...(porPai.get(i.codigoPai) ?? []), i]);
  const iniciais = new Set<string>();
  for (const [pai, linhas] of porPai) {
    const i = linhas[0];
    const doProduto = [...todos.filter((t) => t.codigoPai === pai), ...linhas];
    const motivo = i.ehKitVirtual || !i.familiaId ? 'Kit Virtual não tem atacado'
      : linhas.some((l) => l.publicacaoIncompleta) ? 'Publicação incompleta: conclua ou remova antes'
      : !linhas.some((l) => l.status && ATIVO.has(l.status)) ? 'Só anúncio ativo ou pausado'
        : i.atacado?.tipo === 'por_cor' ? MSG_POR_COR
          : i.atacado?.tipo === 'entre_lotes' ? MSG_ENTRE_LOTES
            // ponytail: a expansão do servidor (deps.ts) ignora a partição Legacy quando o produto tem UP.
            : doProduto.some((l) => l.userProducts) && doProduto.some((l) => l.particaoSplit)
              ? 'Produto com anúncio UP e partição clássica — ajuste na Revisão' : null;
    if (motivo) { plano.fora.push({ codigoPai: pai, titulo: i.titulo, motivo }); continue; }
    plano.produtos.push({ codigoPai: pai, familiaId: i.familiaId, titulo: i.titulo, ehKit: !!i.kitBaseCodigoPai });
    plano.familias.push(i.familiaId);
    iniciais.add(i.atacado?.tipo === 'faixas' ? JSON.stringify(i.atacado.faixas) : '');
  }
  const [unica] = iniciais;
  if (iniciais.size === 1 && unica) plano.faixasIniciais = JSON.parse(unica) as FaixaAtacado[];
  return plano;
}
