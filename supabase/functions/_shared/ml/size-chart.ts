// ADR-0167: guia de tamanhos (chart) do ML, criado e cacheado via API — o operador nunca entra
// no Seller Central. Contrato de POST /catalog/charts confirmado por chamada real (Spike 051 §3),
// não deduzido de doc/resumo de busca. Chart é imutável (ADR-0167 Decisão 4): nunca dar update,
// só criar um novo quando o conjunto de tamanhos muda.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ehCategoriaMlValida, lerSchemaAtributos } from '../categoria/schema.ts';

export type Genero = 'masculino' | 'feminino' | 'unissex';

// Spike 051 §5, confirmado via GET /categories/{id}/attributes — não existe "Unissex" literal no ML.
export const GENDER_VALUE: Record<Genero, { id: string; nome: string }> = {
  masculino: { id: '339666', nome: 'Masculino' },
  feminino: { id: '339665', nome: 'Feminino' },
  unissex: { id: '110461', nome: 'Sem gênero' },
};

// ADR-0167 Decisão 3: tabela padrão do varejo BR (contorno de peito, piso da faixa), decisão do
// Diego — não é medida do produto real. Só cobre P/M/G/GG: "Tamanho Único" não tem contorno de
// peito aplicável, falha alto em vez de inventar (nunca CLAUDE.md "inventar dado de produto").
export const CONTORNO_PEITO_CM: Readonly<Record<string, number>> = { P: 88, M: 96, G: 104, GG: 112 };

// Spike 051 §3/§7: domínios com a coluna de medida confirmada (CHEST_CIRCUMFERENCE_FROM) via
// POST /catalog/charts real. Qualquer outro domínio falha alto — a coluna exigida não foi
// confirmada, adivinhar aqui seria inventar payload de marketplace.
export const DOMINIOS_SUPORTADOS = new Set(['JACKETS_AND_COATS', 'SPORT_T_SHIRTS']);

export interface ChartResolvido {
  chartId: string;
  linhaPorTamanho: ReadonlyMap<string, string>;
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
  return `PubliAI Guia ${dominioLegivel} ${genero} ${tamanhos.join('-')}`.slice(0, 60);
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
  contornoPeitoCm: Readonly<Record<string, number>> = CONTORNO_PEITO_CM,
): LinhaChart[] {
  return tamanhos.map((t) => {
    const sizeVal = sizeValores.find((v) => v.nome === t);
    const filtVal = filtravelValores.find((v) => v.nome === t);
    const cm = contornoPeitoCm[t];
    if (!sizeVal || !filtVal || cm == null) {
      throw new Error(`Guia de tamanhos: tamanho "${t}" sem valor/medida confirmado para esta categoria.`);
    }
    return {
      attributes: [
        { id: 'SIZE', values: [{ id: sizeVal.id, name: sizeVal.nome }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: filtVal.id, name: filtVal.nome }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: `${cm} cm` }] },
      ],
    };
  });
}

/** Extrai tamanho→row_id da resposta real de `POST`/`GET /catalog/charts/{id}` (Spike 051 §3). */
export function parseLinhasResposta(
  rows: readonly { id: string; attributes: readonly { id: string; values?: readonly { name?: string }[] }[] }[],
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const row of rows) {
    const nomeTamanho = row.attributes.find((a) => a.id === 'SIZE')?.values?.[0]?.name;
    if (nomeTamanho) mapa.set(nomeTamanho, row.id);
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

/** Resolve o chart de (conexão, domínio, gênero) — lê do cache (`ml_size_charts`) ou cria via
 *  `POST /catalog/charts` e persiste. Nunca dá update num chart existente (ADR-0167 Decisão 4). */
export async function garantirChart(
  admin: SupabaseClient,
  token: string,
  connectionId: string,
  categoriaId: string,
  genero: Genero,
  tamanhos: readonly string[],
): Promise<ChartResolvido> {
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

  const { data: cached } = await admin.from('ml_size_charts')
    .select('chart_id, linhas')
    .eq('connection_id', connectionId).eq('domain_id', domainId).eq('genero', genero)
    .maybeSingle();
  if (cached) {
    const linhaPorTamanho = new Map(Object.entries(cached.linhas as Record<string, string>));
    // ADR-0167 Decisão 4 (chart imutável): se o cache não cobre um tamanho pedido, NUNCA editar o
    // chart existente — falha alto com mensagem clara em vez da mensagem enganosa que vinha de
    // publicar.ts ("garantirChart precisa rodar antes"). Não deveria acontecer se a criação sempre
    // usa o superset (abaixo); mensagem serve de rede de segurança se o superset mudar no futuro.
    const faltando = tamanhos.filter((t) => !linhaPorTamanho.has(t));
    if (faltando.length > 0) {
      throw new Error(
        `Guia de tamanhos: chart existente (conexão=${connectionId}, domínio=${domainId}, `
        + `gênero=${genero}) não cobre ${faltando.join(', ')} — chart é imutável (ADR-0167 `
        + 'Decisão 4), amplie o superset em size-chart.ts e crie um chart novo.',
      );
    }
    return { chartId: cached.chart_id as string, linhaPorTamanho };
  }

  const schema = await lerSchemaAtributos(token, categoriaId);
  const sizeAttr = schema.find((a) => a.id === 'SIZE');
  const filtravelAttr = schema.find((a) => a.id === 'FILTRABLE_SIZE');
  if (!sizeAttr || !filtravelAttr) {
    throw new Error('Guia de tamanhos: schema da categoria não trouxe SIZE/FILTRABLE_SIZE.');
  }

  // ADR-0167 Decisão 2: o chart nasce com o SUPERSET de tamanhos com medida confirmada (nunca só
  // os desta família) — senão a 1ª família (ex.: P/M/G) cacheia um chart que a 2ª família (ex.:
  // com GG) não cobre, virando uma armadilha one-shot. Superset = interseção entre
  // CONTORNO_PEITO_CM (medidas confirmadas) e a lista real de SIZE da categoria.
  const supersetTamanhos = Object.keys(CONTORNO_PEITO_CM)
    .filter((t) => sizeAttr.valores.some((v) => v.nome === t));
  const foraDoSuperset = tamanhos.filter((t) => !supersetTamanhos.includes(t));
  if (foraDoSuperset.length > 0) {
    throw new Error(
      `Guia de tamanhos: tamanho(s) ${foraDoSuperset.join(', ')} sem medida confirmada para esta `
      + 'categoria — publicação bloqueada em vez de inventar payload.',
    );
  }

  const rows = montarLinhasChart(supersetTamanhos, sizeAttr.valores, filtravelAttr.valores);
  const genderValue = GENDER_VALUE[genero];

  const body = {
    names: { MLB: nomeChart(domainId, genero, supersetTamanhos) },
    domain_id: domainId,
    site_id: 'MLB',
    type: 'SPECIFIC',
    attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, name: genderValue.nome }] }],
    main_attribute: { id: 'SIZE' },
    rows,
  };

  const resp = await fetch('https://api.mercadolibre.com/catalog/charts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const respJson = await resp.json().catch(() => null) as { id?: number | string; rows?: unknown } | null;
  if (!resp.ok || respJson?.id == null) {
    throw new Error(`Guia de tamanhos: POST /catalog/charts falhou (HTTP ${resp.status}): ${JSON.stringify(respJson)}`);
  }
  const chartId = String(respJson.id);
  const linhaPorTamanho = parseLinhasResposta(
    (respJson.rows ?? []) as { id: string; attributes: { id: string; values?: { name?: string }[] }[] }[],
  );

  // Duas publicações concorrentes (mesma conexão+domínio+gênero, 1ª vez) podem criar 2 charts em
  // paralelo — inofensivo (o ML aceita, cada uma referencia o seu), mas o insert aqui pode colidir
  // se a PK já tiver a linha da outra corrida. Não é erro fatal: logar e seguir com o chart que
  // ESTA chamada acabou de criar (é o que o payload desta publicação já referencia).
  const { error: insertErr } = await admin.from('ml_size_charts').insert({
    connection_id: connectionId, domain_id: domainId, genero,
    chart_id: chartId, linhas: Object.fromEntries(linhaPorTamanho),
  });
  if (insertErr) console.error('ml_size_charts insert falhou (chart criado no ML, cache não salvo):', insertErr.message);

  return { chartId, linhaPorTamanho };
}
