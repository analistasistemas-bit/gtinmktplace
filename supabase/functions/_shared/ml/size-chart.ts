// ADR-0167: guia de tamanhos (chart) do ML, criado e cacheado via API — o operador nunca entra
// no Seller Central. Contrato de POST /catalog/charts confirmado por chamada real (Spike 051 §3),
// não deduzido de doc/resumo de busca. Chart é imutável (ADR-0167 Decisão 4): nunca dar update,
// só criar um novo quando o conjunto de tamanhos muda.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ehCategoriaMlValida, lerSchemaAtributos } from '../categoria/schema.ts';
import { COMPRIMENTO_PE_CM, tabelaQuadril } from './medidas-valores.ts';
import {
  GENEROS_INFANTIL, generosDaGrade, tamanhosDaGrade, type Genero, type GradeTamanho,
} from '../produto/tipos-produto-valores.ts';

// ADR-0182: fonte única dos gêneros (adulto + infantil) em `tipos-produto-valores.ts`.
export type { Genero };

// Spike 051 §5, confirmado via GET /categories/{id}/attributes — não existe "Unissex" literal no ML.
// ADR-0182 D3 / Spike 056 §2: ids infantis lidos de MLB188064 / MLB271219 (2026-10-16).
export const GENDER_VALUE: Record<Genero, { id: string; nome: string }> = {
  masculino: { id: '339666', nome: 'Masculino' },
  feminino: { id: '339665', nome: 'Feminino' },
  unissex: { id: '110461', nome: 'Sem gênero' },
  meninos: { id: '339667', nome: 'Meninos' },
  meninas: { id: '339668', nome: 'Meninas' },
  sem_genero_infantil: { id: '19159491', nome: 'Sem gênero infantil' },
};

// ADR-0167 Decisão 3: tabela padrão do varejo BR (contorno de peito, piso da faixa), decisão do
// Diego — não é medida do produto real. Cobre P/M/G/GG/GGG: "Tamanho Único" não tem contorno de
// peito aplicável, falha alto em vez de inventar (nunca CLAUDE.md "inventar dado de produto").
// GGG = 120 cm (passo de 8 cm da tabela) — decisão do Diego, emenda ADR-0182 (2026-10-18).
export const CONTORNO_PEITO_CM: Readonly<Record<string, number>> = { P: 88, M: 96, G: 104, GG: 112, GGG: 120 };

// Emenda ADR-0182 (2026-10-18): o ML não tem "GGG" em SIZE nem em FILTRABLE_SIZE. POST
// /catalog/charts real (chart 10367347, SPORT_T_SHIRTS feminino) aceitou SIZE "GGG" sem value_id
// (SIZE é string livre) com a equivalência FILTRABLE_SIZE "XG" — decisão do Diego.
export const FILTRAVEL_EQUIVALENTE: Readonly<Record<string, string>> = { GGG: 'XG' };
const SIZE_SEM_VALUE_ID = new Set(['GGG']);

// Spike 051 §13 (2026-09-19): FOOTWEAR usa BR_SIZE + FOOT_LENGTH, não SIZE/FILTRABLE_SIZE/
// CHEST_CIRCUMFERENCE — confirmado via POST /catalog/charts real contra SANDALS_AND_CLOGS. Os
// valores vêm do chart STANDARD que o PRÓPRIO ML publica (GET via /catalog/charts/search,
// type=STANDARD, domain_id=SNEAKERS): masculino = chart 210058, feminino = chart 210059. Não é
// tabela inventada — é dado publicado pelo Mercado Livre, só copiado literalmente.
//
// Movida para um módulo folha (sem imports) para o frontend também poder lê-la sem redigitar a
// tabela — ver medidas-valores.ts. Reexportada aqui para nenhum consumidor existente mudar.
export { COMPRIMENTO_PE_CM } from './medidas-valores.ts';

/** O ML não publica chart STANDARD "Sem gênero" (testado, `POST /catalog/charts/search` com
 *  `GENDER=Sem gênero` devolve `charts: []` — Spike 051 §13). Unissex reaproveita a tabela
 *  masculino: cobre 33-48 por completo (a faixa inteira de `NUMERACOES_CALCADO`), enquanto a
 *  feminino para em 44. Assunção — sinalizada ao Diego, não decisão silenciosa. */
export function tabelaComprimentoPe(genero: Genero): Readonly<Record<string, number>> {
  return genero === 'feminino' ? COMPRIMENTO_PE_CM.feminino : COMPRIMENTO_PE_CM.masculino;
}

// Spike 051 §3/§7: domínios de vestuário com a coluna de medida confirmada
// (CHEST_CIRCUMFERENCE_FROM) via POST /catalog/charts real.
export const DOMINIOS_VESTUARIO = new Set(['JACKETS_AND_COATS', 'SPORT_T_SHIRTS']);

// Spike 051 §13: SNEAKERS tem chart STANDARD oficial do ML (não criamos, só buscamos e
// referenciamos — sem risco de inventar medida). SANDALS_AND_CLOGS não tem STANDARD (testado,
// `/catalog/charts/domains/search` não lista) — cria SPECIFIC com COMPRIMENTO_PE_CM.
export const DOMINIOS_CALCADO_STANDARD = new Set(['SNEAKERS']);
export const DOMINIOS_CALCADO_SPECIFIC = new Set(['SANDALS_AND_CLOGS']);

// Spike 056 §3/§4 (ADR-0182 D4): SHORTS/PANTS não têm STANDARD; chart SPECIFIC exige
// SIZE + FILTRABLE_SIZE + HIP_CIRCUMFERENCE_FROM (confirmado via POST /catalog/charts real).
export const DOMINIOS_QUADRIL = new Set(['SHORTS', 'PANTS']);
// Spike 056 §3/§5 (ADR-0182 D7): CLOTHING_LOTS não tem guia ("Domain MLB-CLOTHING_LOTS not
// active"); o item plano valida sem grid, com o tamanho em CLOTHING_LOT_SIZE.
// Emenda ADR-0182 (2026-10-17): SWIMWEAR (Moda Praia, MLB430391) não tem SIZE_GRID_ID no schema;
// /items/validate real passou com SIZE cru ("2"/"4"/"8"), GENDER Meninas e SWIMWEAR_TYPE
// "Conjunto infantil". O mapa diz em qual atributo o tamanho do SKU vai.
export type AtributoTamanhoSemGuia = 'CLOTHING_LOT_SIZE' | 'SIZE';
export const ATRIBUTO_TAMANHO_SEM_GUIA: Readonly<Record<string, AtributoTamanhoSemGuia>> = {
  CLOTHING_LOTS: 'CLOTHING_LOT_SIZE',
  SWIMWEAR: 'SIZE',
};
export const DOMINIOS_SEM_GUIA = new Set(Object.keys(ATRIBUTO_TAMANHO_SEM_GUIA));

// Qualquer outro domínio falha alto — a coluna exigida (ou a disponibilidade de STANDARD) não
// foi confirmada, adivinhar aqui seria inventar payload de marketplace.
export const DOMINIOS_SUPORTADOS = new Set([
  ...DOMINIOS_VESTUARIO, ...DOMINIOS_CALCADO_STANDARD, ...DOMINIOS_CALCADO_SPECIFIC,
  ...DOMINIOS_QUADRIL, ...DOMINIOS_SEM_GUIA,
]);

/** ADR-0182 D8.1: a grade da família tem que caber no domínio da categoria — calça classificada
 *  como tênis (ou calçado em PANTS) recusa antes de qualquer chart/publicação. */
export function dominioAceitaGrade(domainId: string, grade: GradeTamanho): boolean {
  if (grade === 'calcado') return DOMINIOS_CALCADO_STANDARD.has(domainId) || DOMINIOS_CALCADO_SPECIFIC.has(domainId);
  const quadrilOuSemGuia = DOMINIOS_QUADRIL.has(domainId) || DOMINIOS_SEM_GUIA.has(domainId);
  return grade === 'letras' ? quadrilOuSemGuia || DOMINIOS_VESTUARIO.has(domainId) : quadrilOuSemGuia;
}

// Achado real (2026-09-19, sandália): o SIZE do ITEM tem que bater com o rótulo da linha do
// chart ("37 BR"), não com o valor cru da categoria ("37") — /items/validate real devolveu
// `invalid.fashion_grid.size.values` com "37" e passou com "37 BR". Em vestuário o rótulo da
// linha é igual ao tamanho cru (P=P), por isso passou despercebido nos testes de jaqueta — mas o
// contrato correto sempre foi "usa o rótulo da linha", não "usa o tamanho cru".
export interface LinhaChartResolvida {
  rowId: string;
  /** Valor exato a mandar em `item.attributes[SIZE].value_name` — vem da própria linha do
   *  chart, nunca de `variacoes.tamanho` direto. */
  sizeLabel: string;
}

export interface ChartResolvido {
  chartId: string;
  linhaPorTamanho: ReadonlyMap<string, LinhaChartResolvida>;
}

/** Domínio sem guia de tamanhos (`DOMINIOS_SEM_GUIA`): o tamanho do SKU vai cru em `semGuia`. */
export interface ChartSemGuia {
  semGuia: AtributoTamanhoSemGuia;
}

/** `settings.catalog_domain` de `GET /categories/{id}` vem com o prefixo `MLB-` (ex.:
 *  "MLB-JACKETS_AND_COATS"); o corpo de `POST /catalog/charts` exige o `domain_id` SEM o
 *  prefixo — com ele, o ML concatena de novo e devolve `chart_not_available_for_invalid_domain`
 *  (achado real, Spike 051 §3). */
export function domainIdSemPrefixo(catalogDomain: string | null | undefined): string | null {
  if (!catalogDomain) return null;
  return catalogDomain.startsWith('MLB-') ? catalogDomain.slice(4) : catalogDomain;
}

/** Achado real de produção (2026-09-19): `POST /catalog/charts` recusa `_` no nome do chart com
 *  `invalid_chart_name` — a mensagem do ML fala em "máximo 60 caracteres", mas reproduzido
 *  isolado contra a API real, o `_` de `domain_id` (ex. "JACKETS_AND_COATS") é que invalida, não
 *  o tamanho (confirmado: mesmo nome mais longo sem `_` passou). Nunca usar `domainId` cru aqui. */
export function nomeChart(domainId: string, genero: Genero, tamanhos: readonly string[]): string {
  const dominioLegivel = domainId.replace(/_/g, ' ')
    .toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `PubliAI Guia ${dominioLegivel} ${genero.replace(/_/g, ' ')} ${tamanhos.join('-')}`.slice(0, 60);
}

// Achado real (2026-09-19, Spike 051 §12): "Tamanho Único" foi testado a fundo (3 chamadas reais)
// e é impossível no guia de tamanhos destes domínios — FILTRABLE_SIZE não tem essa opção no
// catálogo do ML (confirmado em JACKETS_AND_COATS e SPORT_T_SHIRTS), e o item exige SIZE_GRID_ID
// incondicionalmente, sem isenção para "Único". Mensagem específica para não parecer bug nosso.
const MOTIVO_UNICO = (
  'Mercado Livre não tem "Único" na lista de FILTRABLE_SIZE para este domínio — limite do '
  + 'catálogo do ML, confirmado via API (Spike 051 §12), não é possível publicar com guia de tamanhos.'
);

/** Mensagem de erro quando um ou mais tamanhos pedidos não têm medida confirmada (fora do
 *  superset de `CONTORNO_PEITO_CM`). "Único" ganha uma explicação específica (achado real, não
 *  lacuna de mapeamento) — os demais mantêm a mensagem genérica de "publicação bloqueada em vez
 *  de inventar payload". */
export function mensagemForaDoSuperset(foraDoSuperset: readonly string[]): string {
  const semUnico = foraDoSuperset.filter((t) => t !== 'Único');
  const partes: string[] = [];
  if (semUnico.length > 0) {
    partes.push(
      `tamanho(s) ${semUnico.join(', ')} sem medida confirmada para esta categoria — `
      + 'publicação bloqueada em vez de inventar payload',
    );
  }
  if (foraDoSuperset.includes('Único')) {
    partes.push(`tamanho "Único": ${MOTIVO_UNICO}`);
  }
  return `Guia de tamanhos: ${partes.join('; ')}.`;
}

/** Numeração fora de `COMPRIMENTO_PE_CM` (ex.: pares como "33/34", de `NUMERACOES_CALCADO`) não
 *  tem correspondência de comprimento de pé — nem o ML nem nós sabemos que medida usar pra um par
 *  de numerações num único SKU. Mensagem específica, mesmo padrão de "Tamanho Único" (§12): deixa
 *  claro que é limite real, não lacuna de mapeamento a corrigir. */
export function mensagemNumeracaoNaoSuportada(foraDaTabela: readonly string[]): string {
  return (
    `Guia de tamanhos: numeração(ões) ${foraDaTabela.join(', ')} sem comprimento de pé confirmado `
    + '— o Mercado Livre exige uma medida por numeração e não há uma referência real para pares '
    + '(ex.: "33/34") ou fora da faixa 33-48; publicação bloqueada em vez de inventar payload.'
  );
}

interface LinhaAtributo { id: string; values: Array<{ id?: string; name: string }>; }
interface LinhaChart { attributes: LinhaAtributo[]; }

/** Monta as linhas do corpo de `POST /catalog/charts` a partir dos tamanhos + do schema de
 *  atributos da categoria (SIZE e FILTRABLE_SIZE têm `value_id` em NAMESPACES DIFERENTES para o
 *  mesmo tamanho — achado real, Spike 051 §3 — por isso os dois vêm do schema, nunca de uma
 *  tabela hardcoded). Falha alto se faltar valor/medida — nunca inventa. */
export function montarLinhasChart(
  tamanhos: readonly string[],
  sizeValores: readonly { id: string; nome: string }[],
  filtravelValores: readonly { id: string; nome: string }[],
  medidasCm: Readonly<Record<string, number>> = CONTORNO_PEITO_CM,
  // ADR-0182 D6: quadril usa HIP_CIRCUMFERENCE_FROM; infantil tem FILTRABLE_SIZE "<n> anos".
  coluna: 'CHEST_CIRCUMFERENCE_FROM' | 'HIP_CIRCUMFERENCE_FROM' = 'CHEST_CIRCUMFERENCE_FROM',
  nomeFiltravel: (t: string) => string = (t) => FILTRAVEL_EQUIVALENTE[t] ?? t,
): LinhaChart[] {
  return tamanhos.map((t) => {
    const sizeVal: { id?: string; nome: string } | undefined = sizeValores.find((v) => v.nome === t)
      ?? (SIZE_SEM_VALUE_ID.has(t) ? { nome: t } : undefined);
    const filtVal = filtravelValores.find((v) => v.nome === nomeFiltravel(t));
    const cm = medidasCm[t];
    if (!sizeVal || !filtVal || cm == null) {
      throw new Error(`Guia de tamanhos: tamanho "${t}" sem valor/medida confirmado para esta categoria.`);
    }
    return {
      attributes: [
        { id: 'SIZE', values: [sizeVal.id ? { id: sizeVal.id, name: sizeVal.nome } : { name: sizeVal.nome }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: filtVal.id, name: filtVal.nome }] },
        { id: coluna, values: [{ name: `${cm} cm` }] },
      ],
    };
  });
}

/** Extrai tamanho→{rowId, sizeLabel} da resposta real de `POST`/`GET /catalog/charts/{id}`
 *  (Spike 051 §3). Em vestuário `sizeLabel` sempre é igual ao tamanho cru (P=P), mas o contrato
 *  correto é sempre "usa o rótulo da linha" — nunca `variacoes.tamanho` direto no payload do item
 *  (achado real de produção, Spike 051 §13, ver `LinhaChartResolvida`). */
export function parseLinhasResposta(
  rows: readonly { id: string; attributes: readonly { id: string; values?: readonly { name?: string }[] }[] }[],
): Map<string, LinhaChartResolvida> {
  const mapa = new Map<string, LinhaChartResolvida>();
  for (const row of rows) {
    const nomeTamanho = row.attributes.find((a) => a.id === 'SIZE')?.values?.[0]?.name;
    if (nomeTamanho) mapa.set(nomeTamanho, { rowId: row.id, sizeLabel: nomeTamanho });
  }
  return mapa;
}

/** Monta as linhas de um chart de calçado (BR_SIZE + FOOT_LENGTH, achado real Spike 051 §13 —
 *  diferente do formato de vestuário). `comprimentoPeCm` vem de `COMPRIMENTO_PE_CM` (dado real do
 *  ML, nunca inventado). Falha alto se a numeração não tiver comprimento confirmado. */
export function montarLinhasChartCalcado(
  numeracoes: readonly string[],
  comprimentoPeCm: Readonly<Record<string, number>>,
): LinhaChart[] {
  return numeracoes.map((n) => {
    const cm = comprimentoPeCm[n];
    if (cm == null) throw new Error(mensagemNumeracaoNaoSuportada([n]));
    return {
      attributes: [
        { id: 'BR_SIZE', values: [{ name: `${n} BR`, struct: { number: Number(n), unit: 'BR' } }] },
        { id: 'FOOT_LENGTH', values: [{ name: `${cm} cm`, struct: { number: cm, unit: 'cm' } }] },
      ],
    };
  });
}

/** Extrai numeração→{rowId, sizeLabel} de um chart de calçado — funciona tanto pra chart STANDARD
 *  do ML (atributo `SIZE`, nome "40 BR") quanto pra chart SPECIFIC nosso (atributo `BR_SIZE`) —
 *  os dois têm `struct.number` real (Spike 051 §13), então a CHAVE normalizada é o número puro
 *  ("40", igual a `variacoes.tamanho`), mas `sizeLabel` guarda o rótulo completo ("40 BR") —
 *  achado real de produção: `item.attributes[SIZE]` recusa o número puro, só aceita esse rótulo. */
export function parseLinhasCalcado(
  rows: readonly { id: string; attributes: readonly { id: string; values?: readonly { name?: string; struct?: { number?: number } }[] }[] }[],
): Map<string, LinhaChartResolvida> {
  const mapa = new Map<string, LinhaChartResolvida>();
  for (const row of rows) {
    const attr = row.attributes.find((a) => a.id === 'SIZE' || a.id === 'BR_SIZE');
    const valor = attr?.values?.[0];
    const numero = valor?.struct?.number;
    if (numero != null && valor?.name) mapa.set(String(numero), { rowId: row.id, sizeLabel: valor.name });
  }
  return mapa;
}

/** `GET /categories/{id}` (público, sem token) → domínio real da categoria, sem prefixo. */
export async function lerDominioCategoria(categoriaId: string): Promise<string | null> {
  if (!ehCategoriaMlValida(categoriaId)) return null;
  const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}`);
  if (!r.ok) return null;
  const json = await r.json().catch(() => null) as { settings?: { catalog_domain?: string } } | null;
  return domainIdSemPrefixo(json?.settings?.catalog_domain);
}

/** Resolve o chart de (conexão, domínio, gênero, grade) — lê do cache (`ml_size_charts`) ou cria via
 *  `POST /catalog/charts` e persiste. Nunca dá update num chart existente (ADR-0167 Decisão 4).
 *  Domínio sem guia (`DOMINIOS_SEM_GUIA`, ADR-0182 D7) → `{ semGuia }`: nem cache nem ML. */
export async function garantirChart(
  admin: SupabaseClient,
  token: string,
  connectionId: string,
  categoriaId: string,
  genero: Genero,
  tamanhos: readonly string[],
  grade: GradeTamanho,
): Promise<ChartResolvido | ChartSemGuia> {
  const domainId = await lerDominioCategoria(categoriaId);
  if (!domainId) {
    throw new Error(`Guia de tamanhos: não foi possível ler o domínio da categoria ${categoriaId}.`);
  }
  if (!DOMINIOS_SUPORTADOS.has(domainId)) {
    throw new Error(
      `Guia de tamanhos: domínio ${domainId} não confirmado (Spike 051) — coluna de medida `
      + 'desconhecida, publicação bloqueada em vez de inventar payload.',
    );
  }
  // `genero` vem do banco com cast nos chamadores: valor fora de GENDER_VALUE cairia na tabela
  // masculina de `tabelaQuadril` em silêncio. Gênero incoerente com a grade também nunca publica.
  if (!Object.hasOwn(GENDER_VALUE, genero) || !generosDaGrade(grade).includes(genero)) {
    throw new Error(`Guia de tamanhos: gênero "${genero}" inválido para a grade ${grade}.`);
  }
  if (!dominioAceitaGrade(domainId, grade)) {
    throw new Error(`Guia de tamanhos: grade ${grade} incompatível com o domínio ${domainId} — confira a categoria do produto.`);
  }
  if (DOMINIOS_SEM_GUIA.has(domainId)) return { semGuia: ATRIBUTO_TAMANHO_SEM_GUIA[domainId] };

  const { data: cached } = await admin.from('ml_size_charts')
    .select('chart_id, linhas')
    .eq('connection_id', connectionId).eq('domain_id', domainId).eq('genero', genero)
    .eq('grade_tamanho', grade)
    .maybeSingle();
  if (cached) {
    // Cache pré-existente (charts criados antes de 0cec85cb) grava `linhas` como
    // `{tamanho: "rowId:versao"}` (string). Formato novo é `{tamanho: {rowId, sizeLabel}}`. Sem
    // esta normalização, uma linha antiga vira a própria string em `linha?.rowId` (undefined) e
    // `montarPayloadItem` rejeita a publicação por sizeGridRowId ausente — quebra republicação de
    // toda roupa já cacheada. Para vestuário, rótulo == tamanho cru, então a conversão é exata.
    const linhaPorTamanho = new Map(
      Object.entries(cached.linhas as Record<string, LinhaChartResolvida | string>)
        .map(([t, l]) => [t, typeof l === 'string' ? { rowId: l, sizeLabel: t } : l] as const),
    );
    // ADR-0167 Decisão 4 (chart imutável): cache que não cobre um tamanho pedido (superset
    // ampliado, ex.: GGG em 2026-10-18) NUNCA edita o chart existente — cai na criação de um chart
    // novo com o superset atual, que substitui o cache; o antigo segue válido nos itens publicados.
    // Tamanho fora do superset atual falha alto na criação (mensagemForaDoSuperset).
    const faltando = tamanhos.filter((t) => !linhaPorTamanho.has(t));
    if (faltando.length === 0) return { chartId: cached.chart_id as string, linhaPorTamanho };
    console.warn(`Guia de tamanhos: chart ${cached.chart_id} não cobre ${faltando.join(', ')} — criando chart novo.`);
  }

  const resolvido = DOMINIOS_CALCADO_STANDARD.has(domainId)
    ? await buscarChartStandardCalcado(token, domainId, genero, tamanhos)
    : DOMINIOS_CALCADO_SPECIFIC.has(domainId)
      ? await criarChartCalcadoEspecifico(token, domainId, genero, tamanhos)
      : await criarChartVestuario(token, categoriaId, domainId, genero, tamanhos, grade);

  // Upsert: substitui o cache quando o superset cresceu (chart novo acima). Duas publicações
  // concorrentes (mesma chave, 1ª vez) podem criar 2 charts em paralelo — inofensivo (o ML aceita,
  // cada uma referencia o seu); vence a última gravação. Falha aqui não é fatal: logar e seguir com
  // o chart que ESTA chamada resolveu (é o que o payload desta publicação já referencia).
  const { error: insertErr } = await admin.from('ml_size_charts').upsert({
    connection_id: connectionId, domain_id: domainId, genero, grade_tamanho: grade,
    chart_id: resolvido.chartId, linhas: Object.fromEntries(resolvido.linhaPorTamanho),
  }, { onConflict: 'connection_id,domain_id,genero,grade_tamanho' });
  if (insertErr) console.error('ml_size_charts upsert falhou (chart resolvido, cache não salvo):', insertErr.message);

  return resolvido;
}

/** Vestuário: cria um chart SPECIFIC com o superset da tabela do domínio (ADR-0167 Decisão 2 —
 *  nunca só os tamanhos desta família). JACKETS_AND_COATS/SPORT_T_SHIRTS → peito
 *  (CONTORNO_PEITO_CM); SHORTS/PANTS → quadril do gênero, superset = a lista da PRÓPRIA grade
 *  (ADR-0182 D6: Letras = P–GG, Calça = 34–48, Infantil = 2–16 com FILTRABLE_SIZE "<n> anos").
 *  Nunca Letras + Calça no mesmo chart: o ML recusa com `value_is_not_the_same_type` (ensaio
 *  real 2026-10-16, Spike 056 §8). */
async function criarChartVestuario(
  token: string, categoriaId: string, domainId: string, genero: Genero, tamanhos: readonly string[],
  grade: GradeTamanho,
): Promise<ChartResolvido> {
  const schema = await lerSchemaAtributos(token, categoriaId);
  const sizeAttr = schema.find((a) => a.id === 'SIZE');
  const filtravelAttr = schema.find((a) => a.id === 'FILTRABLE_SIZE');
  if (!sizeAttr || !filtravelAttr) {
    throw new Error('Guia de tamanhos: schema da categoria não trouxe SIZE/FILTRABLE_SIZE.');
  }
  const quadril = DOMINIOS_QUADRIL.has(domainId);
  const tabela = quadril ? tabelaQuadril(genero) : CONTORNO_PEITO_CM;
  const infantil = (GENEROS_INFANTIL as readonly string[]).includes(genero);
  const nomeFiltravel = quadril && infantil ? (t: string) => `${t} anos` : (t: string) => t;
  const supersetTamanhos = (quadril ? tamanhosDaGrade(grade) : Object.keys(tabela))
    .filter((t) => t in tabela && (SIZE_SEM_VALUE_ID.has(t) || sizeAttr.valores.some((v) => v.nome === t)));
  const foraDoSuperset = tamanhos.filter((t) => !supersetTamanhos.includes(t));
  if (foraDoSuperset.length > 0) throw new Error(mensagemForaDoSuperset(foraDoSuperset));

  const rows = quadril
    ? montarLinhasChart(supersetTamanhos, sizeAttr.valores, filtravelAttr.valores, tabela, 'HIP_CIRCUMFERENCE_FROM', nomeFiltravel)
    : montarLinhasChart(supersetTamanhos, sizeAttr.valores, filtravelAttr.valores);
  const respJson = await postCatalogChart(token, domainId, genero, supersetTamanhos, 'SIZE', rows);
  return { chartId: String(respJson.id), linhaPorTamanho: parseLinhasResposta(respJson.rows) };
}

/** SANDALS_AND_CLOGS (sem chart STANDARD do ML): cria um SPECIFIC com o superset de
 *  COMPRIMENTO_PE_CM (dado real do ML, ver Spike 051 §13 — nunca inventado). */
async function criarChartCalcadoEspecifico(
  token: string, domainId: string, genero: Genero, tamanhos: readonly string[],
): Promise<ChartResolvido> {
  const tabela = tabelaComprimentoPe(genero);
  const supersetNumeracoes = Object.keys(tabela);
  const foraDaTabela = tamanhos.filter((n) => !supersetNumeracoes.includes(n));
  if (foraDaTabela.length > 0) throw new Error(mensagemNumeracaoNaoSuportada(foraDaTabela));

  const rows = montarLinhasChartCalcado(supersetNumeracoes, tabela);
  const respJson = await postCatalogChart(token, domainId, genero, supersetNumeracoes, 'BR_SIZE', rows);
  return { chartId: String(respJson.id), linhaPorTamanho: parseLinhasCalcado(respJson.rows) };
}

interface RespostaChart { id: number | string; rows: never[]; }

/** `POST /catalog/charts` — contrato comum aos dois SPECIFIC (vestuário e calçado); só o
 *  `main_attribute` e as `rows` mudam entre eles. */
async function postCatalogChart(
  token: string, domainId: string, genero: Genero, tamanhos: readonly string[],
  mainAttributeId: string, rows: LinhaChart[],
): Promise<RespostaChart> {
  const genderValue = GENDER_VALUE[genero];
  const body = {
    names: { MLB: nomeChart(domainId, genero, tamanhos) },
    domain_id: domainId,
    site_id: 'MLB',
    type: 'SPECIFIC',
    attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, name: genderValue.nome }] }],
    main_attribute: { id: mainAttributeId },
    rows,
  };
  const resp = await fetch('https://api.mercadolibre.com/catalog/charts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const respJson = await resp.json().catch(() => null) as RespostaChart | null;
  if (!resp.ok || respJson?.id == null) {
    throw new Error(`Guia de tamanhos: POST /catalog/charts falhou (HTTP ${resp.status}): ${JSON.stringify(respJson)}`);
  }
  return { id: respJson.id, rows: respJson.rows ?? [] };
}

/** SNEAKERS (e domínios equivalentes, Spike 051 §13): busca o chart STANDARD que o PRÓPRIO ML
 *  publica via `POST /catalog/charts/search` — nunca cria nada, só referencia dado real do ML.
 *  Falha alto se o ML não tiver a numeração pedida na tabela (nunca inventa a linha faltante). */
async function buscarChartStandardCalcado(
  token: string, domainId: string, genero: Genero, tamanhos: readonly string[],
): Promise<ChartResolvido> {
  const genderValue = GENDER_VALUE[genero];
  const resp = await fetch('https://api.mercadolibre.com/catalog/charts/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'STANDARD', domain_id: domainId, site_id: 'MLB',
      attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, name: genderValue.nome }] }],
    }),
  });
  const respJson = await resp.json().catch(() => null) as { charts?: RespostaChart[] } | null;
  const chart = respJson?.charts?.[0];
  if (!resp.ok || !chart) {
    throw new Error(
      `Guia de tamanhos: nenhum chart STANDARD encontrado no ML para domínio=${domainId}, `
      + `gênero=${genero} (HTTP ${resp.status}).`,
    );
  }
  const linhaPorTamanho = parseLinhasCalcado(chart.rows);
  const faltando = tamanhos.filter((n) => !linhaPorTamanho.has(n));
  if (faltando.length > 0) {
    throw new Error(
      `Guia de tamanhos: numeração(ões) ${faltando.join(', ')} fora do chart STANDARD do ML `
      + `(id ${chart.id}) para domínio=${domainId}, gênero=${genero}.`,
    );
  }
  return { chartId: String(chart.id), linhaPorTamanho };
}
