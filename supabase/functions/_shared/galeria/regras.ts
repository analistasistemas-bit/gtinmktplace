// Regras puras da "Galeria da cor por IA" (spec 2026-11-08-galeria-da-cor-regras.md).
// Sem imports de Deno/npm: roda igual na edge e no vitest.

/** R5.4: fecha, literalmente, todo prompt de imagem. Nunca cortar nem reescrever. */
export const BLOCO_TECNICO =
  'photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard'

/** R6.1: tetos de palavras por tipo de texto (contados em código). */
export const LIMITES = { headline: 5, subheadline: 10, beneficio: 6, etapa: 7, legenda: 5 } as const

export type Missao = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type Vista = 'frente' | 'costas' | 'lateral'

export interface MissaoDisponivel {
  missao: Missao
  nome: string
  /** Moda nunca leva texto (ADR-0201 §11); fora de Moda a capa (1) também não. */
  comTexto: boolean
  /** false = recorte da foto real, sem provedor e sem cobrança (R3.3). */
  usaGerador: boolean
  vista: Vista
}

const GERAL: ReadonlyArray<Omit<MissaoDisponivel, 'vista'>> = [
  { missao: 1, nome: 'Capa', comTexto: false, usaGerador: true },
  { missao: 2, nome: 'Contexto de uso', comTexto: true, usaGerador: true },
  { missao: 3, nome: 'Quebra de objeção', comTexto: true, usaGerador: true },
  { missao: 4, nome: 'Benefícios', comTexto: true, usaGerador: true },
  { missao: 5, nome: 'Especificações', comTexto: true, usaGerador: true },
  { missao: 6, nome: 'Como usar', comTexto: true, usaGerador: true },
  { missao: 7, nome: 'Detalhes', comTexto: true, usaGerador: false },
]

// R5.5. `vista` = foto de referência exigida; a 5 e a 7 são recortes da frente (R3.3), sem gerador.
const MODA: ReadonlyArray<Omit<MissaoDisponivel, 'comTexto'>> = [
  { missao: 1, nome: 'Capa', usaGerador: true, vista: 'frente' },
  { missao: 2, nome: 'Em uso', usaGerador: true, vista: 'frente' },
  { missao: 3, nome: 'De costas', usaGerador: true, vista: 'costas' },
  { missao: 4, nome: 'Lateral', usaGerador: true, vista: 'lateral' },
  { missao: 5, nome: 'Detalhe do tecido', usaGerador: false, vista: 'frente' },
  { missao: 6, nome: 'Combinação', usaGerador: true, vista: 'frente' },
  { missao: 7, nome: 'Detalhe de alça, gola ou costura', usaGerador: false, vista: 'frente' },
]

/** Missões oferecidas; vistas "De costas"/"Lateral" só com referência cadastrada (R3.2). */
export function missoesDisponiveis(moda: boolean, vistas: Vista[]): MissaoDisponivel[] {
  if (moda) {
    return MODA.filter((m) => vistas.includes(m.vista)).map((m) => ({ ...m, comTexto: false }))
  }
  return GERAL.map((m) => ({ ...m, vista: 'frente' as Vista }))
}

/** ADR-0201: as sete até 3 cores; acima disso, as quatro primeiras. */
export function missoesSugeridas(nCores: number): Missao[] {
  return nCores <= 3 ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4]
}

// Categorias de Moda — GET https://api.mercadolibre.com/categories/{id} (público, sem token),
// consultado em 2026-11-09. Raiz: MLB1430 "Calçados, Roupas e Bolsas" (22 filhas diretas).
// Método: listei as filhas de MLB1430 e, das que tinham subcategorias (Agasalhos, Moda Fitness,
// Indumentária, Moda Íntima, Roupas para Bebês), listei também as filhas (profundidade 2).
// Guardo só as RAÍZES de roupa e `ehModa` testa se algum id do path_from_root pertence ao
// conjunto — assim folhas novas sob essas raízes entram sem manutenção. As exclusões vencem.
export const CATEGORIAS_MODA: ReadonlySet<string> = new Set([
  'MLB455528', // Agasalhos
  'MLB188064', // Bermudas e Shorts
  'MLB3112', //   Blusas
  'MLB188065', // Calças
  'MLB107292', // Camisas
  'MLB31447', //  Camisetas e Regatas
  'MLB271862', // Indumentária Laboral e Escolar
  'MLB455550', // Kimonos
  'MLB271219', // Kits de Conjuntos de Roupa
  'MLB278018', // Leggings
  'MLB27250', //  Macacão
  'MLB270215', // Moda Fitness
  'MLB430391', // Moda Praia
  'MLB108786', // Moda Íntima e Lingerie
  'MLB5366', //   Roupas para Bebês
  'MLB185489', // Saias
  'MLB108831', // Ternos
  'MLB108704', // Vestidos
])

// Fora de Moda: calçados e bolsas, mesmo quando aninhados sob uma raiz de roupa.
// Raízes fora do conjunto por decisão: MLB23262 Calçados, MLB1457 Malas e Bolsas,
// MLB1451 Acessórios de Moda (cinto, óculos, chaveiro… não são roupa) e MLB1911 Outros.
const EXCLUIDAS_MODA: ReadonlySet<string> = new Set([
  'MLB28158', //  Calçados (dentro de Roupas para Bebês)
  'MLB432028', // Bolsas Esportivas (dentro de Moda Fitness)
])

/** Moda pelo `path_from_root` lido ao vivo na categoria — nunca pelo modelo de IA. */
export function ehModa(pathFromRoot: ReadonlyArray<{ id: string }> | undefined | null): boolean {
  const ids = (pathFromRoot ?? []).map((c) => c.id)
  if (ids.some((id) => EXCLUIDAS_MODA.has(id))) return false
  return ids.some((id) => CATEGORIAS_MODA.has(id))
}

/** Palavras separadas por espaço (R6.1). */
export function contarPalavras(texto: string): number {
  const t = texto.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

export type CategoriaProibidos = 'geral' | 'vestuario'

// R4.2/R4.3 (globais). Termos sem acento e minúsculos; casam também no plural (s/es).
// ponytail: lista mínima do que a spec nomeia; as listas por categoria (R4.4: cosméticos,
// vestuário, tecidos, eletrônicos) são fechadas na task do roteiro — termos como "impermeável"
// são citáveis quando confirmados, então não entram aqui.
const PROIBIDOS_GLOBAIS = [
  'preco', 'desconto', 'frete', 'gratis', 'promocao', 'oferta', 'ultima unidade', 'ultimas unidades','estoque',
  'urgente', 'garantia', 'garantido', 'certificado', 'selo', 'qr code', 'melhor do brasil',
  'mais vendido', 'premium',
]
const PROIBIDOS_POR_CATEGORIA: Record<CategoriaProibidos, string[]> = { geral: [], vestuario: [] }

const FORA = '(?<![\\p{L}\\p{N}])'
const FIM = '(?![\\p{L}\\p{N}])'
// "100%" sozinho é composição ("100% poliamida", fato confirmado): só o claim é proibido.
const CLAIM_100 = '100%\\s+(?:natural|naturais|garantid[oa]s?|original|originais|puro|pura|puros|puras|organico|seguro|eficaz|aprovad[oa]s?)'
// Valor monetário: "R$ 19,90", "R$19".
const VALOR = 'r\\$\\s*\\d'

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Termos proibidos presentes no texto (vazio = limpo). */
export function termosProibidos(texto: string, categoria: CategoriaProibidos): string[] {
  const alvo = normalizar(texto)
  const acha = (fonte: string) => new RegExp(`${FORA}${fonte}${FIM}`, 'u').test(alvo)
  const achados = [...PROIBIDOS_GLOBAIS, ...PROIBIDOS_POR_CATEGORIA[categoria]].filter((termo) =>
    acha(`${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?`),
  )
  if (acha(CLAIM_100)) achados.push('100% (claim)')
  if (new RegExp(`${FORA}${VALOR}`, 'u').test(alvo)) achados.push('valor em R$')
  return achados
}
