/**
 * Experimento A/B do título (ADR-0099).
 *
 *   A = baseline de produção  → familias.titulo_ml já gravado, NÃO re-executa
 *   B = prompt novo           → gerarCopy (SYSTEM/montarUserPrompt) + posProcessarTitulo
 *
 * B−A mede o ganho do padrão de slots sobre o título livre antigo.
 *
 * O cenário A não é re-executado: filtramos `not titulo_editado_pelo_operador` (24 dos 167
 * títulos gravados foram editados à mão e contaminariam a medida), e o prompt antigo que gerou
 * os demais não existe mais na árvore — reexecutá-lo é impossível, e o título gravado É a saída
 * real de produção.
 *
 * NÃO importa ../_shared/ai/client.ts, ../_shared/ai/copywriter.ts nem modelos.ts: esses módulos
 * usam `npm:openai@^4` e `Deno.env`, que não resolvem em Node. Fala com o OpenRouter por fetch
 * direto, igual scripts/experimento-copy/index.ts. Por isso o schema do cenário B é remontado
 * aqui a partir de ORDEM_LEITURA em vez de importar SCHEMA_COPY de copywriter.ts — o próprio
 * copywriter.ts arrasta openrouterClient (Deno-only) no import.
 *
 * Lê a amostra pela management API do Supabase (SUPABASE_ACCESS_TOKEN), mesma credencial já
 * presente no .env.local do projeto. Leitura é um SELECT único, sem escrita.
 *
 * Uso:
 *   SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... OPENROUTER_API_KEY=... \
 *     pnpm tsx scripts/experimento-titulo/index.ts
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM, montarUserPrompt, validarTipoProdutoBusca, type InputCopy } from '../../supabase/functions/_shared/ai/copywriter-prompt.ts';
import { posProcessarTitulo, type DadosFonteTitulo } from '../../supabase/functions/_shared/ai/titulo-pos.ts';
import { TituloInviavelError, mensagemTituloInviavel } from '../../supabase/functions/_shared/ai/titulo-montar.ts';
import { ORDEM_LEITURA, SLOTS_VAZIOS, type TituloSlots } from '../../supabase/functions/_shared/ai/titulo-slots.ts';
import { ehCorIndefinida } from '../../supabase/functions/_shared/cor/indefinida.ts';
import { colisoes, marcaAncorada, terminaEmAdjetivoVazio, unidadeCanonica } from './metricas.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** Cap para smoke test barato (ex.: AMOSTRA=5) antes de rodar a amostra inteira. */
const TAMANHO_AMOSTRA = Number(process.env.AMOSTRA ?? 150);
/** Produtos processados ao mesmo tempo no cenário B (única etapa com rede). */
const CONCORRENCIA = Number(process.env.CONCORRENCIA ?? 5);
/** Mesmo default de produção (modelos.ts MODELO_COPY) — não importável aqui (Deno.env). */
const MODELO = process.env.MODELO ?? 'openai/gpt-4.1-mini';

for (const v of ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'OPENROUTER_API_KEY']) {
  if (!process.env[v]) throw new Error(`falta a variável de ambiente ${v} — veja o cabeçalho deste arquivo`);
}

async function consultar<T>(sql: string): Promise<T[]> {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!r.ok) throw new Error(`management API ${r.status}: ${await r.text()}`);
  return (await r.json()) as T[];
}

type Familia = {
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string | null;
  fornecedor: string | null;
  titulo_ml: string;
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
};

async function amostra(): Promise<Familia[]> {
  const candidatas = await consultar<Familia>(`
    select f.codigo_pai, f.nome_pai, f.descricao_pai, f.unidade, f.fornecedor, f.titulo_ml,
           coalesce(
             (select json_agg(json_build_object('codigo', v.codigo, 'cor', v.cor, 'preco', v.preco))
              from variacoes v where v.familia_id = f.id),
             '[]'::json
           ) as variacoes
    from familias f
    where f.titulo_ml is not null
      and not f.titulo_editado_pelo_operador
    order by f.criado_em desc
    limit 150
  `);
  return candidatas.slice(0, TAMANHO_AMOSTRA);
}

/** Schema do cenário B, remontado localmente — ver nota do cabeçalho sobre por que não importar SCHEMA_COPY. */
const PROPRIEDADES_SLOTS = Object.fromEntries(ORDEM_LEITURA.map((slot) => [slot, { type: 'string' }]));
const SCHEMA_COPY = {
  name: 'copy_anuncio',
  schema: {
    type: 'object',
    properties: {
      titulo_slots: {
        type: 'object',
        properties: PROPRIEDADES_SLOTS,
        required: [...ORDEM_LEITURA],
        additionalProperties: false,
      },
      descricao: { type: 'string' },
      tipo_produto_busca: { type: 'string' },
    },
    required: ['titulo_slots', 'descricao', 'tipo_produto_busca'],
    additionalProperties: false,
  },
  strict: true,
} as const;

type Geracao = { tituloSlots: TituloSlots; tipoProdutoBusca: string };

async function gerar(input: InputCopy): Promise<Geracao> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA_COPY },
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  const conteudo = json.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('resposta vazia');
  const parsed = JSON.parse(conteudo) as { titulo_slots: Partial<TituloSlots>; tipo_produto_busca: string };
  return {
    // Merge com SLOTS_VAZIOS: mesma defesa de copywriter.ts contra chave ausente apesar do
    // `required` no schema strict.
    tituloSlots: { ...SLOTS_VAZIOS, ...parsed.titulo_slots },
    tipoProdutoBusca: validarTipoProdutoBusca(parsed.tipo_produto_busca, input.nome, input.descricao_detalhado),
  };
}

type Item = { codigoPai: string; titulo: string; fonte: string; fornecedor: string | null };

/** Métricas de um cenário. `n` é sobre títulos não-vazios; marca é sobre o subconjunto com fornecedor mapeado. */
function metricasDoCenario(itens: Item[], falhas: number) {
  const validos = itens.filter((i) => i.titulo);
  const n = validos.length;
  const pct = (achados: number, total: number) => (total ? Number(((achados / total) * 100).toFixed(1)) : 0);

  const nAdjVazio = validos.filter((i) => terminaEmAdjetivoVazio(i.titulo)).length;
  const nUnidadeCanonica = validos.filter((i) => unidadeCanonica(i.titulo)).length;
  const nComPipe = validos.filter((i) => i.titulo.includes('|')).length;
  const marcas = validos
    .map((i) => marcaAncorada(i.titulo, i.fonte, i.fornecedor))
    .filter((r): r is boolean => r !== null);
  const nMarcaOk = marcas.filter(Boolean).length;
  const charsMedia = n ? Number((validos.reduce((s, i) => s + i.titulo.length, 0) / n).toFixed(1)) : 0;
  const nColisoes = colisoes(validos.map((i) => ({ codigoPai: i.codigoPai, titulo: i.titulo })));

  return {
    n,
    falhas,
    termina_adjetivo_vazio: `${nAdjVazio}/${n} (${pct(nAdjVazio, n)}%)`,
    unidade_canonica: `${nUnidadeCanonica}/${n} (${pct(nUnidadeCanonica, n)}%)`,
    com_pipe: `${nComPipe}/${n} (${pct(nComPipe, n)}%)`,
    marca_ancorada: `${nMarcaOk}/${marcas.length} (${pct(nMarcaOk, marcas.length)}%)`,
    chars_media: charsMedia,
    colisoes: nColisoes,
  };
}

async function main() {
  const familias = await amostra();
  console.log(`Amostra: ${familias.length} famílias · A (baseline) + B (padrão de slots)\n`);

  const itensA: Item[] = [];
  const itensB: Item[] = [];
  let falhasB = 0;
  const linhas: string[] = ['# Experimento de título (ADR-0099)\n'];

  async function processar(f: Familia, i: number) {
    const fonte = `${f.nome_pai} ${f.descricao_pai}`;
    const cores = [...new Set(f.variacoes.map((v) => v.cor).filter((c): c is string => !!c && !ehCorIndefinida(c)))];
    const dadosFonte: DadosFonteTitulo = {
      nomePai: f.nome_pai,
      descricaoPai: f.descricao_pai ?? '',
      tipoProdutoBusca: '',
      cores,
      fornecedor: f.fornecedor,
    };

    const bloco: string[] = [
      `\n---\n\n## ${i + 1}. ${f.codigo_pai} — ${f.nome_pai}\n`,
      `### A — baseline de produção\n\n\`\`\`\n${f.titulo_ml}\n\`\`\`\n`,
    ];

    let tituloB = '';
    let erro: string | null = null;
    try {
      const input: InputCopy = {
        nome: f.nome_pai,
        descricao_detalhado: f.descricao_pai,
        variacoes: f.variacoes,
        unidade: f.unidade,
      };
      const g = await gerar(input);
      tituloB = posProcessarTitulo(g.tituloSlots, { ...dadosFonte, tipoProdutoBusca: g.tipoProdutoBusca });
    } catch (e) {
      erro = e instanceof TituloInviavelError ? mensagemTituloInviavel(e) : (e as Error).message;
    }

    bloco.push(
      erro
        ? `### B — padrão de slots\n\n> FALHOU: ${erro}\n`
        : `### B — padrão de slots\n\n\`\`\`\n${tituloB}\n\`\`\`\n`,
    );

    console.log(`  ${i + 1}/${familias.length} ${f.codigo_pai}${erro ? ` (B falhou: ${erro})` : ''}`);
    return {
      i, bloco,
      itemA: { codigoPai: f.codigo_pai, titulo: f.titulo_ml, fonte, fornecedor: f.fornecedor },
      itemB: { codigoPai: f.codigo_pai, titulo: tituloB, fonte, fornecedor: f.fornecedor },
      falhouB: !!erro,
    };
  }

  const resultados: Awaited<ReturnType<typeof processar>>[] = [];
  for (let i = 0; i < familias.length; i += CONCORRENCIA) {
    const lote = familias.slice(i, i + CONCORRENCIA);
    resultados.push(...await Promise.all(lote.map((f, j) => processar(f, i + j))));
  }
  resultados.sort((a, b) => a.i - b.i);

  for (const r of resultados) {
    itensA.push(r.itemA);
    itensB.push(r.itemB);
    if (r.falhouB) falhasB += 1;
    linhas.push(...r.bloco);
  }

  const resumo = {
    A: metricasDoCenario(itensA, 0),
    B: metricasDoCenario(itensB, falhasB),
  };

  linhas.unshift(`| métrica | A (baseline) | B (padrão de slots) |\n|---|---|---|\n${
    (['n', 'falhas', 'termina_adjetivo_vazio', 'unidade_canonica', 'com_pipe', 'marca_ancorada', 'chars_media', 'colisoes'] as const)
      .map((k) => `| ${k} | ${resumo.A[k]} | ${resumo.B[k]} |`)
      .join('\n')
  }\n`);

  writeFileSync(join(AQUI, 'resultado.md'), linhas.join('\n'), 'utf-8');
  console.table(resumo);
  console.log('\nresultado.md gravado em scripts/experimento-titulo/.');
}

main().catch((e) => { console.error(e); process.exit(1); });
