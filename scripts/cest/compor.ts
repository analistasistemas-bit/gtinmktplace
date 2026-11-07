// ADR-0197 — compõe a tabela oficial de CEST a partir do HTML do Convênio ICMS 142/2018 (CONFAZ).
// Fonte: https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18

export type LinhaCest = { cest: string; ncmPrefixo: string; anexo: string; item: string; descricao: string }

// XXVI (porta a porta) e XXVII (escala industrial não relevante) ficam fora: ADR-0197 D-1.
const ANEXOS_FONTE = new Set([
  'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII',
  'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV',
])

// Erros de digitação da fonte (ADR-0197 D-8): nunca corrigidos por suposição.
const TOKENS_IGNORADOS: Record<string, string[]> = {
  '1711600': ['008.13', '009.09'],
  '2004000': ['926.90.90'],
}
const CEST_SEM_NCM = new Set(['0199900'])

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°' }

function texto(html: string): string {
  return html
    .replace(/<(br|p)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+);/g, (m, n) => ENTIDADES[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

export function comporTabelaCest(html: string): { linhas: LinhaCest[]; problemas: string[] } {
  const linhas = new Map<string, LinhaCest>()
  const problemas: string[] = []
  let anexo = ''
  for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>|>\s*ANEXO\s+([IVXL]+)\s*</g)) {
    if (m[2]) { anexo = m[2]; continue }
    const celulas = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1])
    const textos = celulas.map(texto)
    const i = textos.findIndex((t) => /^\d{2}\.\d{3}\.\d{2}$/.test(t))
    if (i < 0 || !ANEXOS_FONTE.has(anexo)) continue
    if (celulas.some((c) => /class="[^"]*verde/.test(c))) continue
    const descricao = textos.slice(i + 2).join(' ').trim()
    if (/^revogado/i.test(descricao)) continue
    const cest = textos[i].replace(/\./g, '')
    const tokens = (textos[i + 1] ?? '').split(/[\s,]+/).filter(Boolean)
    if (tokens.length === 0) {
      if (!CEST_SEM_NCM.has(cest)) problemas.push(`${cest}: linha sem NCM`)
      continue
    }
    for (const token of tokens) {
      if (TOKENS_IGNORADOS[cest]?.includes(token)) continue
      if (!/^\d{4}(\.\d{1,2}(\.\d{1,2})?)?$/.test(token)) {
        problemas.push(`${cest}: NCM "${token}" fora do padrão`)
        continue
      }
      const ncmPrefixo = token.replace(/\./g, '')
      const chave = `${cest}|${ncmPrefixo}`
      if (!linhas.has(chave)) linhas.set(chave, { cest, ncmPrefixo, anexo, item: textos[i - 1] ?? '', descricao })
    }
  }
  const sobrando = [...linhas.values()].filter((l) => /&\w+;/.test(l.descricao)).map((l) => `${l.cest}: entidade HTML na descrição`)
  return { linhas: [...linhas.values()], problemas: [...problemas, ...sobrando] }
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

export function sqlSeedCest(linhas: LinhaCest[]): string {
  const valores = linhas.map((l) => `(${[l.cest, l.ncmPrefixo, l.anexo, l.item, l.descricao].map(q).join(', ')})`)
  return `insert into public.cest_oficial (cest, ncm_prefixo, anexo, item, descricao) values\n${valores.join(',\n')}\non conflict (cest, ncm_prefixo) do update set anexo = excluded.anexo, item = excluded.item, descricao = excluded.descricao;`
}
