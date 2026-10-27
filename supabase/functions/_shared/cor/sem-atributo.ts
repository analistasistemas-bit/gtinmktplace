// Emenda ADR-0044 (2026-10-27): em categoria do ML sem atributo de cor, a cor que só o Vision
// achou é a da embalagem (shampoo "Preto"), não do produto — não entra em título nem descrição.
import type { AtributoSchema } from '../categoria/schema.ts';
import { atualizarSecaoCores } from '../ml/criar-item.ts';
import { DISCLAIMER_TONALIDADE } from '../ai/copywriter-prompt.ts';

/** Lista vazia = schema não lido (sem token/erro): mantém o comportamento anterior. */
export function categoriaAceitaCor(schema: AtributoSchema[]): boolean {
  return schema.length === 0 || schema.some((a) => a.id === 'COLOR' || a.id === 'MAIN_COLOR');
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tira cada cor (palavra inteira, sem acento/caixa) do slot do título. */
export function removerCorDoSlot(texto: string, cores: string[]): string {
  let tokens = texto.split(/\s+/).filter(Boolean);
  for (const cor of cores) {
    const alvo = cor.split(/\s+/).filter(Boolean).map(semAcento);
    for (let i = 0; i + alvo.length <= tokens.length; i++) {
      if (alvo.every((t, j) => semAcento(tokens[i + j]) === t)) {
        tokens = [...tokens.slice(0, i), ...tokens.slice(i + alvo.length)];
        i--;
      }
    }
  }
  return tokens.join(' ');
}

/** Tira as cores de todos os slots do título; cor escrita na fonte (nome/descrição) fica. */
export function removerCorDosSlots<T extends object>(slots: T, cores: string[], fonte: string): T {
  const fonteNorm = ` ${semAcento(fonte).replace(/[^a-z0-9]+/g, ' ')} `;
  const semRespaldo = cores.filter((c) => !fonteNorm.includes(` ${semAcento(c).replace(/[^a-z0-9]+/g, ' ').trim()} `));
  if (!semRespaldo.length) return slots;
  return Object.fromEntries(
    Object.entries(slots).map(([k, v]) => [k, typeof v === 'string' ? removerCorDoSlot(v, semRespaldo) : v]),
  ) as T;
}

/** Remove a seção "🎨 CORES DISPONÍVEIS" e a ressalva de tonalidade que só existe por causa dela. */
export function removerSecaoCores(descricao: string): string {
  return atualizarSecaoCores(descricao, [])
    .split('\n').filter((l) => l.trim() !== DISCLAIMER_TONALIDADE).join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
