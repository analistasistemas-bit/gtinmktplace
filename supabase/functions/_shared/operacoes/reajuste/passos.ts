// ADR-0196 — plano de escrita de um item: a ordem dos passos garante, em cada estado intermediário, base acima de toda
// oferta (decisão 3) e toda faixa abaixo do base (decisão 7).
import type { FaixaAtacado } from '../../canais/contrato.ts';
import { centavos, semAlteracao } from './alvo.ts';
import type { FaixaPreco, OfertaVigente, Passo } from './tipos.ts';

export interface EntradaPassos {
  base: number; alvo: number; ofertas: OfertaVigente[];
  /** Novo preço por `chave` da oferta. */
  ofertasNovas: Record<string, number>;
  /** `chave` das ofertas a deixar. */
  sair: string[];
  faixasAntes: FaixaPreco[];
  /** null = faixas não mudam. */
  faixasAlvo: FaixaPreco[] | null;
  /** Configuração efetiva do atacado: o Reverter exige a mesma. */
  faixasConfig: FaixaAtacado[] | null;
}
export interface Estado { base: number; ofertas: OfertaVigente[]; faixas: FaixaPreco[] }

export const ehFaixas = (p: Passo): p is Extract<Passo, { tipo: 'faixas' }> => p.tipo === 'faixas';

export function violacao({ base, ofertas, faixas }: Estado): string | null {
  const b = centavos(base);
  for (const o of ofertas) {
    if (o.preco === null) return `oferta ${o.chave} sem preço comprovado`;
    if (b <= centavos(o.preco)) return `base ${base} igual ou abaixo da oferta ${o.chave} de ${o.preco}`;
  }
  for (const f of faixas) {
    if (centavos(f.preco) >= b) return `faixa de ${f.min_unidades} unidades de ${f.preco} igual ou acima do base ${base}`;
  }
  return null;
}

/** Um estado depois de cada passo; o estado de partida não entra, ele não é efeito do plano. */
export function estadosIntermediarios(base: number, ofertas: OfertaVigente[], faixas: FaixaPreco[], passos: Passo[]): Estado[] {
  let e: Estado = { base, ofertas, faixas };
  return passos.map((p) => {
    if (p.tipo === 'saida') e = { ...e, ofertas: e.ofertas.filter((o) => o.chave !== p.oferta.chave) };
    if (p.tipo === 'oferta') e = { ...e, ofertas: e.ofertas.map((o) => (o.chave === p.oferta.chave ? { ...o, preco: p.alvo } : o)) };
    if (p.tipo === 'faixas') e = { ...e, faixas: p.alvo };
    if (p.tipo === 'base') e = { ...e, base: p.alvo };
    return e;
  });
}

/** Descendo: saídas, ofertas, faixas, base. Subindo: base, ofertas, faixas. Sem mudança de base: só faixas; oferta ou saída
 *  pedida nesse caso lança. Lança se algum estado viola as invariantes. */
export function planejarPassos(e: EntradaPassos): Passo[] {
  if (semAlteracao(e.base, e.alvo) && (e.sair.length || Object.keys(e.ofertasNovas).length)) {
    throw new Error('sem mudança de base: só faixas');
  }
  const saidas = e.ofertas.filter((o) => e.sair.includes(o.chave)).map((oferta): Passo => ({ tipo: 'saida', oferta, estado: 'pendente' }));
  const ofertas = e.ofertas.filter((o) => o.chave in e.ofertasNovas).map((oferta): Passo => {
    // O passo substitui o preço no estado seguinte: sem esta trava, a oferta sem preço escaparia de `violacao`.
    if (oferta.preco === null) throw new Error(`oferta ${oferta.chave} sem preço comprovado`);
    return { tipo: 'oferta', oferta, anterior: oferta.preco, alvo: e.ofertasNovas[oferta.chave], estado: 'pendente' };
  });
  const faixas: Passo[] = e.faixasAlvo ? [{ tipo: 'faixas', anterior: e.faixasAntes, alvo: e.faixasAlvo, config: e.faixasConfig, estado: 'pendente' }] : [];
  const base: Passo[] = semAlteracao(e.base, e.alvo) ? [] : [{ tipo: 'base', anterior: e.base, alvo: e.alvo, estado: 'pendente' }];
  const subindo = centavos(e.alvo) > centavos(e.base);
  const passos = subindo ? [...saidas, ...base, ...ofertas, ...faixas] : [...saidas, ...ofertas, ...faixas, ...base];

  for (const estado of estadosIntermediarios(e.base, e.ofertas, e.faixasAntes, passos)) {
    const v = violacao(estado);
    if (v) throw new Error(v);
  }
  return passos;
}
