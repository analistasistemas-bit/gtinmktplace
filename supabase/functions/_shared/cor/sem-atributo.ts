// Emenda ADR-0044 (2026-10-27): em categoria do ML sem atributo de cor, a cor que só o Vision
// achou é a da embalagem (shampoo "Preto"), não do produto — não entra em título nem descrição.
import type { AtributoSchema } from '../categoria/schema.ts';

/** Lista vazia = schema não lido (sem token/erro): mantém o comportamento anterior. */
export function categoriaAceitaCor(schema: AtributoSchema[]): boolean {
  return schema.length === 0 || schema.some((a) => a.id === 'COLOR' || a.id === 'MAIN_COLOR');
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Tira cada cor (palavra inteira, sem acento/caixa, inclusive colada em pontuação) do slot. */
export function removerCorDoSlot(texto: string, cores: string[]): string {
  // Partes alternadas: [palavra, separador, palavra, …] — separador preservado para remontar.
  const partes = texto.split(/([^\p{L}\p{N}]+)/u);
  for (const cor of cores) {
    const alvo = palavras(cor).map(semAcento);
    for (let i = 0; i < partes.length; i += 2) {
      const bate = alvo.every((t, j) => semAcento(partes[i + 2 * j] ?? '') === t);
      if (alvo.length && bate) for (let j = 0; j < alvo.length; j++) partes[i + 2 * j] = '';
    }
  }
  return partes.join('')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s*([,/|;-])\s*(?=[,/|;-]|$)/g, '')
    .replace(/^[\s,/|;-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tira as cores de todos os slots do título; cor escrita na fonte (nome/descrição) fica. */
export function removerCorDosSlots<T extends object>(slots: T, cores: string[], fonte: string): T {
  const fonteNorm = ` ${palavras(semAcento(fonte)).join(' ')} `;
  const semRespaldo = cores.filter((c) => !fonteNorm.includes(` ${palavras(semAcento(c)).join(' ')} `));
  if (!semRespaldo.length) return slots;
  return Object.fromEntries(
    Object.entries(slots).map(([k, v]) => [k, typeof v === 'string' ? removerCorDoSlot(v, semRespaldo) : v]),
  ) as T;
}

const RE_SECAO_CORES = /CORES DISPON[IÍ]VEIS/i;
const ehItem = (l: string) => /^\s*[-•✔▪*]\s+/.test(l);
// ✔ também é emoji: sem excluir itens, "✔ Preto" passava por cabeçalho da próxima seção.
const ehCabecalho = (l: string) => !ehItem(l) && /^\p{Extended_Pictographic}/u.test(l.trim());

/**
 * Tira da seção "🎨 CORES DISPONÍVEIS" os itens das cores descartadas (qualquer marcador). Sem
 * nenhum item restante, remove a seção inteira até o próximo cabeçalho (inclui a ressalva de
 * tonalidade, que só existe por causa da lista).
 */
export function removerCoresDaSecao(descricao: string, cores: string[]): string {
  const linhas = descricao.split('\n');
  const ini = linhas.findIndex((l) => RE_SECAO_CORES.test(l));
  if (ini === -1) return descricao;
  let fim = ini + 1;
  while (fim < linhas.length && !ehCabecalho(linhas[fim])) fim++;
  const descartar = new Set(cores.map((c) => palavras(semAcento(c)).join(' ')));
  const corpo = linhas.slice(ini + 1, fim)
    .filter((l) => !(ehItem(l) && descartar.has(palavras(semAcento(l)).join(' '))));
  const secao = corpo.some(ehItem) ? [linhas[ini], ...corpo] : [];
  return [...linhas.slice(0, ini), ...secao, ...linhas.slice(fim)].join('\n').replace(/\n{3,}/g, '\n\n');
}
