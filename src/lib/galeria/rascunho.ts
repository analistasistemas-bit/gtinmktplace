// Galeria IA (Fase B): edições puras do rascunho do roteiro. Sem React: o hook `useRascunhoRoteiro` e a tela usam.
import type { Fato, MissaoRoteiro, Roteiro } from './api';
import { motivosDeTexto } from './compor';
import { EMBALAGEM, rotuloFato, TEXTOS_LONGOS, usavel } from './rotulos';

/**
 * Conteúdo como vai ao servidor: item vazio sai das listas (na tela o operador limpa o 2º benefício sem o 3º subir
 * de lugar) e o motivo de desligada sai de missão ligada (o servidor só o guarda em missão desligada).
 */
export function paraEnvio(r: Roteiro): Roteiro {
  return {
    ...r,
    missoes: r.missoes.map((m) => {
      const x: MissaoRoteiro = { ...m };
      for (const k of ['beneficios', 'etapas', 'legendas'] as const) if (x[k]) x[k] = x[k]!.filter((s) => s.trim() !== '');
      if (x.ativa) delete (x as { motivoDesligada?: string }).motivoDesligada;
      return x;
    }),
  };
}

/** Snapshot comparável do que iria ao servidor. */
export const snapshot = (r: Roteiro) => JSON.stringify(paraEnvio(r));

export const editarMissao = (r: Roteiro, n: number, parte: Partial<MissaoRoteiro>): Roteiro =>
  ({ ...r, missoes: r.missoes.map((m) => (m.missao === n ? { ...m, ...parte } : m)) });

/** Remove a spec pela POSIÇÃO (duas specs podem citar o mesmo campo: nunca filtrar por `campo`). */
export function removerSpec(r: Roteiro, n: number, indice: number): Roteiro {
  const m = r.missoes.find((x) => x.missao === n);
  return editarMissao(r, n, { specs: (m?.specs ?? []).filter((_, i) => i !== indice) });
}

/** Põe na posição (ou acrescenta no fim) a spec de um dado confirmado: rótulo e valor vêm do dado, nunca digitados. */
export function definirSpec(r: Roteiro, n: number, indice: number, f: Fato): Roteiro {
  const specs = [...(r.missoes.find((x) => x.missao === n)?.specs ?? [])];
  specs[Math.min(indice, specs.length)] = { campo: f.campo, rotulo: rotuloFato(f), valor: f.valor };
  return editarMissao(r, n, { specs });
}

/**
 * Dados que a ficha técnica pode mostrar: utilizáveis, fora das medidas da embalagem (R8.1) e dos textos longos,
 * e que cabem na caixa do layout (mesma conta da composição).
 */
export const specsElegiveis = (fatos: Fato[]): Fato[] => fatos.filter((f) => usavel(f) && !EMBALAGEM.has(f.campo)
  && !TEXTOS_LONGOS.has(f.campo) && motivosDeTexto(5, { specs: [{ rotulo: rotuloFato(f), valor: f.valor }] }, false).length === 0);
