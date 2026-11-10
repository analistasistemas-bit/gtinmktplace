// Plano de fotos de um item (galeria da cor, plano Task 13). Puro: o mesmo planejador serve à ida (aplicar) e à
// volta (compensar), sempre com TODAS as variações do GET (o ML apaga variação omitida) e nunca preço, status ou
// estoque. Corpo mínimo medido no ensaio da Task 1 (docs/superpowers/specs/2026-11-08-galeria-da-cor-ensaio-put.md).
import type { CorpoFotosML } from '../ml/atualizar-item.ts';
import { motivoElegibilidade, type Alvo, type ItemElegibilidade } from './alvos.ts';

/**
 * Chaves do corpo por formato (ensaio (b)/(d)). Legacy sempre com `pictures`, também quando só reordena: forma
 * re-medida em (b)-4. Nenhum formato exige `available_quantity`, então nenhum fica bloqueado.
 */
export const CORPO_MINIMO = { legacy: ['pictures', 'variations'], plano: ['pictures'] } as const;

/** SKU → picture_ids na ordem (`fotos_antes`, `fotos_depois`). */
export type FotosPorSku = Record<string, string[]>;
/** Fotos do item que entram no "mudou": `pictures` e as variações com `picture_ids`. */
export type RetratoItem = Pick<ItemElegibilidade, 'pictures' | 'variacoes'>;

interface Comum {
  /** GET de `lerElegibilidadeItemML` imediatamente antes do PUT. */
  atual: ItemElegibilidade;
  variacoesAlvo: Alvo['variacoes'];
}
export interface EntradaIda extends Comum {
  direcao: 'ida';
  retrato: RetratoItem;
  /** Manifesto congelado: `id` = upload id da foto (`fotos_novas`); a ordem final vem de `missao`. */
  fotosDaCor: Array<{ missao: number; id: string }>;
  capaAprovada: boolean;
  modo: 'substituir' | 'adicionar';
  limiteVar: number;
  limiteItem: number;
}
export interface EntradaVolta extends Comum {
  direcao: 'volta';
  /** `fotos_antes` da cor. */
  fotosDaCor: FotosPorSku;
  /** `fotos_depois` lidos no GET de conferência da ida. */
  fotosDepois: FotosPorSku;
  /** `pictures` do item antes da ida (retrato): a volta restaura essa ordem. */
  picturesAntes: string[];
}
export type MotivoPlano =
  | 'mudou' | 'limite' | 'variacao_ausente' | 'catalogo' | 'catalogo_desconhecido' | 'migracao_pendente' | 'reversao_incompleta';
export type ResultadoPlano = { ok: true; corpo: CorpoFotosML } | { ok: false; motivo: MotivoPlano; detalhe: string };

const igual = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const falha = (motivo: MotivoPlano, detalhe: string): ResultadoPlano => ({ ok: false, motivo, detalhe });

/** Fotos atuais de cada variação-alvo (UP plano: `pictures` do item). Variação-alvo ausente no item → null. */
export function fotosDaCorNoItem(item: RetratoItem, alvos: Alvo['variacoes']): FotosPorSku | null {
  const r: FotosPorSku = {};
  for (const a of alvos) {
    if (a.variationId === null) {
      if (item.variacoes.length > 0) return null;
      r[a.sku] = [...item.pictures];
    } else {
      const v = item.variacoes.find((x) => x.id === a.variationId);
      if (!v) return null;
      r[a.sku] = [...v.pictureIds];
    }
  }
  return r;
}

function mudou(atual: RetratoItem, retrato: RetratoItem): string | null {
  if (atual.variacoes.length === 0 && retrato.variacoes.length === 0) {
    return igual(atual.pictures, retrato.pictures) ? null : 'pictures';
  }
  const ids = (i: RetratoItem) => i.variacoes.map((v) => v.id).sort((x, y) => x - y).join(',');
  if (ids(atual) !== ids(retrato)) return 'variacoes';
  for (const v of atual.variacoes) {
    if (!igual(v.pictureIds, retrato.variacoes.find((x) => x.id === v.id)!.pictureIds)) return `variacao_${v.id}`;
  }
  return null;
}

const listaDeIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');

/**
 * Corpo a partir das novas fotos da cor. `pictures` = fotos do item que seguem referenciadas, mais as que não eram
 * de nenhuma variação (não é a galeria que vai apagá-las), na ordem do GET; as novas entram no lugar da 1ª foto
 * removida (a cor dona de `pictures[0]` continua dona da posição 0), ou no fim se nada saiu. Com `ordem` (volta),
 * `pictures` é reordenado pelo retrato; o que não existe nele vai ao fim, na ordem atual.
 */
function montarCorpo(atual: ItemElegibilidade, novas: FotosPorSku, alvos: Alvo['variacoes'], ordem?: string[]): CorpoFotosML {
  if (atual.variacoes.length === 0) return { pictures: novas[alvos[0].sku].map((id) => ({ id })) };
  const porVar = new Map(alvos.map((a) => [a.variationId, novas[a.sku]]));
  const variations = atual.variacoes.map((v) => ({ id: v.id, picture_ids: [...(porVar.get(v.id) ?? v.pictureIds)] }));
  const antes = new Set(atual.variacoes.flatMap((v) => v.pictureIds));
  const depois = new Set(variations.flatMap((v) => v.picture_ids));
  const fica = (p: string) => depois.has(p) || !antes.has(p);
  const entram = [...new Set(variations.flatMap((v) => v.picture_ids))].filter((p) => !atual.pictures.includes(p));
  let pictures: string[] = [];
  let inseriu = false;
  for (const p of atual.pictures) {
    if (fica(p)) pictures.push(p);
    else if (!inseriu) { pictures.push(...entram); inseriu = true; }
  }
  if (!inseriu) pictures.push(...entram);
  if (ordem) {
    const pos = new Map(ordem.map((p, i) => [p, i]));
    pictures = [...pictures.filter((p) => pos.has(p)).sort((x, y) => pos.get(x)! - pos.get(y)!), ...pictures.filter((p) => !pos.has(p))];
  }
  return { pictures: pictures.map((id) => ({ id })), variations };
}

// Ordem das recusas (determinística): elegibilidade (catálogo, migração) → variação-alvo → mudou/reversão → limite.
export function planejarFotosItem(e: EntradaIda | EntradaVolta): ResultadoPlano {
  const cat = motivoElegibilidade(e.atual);
  if (cat) return falha(cat, e.atual.id);
  // ADR-0160: PUT nessa janela é aceito com 200 e perdido — vale também para a compensação.
  if (e.atual.tags.includes('variations_migration_pending')) return falha('migracao_pendente', e.atual.id);

  const correntes = fotosDaCorNoItem(e.atual, e.variacoesAlvo);

  if (e.direcao === 'volta') {
    if (!correntes) return falha('reversao_incompleta', `${e.atual.id}:variacao_ausente`);
    // fotos_antes/fotos_depois/retrato vêm de jsonb relido: chave ausente nunca vira lista vazia (apagaria as fotos
    // da cor) e todo elemento tem de ser id não vazio.
    if (!listaDeIds(e.picturesAntes)) return falha('reversao_incompleta', `${e.atual.id}:pictures_antes`);
    for (const a of e.variacoesAlvo) {
      const depois = e.fotosDepois[a.sku];
      if (!listaDeIds(depois) || !listaDeIds(e.fotosDaCor[a.sku]) || !igual(correntes[a.sku], depois)) {
        return falha('reversao_incompleta', `${e.atual.id}:${a.sku}`);
      }
    }
    const novas: FotosPorSku = {};
    for (const a of e.variacoesAlvo) novas[a.sku] = [...e.fotosDaCor[a.sku]];
    return { ok: true, corpo: montarCorpo(e.atual, novas, e.variacoesAlvo, e.picturesAntes) };
  }

  // Contrato do chamador (manifesto congelado da preparação): violado → lança, nunca planeja PUT.
  if (e.fotosDaCor.length === 0) throw new Error('planejarFotosItem: manifesto vazio');
  if (e.capaAprovada !== e.fotosDaCor.some((f) => f.missao === 1)) {
    throw new Error('planejarFotosItem: capaAprovada incoerente com a missão 1 do manifesto');
  }
  if (!correntes) return falha('variacao_ausente', e.atual.id);
  const m = mudou(e.atual, e.retrato);
  if (m) return falha('mudou', `${e.atual.id}:${m}`);

  const manifesto = [...e.fotosDaCor].sort((x, y) => x.missao - y.missao).map((f) => f.id);
  const limite = e.atual.variacoes.length === 0 ? e.limiteItem : e.limiteVar;
  const novas: FotosPorSku = {};
  for (const a of e.variacoesAlvo) {
    const atuais = correntes[a.sku];
    // R5.2/R9.3: no substituir, a capa aprovada lidera; sem ela, a 1ª foto atual fica (cor sem foto: só o manifesto).
    const lista = e.modo === 'adicionar' ? [...atuais, ...manifesto]
      : e.capaAprovada || atuais.length === 0 ? manifesto : [atuais[0], ...manifesto];
    if (lista.length > limite) return falha('limite', `${e.atual.id}:${a.sku}:${lista.length}>${limite}`);
    novas[a.sku] = lista;
  }
  return { ok: true, corpo: montarCorpo(e.atual, novas, e.variacoesAlvo) };
}
