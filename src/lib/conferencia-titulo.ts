import type { Familia } from './tipos-dominio';

// ADR-0198: conferência determinística do título na Revisão. A IA pode omitir o nome comercial
// mesmo com o prompt certo, então o aviso não depende dela. Avisa, não bloqueia.

const IGNORADAS = new Set([
  'com', 'sem', 'para', 'por', 'das', 'dos', 'nas', 'nos', 'que', 'und', 'unidade', 'unidades', 'cor', 'cores',
]);

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const tokens = (s: string) => normalizar(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Palavras do nome da planilha que não chegaram ao título, na ordem do nome. */
export function palavrasForaDoTitulo(nomePai: string | null | undefined, titulo: string): string[] {
  const noTitulo = new Set(tokens(titulo));
  const relevantes = tokens(nomePai ?? '').filter(
    (t) => t.length >= 3 && /^\p{L}+$/u.test(t) && !IGNORADAS.has(t) && !noTitulo.has(t),
  );
  return [...new Set(relevantes)];
}

/** Ids de famílias novas do lote com título igual: o ML derruba a segunda por duplicado (ADR-0044). */
export function titulosRepetidos(familias: Familia[]): Set<string> {
  const porTitulo = new Map<string, string[]>();
  for (const f of familias) {
    if (f.operacao !== 'CREATE' || f.status === 'publicado' || f.status === 'publicando') continue;
    const chave = normalizar(f.titulo);
    porTitulo.set(chave, [...(porTitulo.get(chave) ?? []), f.id]);
  }
  return new Set([...porTitulo.values()].filter((ids) => ids.length > 1).flat());
}

/** `Outra` é o veredito do Vision, não uma cor: em produto simples o campo fica vazio. */
export function corExibida(cor: string | null | undefined, exigeCor: boolean): string {
  return !exigeCor && cor === 'Outra' ? '' : cor ?? '';
}
