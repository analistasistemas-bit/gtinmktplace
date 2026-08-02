/**
 * Experimento de copy (ADR-0098).
 *
 *   A = baseline de produção  → familias.descricao_ml já gravada, NÃO re-executa
 *   B = prompt novo           → gpt-4o-mini (modelo atual)
 *   C = prompt novo           → gpt-4o
 *   D = prompt novo           → deepseek-v4-flash-0731 (opção da ADR-0074)
 *
 * B−A mede o ganho do prompt; C−B e D−B medem o ganho (ou perda) do modelo. Rodar prompt e
 * modelo juntos tornaria a causa inatribuível.
 *
 * O cenário A não é re-executado porque, depois da reescrita do SYSTEM, o prompt antigo
 * deixou de existir na árvore. A descricao_ml gravada é a saída real de produção — mais
 * fiel que uma regeração, e custa zero.
 *
 * NÃO importa ../ai/client.ts: aquele módulo usa `npm:openai@^4` e `Deno.env`, que não
 * resolvem em Node. Fala com o OpenRouter por fetch direto.
 *
 * Lê a amostra pela management API do Supabase (SUPABASE_ACCESS_TOKEN), e não com service
 * role: é a credencial que já existe no .env.local do projeto, então o experimento roda sem
 * exigir segredo novo. A leitura é um SELECT único, sem escrita.
 *
 * Uso:
 *   SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... OPENROUTER_API_KEY=... \
 *     pnpm tsx scripts/experimento-copy/index.ts
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SYSTEM,
  montarUserPrompt,
  posProcessarDescricao,
  detectarFormulasProibidas,
  type InputCopy,
} from '../../supabase/functions/_shared/ai/copywriter-prompt.ts';
import {
  medidasNaoAncoradas,
  comparacoesNaoAncoradas,
  taxaBulletsRepetidos,
} from './metricas.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TAMANHO_AMOSTRA = Number(process.env.AMOSTRA ?? 30);
/** Produtos processados ao mesmo tempo. Serial, 30 produtos × 3 modelos levava ~1h45. */
const CONCORRENCIA = Number(process.env.CONCORRENCIA ?? 5);

/**
 * `preco` em $/1k tokens, espelhando a tabela PRECOS de `_shared/ai/tokens.ts`.
 *
 * `deepseek/deepseek-v4-flash-0731` (a opção da ADR-0074, $0,09/$0,18 — output 3,3× mais
 * barato que o gpt-4o-mini) foi testado e REMOVIDO: devolvia JSON truncado sob
 * `json_schema` strict, falhando em 1 dos 3 primeiros produtos. Como `gerarCopy` é a única
 * etapa de IA sem fallback resiliente (ADR-0030), falha ali derruba a família inteira —
 * eliminatório independente do preço.
 */
const CENARIOS = [
  { chave: 'B', rotulo: 'B — prompt novo, gpt-4o-mini', modelo: 'openai/gpt-4o-mini', preco: { in: 0.00015, out: 0.0006 } },
  { chave: 'C', rotulo: 'C — prompt novo, gpt-4o', modelo: 'openai/gpt-4o', preco: { in: 0.0025, out: 0.01 } },
  // gpt-4.1-mini fica entre os dois: 2,7× o custo do gpt-4o-mini, 6,3× mais barato que o
  // gpt-4o. Ainda NÃO está na tabela PRECOS de tokens.ts — adotá-lo exige acrescentá-lo lá,
  // senão custoCentavos loga warning e contabiliza a família como custo zero.
  { chave: 'D', rotulo: 'D — prompt novo, gpt-4.1-mini', modelo: 'openai/gpt-4.1-mini', preco: { in: 0.0004, out: 0.0016 } },
] as const;

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
  descricao_ml: string;
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
};

/**
 * Amostra por diversidade, não aleatória: a métrica de variedade só é informativa se os 30
 * cobrirem casos diferentes. Prioriza famílias recentes porque o cenário A é a descrição
 * histórica de produção, gerada ao longo da evolução do prompt — quanto mais recente,
 * menor a dispersão da linha de base.
 */
async function amostra(): Promise<Familia[]> {
  const candidatas = await consultar<Familia>(`
    select f.codigo_pai, f.nome_pai, f.descricao_pai, f.unidade, f.descricao_ml,
           coalesce(
             (select json_agg(json_build_object('codigo', v.codigo, 'cor', v.cor, 'preco', v.preco))
              from variacoes v where v.familia_id = f.id),
             '[]'::json
           ) as variacoes
    from familias f
    where f.descricao_ml is not null
      and f.descricao_pai is not null
      and f.descricao_editada_pelo_operador = false
    order by f.criado_em desc
    limit 150
  `);
  const vistos = new Set<string>();
  const escolhidas: Familia[] = [];

  // 1ª passada: uma família por combinação (tipo de produto, unidade, tem cor?)
  for (const f of candidatas) {
    const tipo = (f.nome_pai ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    const chave = `${tipo}|${f.unidade ?? ''}|${f.variacoes.some((v) => v.cor) ? 'cor' : 'sem'}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escolhidas.push(f);
    if (escolhidas.length === TAMANHO_AMOSTRA) return escolhidas;
  }
  // 2ª passada: completa com o que sobrou, se a diversidade não rendeu 30
  for (const f of candidatas) {
    if (escolhidas.length === TAMANHO_AMOSTRA) break;
    if (!escolhidas.includes(f)) escolhidas.push(f);
  }
  return escolhidas;
}

type Geracao = { descricao: string; tokensIn: number; tokensOut: number };

async function gerar(input: InputCopy, modelo: string): Promise<Geracao> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'copy_anuncio',
          schema: {
            type: 'object',
            properties: {
              titulo: { type: 'string' },
              descricao: { type: 'string' },
              tipo_produto_busca: { type: 'string' },
            },
            required: ['titulo', 'descricao', 'tipo_produto_busca'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  const conteudo = json.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('resposta vazia');
  return {
    descricao: JSON.parse(conteudo).descricao as string,
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
  };
}

function metricas(descricoes: string[], fontes: string[]) {
  const validas = descricoes.filter(Boolean);
  return {
    n: validas.length,
    formulas_proibidas: descricoes.reduce((n, d) => n + (d ? detectarFormulasProibidas(d).length : 0), 0),
    medidas_nao_ancoradas: descricoes.reduce((n, d, i) => n + (d ? medidasNaoAncoradas(d, fontes[i]).length : 0), 0),
    comparacoes_nao_ancoradas: descricoes.reduce((n, d, i) => n + (d ? comparacoesNaoAncoradas(d, fontes[i]).length : 0), 0),
    taxa_bullets_repetidos: Number(taxaBulletsRepetidos(validas).toFixed(3)),
    chars_media: validas.length ? Math.round(validas.reduce((n, d) => n + d.length, 0) / validas.length) : 0,
    secao_perguntas: validas.filter((d) => d.includes('PERGUNTAS SOBRE ESTE PRODUTO')).length,
  };
}

async function main() {
  const familias = await amostra();
  console.log(`Amostra: ${familias.length} famílias · A (baseline) + ${CENARIOS.map((c) => c.chave).join(', ')}\n`);

  const linhas: string[] = ['# Experimento de copy (ADR-0098)\n'];
  const saidas: Record<string, string[]> = { A: [] };
  const custo: Record<string, number> = {};
  const falhas: Record<string, number> = {};
  for (const c of CENARIOS) { saidas[c.chave] = []; custo[c.chave] = 0; falhas[c.chave] = 0; }
  const fontes: string[] = [];

  // Um produto: gera em todos os cenários e devolve tudo indexado, sem tocar em estado
  // compartilhado — é o que torna a execução em lote segura.
  async function processar(f: Familia, i: number) {
    const input: InputCopy = {
      nome: f.nome_pai,
      descricao_detalhado: f.descricao_pai,
      variacoes: f.variacoes,
      unidade: f.unidade,
    };
    const blocos: string[] = [
      `\n---\n\n## ${i + 1}. ${f.codigo_pai} — ${f.nome_pai}\n`,
      `### Fonte\n\n\`\`\`\n${f.descricao_pai}\n\`\`\`\n`,
      `### A — baseline de produção\n\n\`\`\`\n${f.descricao_ml}\n\`\`\`\n`,
    ];
    const desteProduto: Record<string, string> = {};
    const custoDeste: Record<string, number> = {};
    const falhouEm: string[] = [];

    // Os cenários de um mesmo produto vão juntos — são modelos diferentes, sem ordem entre si.
    const gerados = await Promise.all(CENARIOS.map(async (c) => {
      try {
        const g = await gerar(input, c.modelo);
        return { c, g, erro: null as string | null };
      } catch (e) {
        return { c, g: null, erro: (e as Error).message };
      }
    }));

    for (const { c, g, erro } of gerados) {
      if (!g) {
        // Um modelo que não suporte json_schema strict não pode derrubar o experimento
        // inteiro — registra a falha e segue com os demais.
        falhouEm.push(c.chave);
        desteProduto[c.chave] = '';
        blocos.push(`### ${c.rotulo}\n\n> FALHOU: ${erro}\n`);
        console.warn(`    ! ${c.chave} falhou em ${f.codigo_pai}: ${erro}`);
        continue;
      }
      // posProcessarDescricao poda a seção de perguntas incompleta ANTES de ancorar os
      // bullets — mesma ordem de produção (process-familia / regenerar-copy-familia).
      const final = posProcessarDescricao(g.descricao, f.nome_pai, f.descricao_pai);
      desteProduto[c.chave] = final;
      custoDeste[c.chave] = (g.tokensIn / 1000) * c.preco.in + (g.tokensOut / 1000) * c.preco.out;
      blocos.push(`### ${c.rotulo}\n\n\`\`\`\n${final}\n\`\`\`\n`);
    }

    console.log(`  ${i + 1}/${familias.length} ${f.codigo_pai}`);
    return { i, f, blocos, desteProduto, custoDeste, falhouEm };
  }

  // Lotes de CONCORRENCIA produtos. Os resultados são reordenados por índice depois, para
  // que resultado.md e os arrays de métrica sigam a ordem da amostra e não a de chegada.
  const resultados: Awaited<ReturnType<typeof processar>>[] = [];
  for (let i = 0; i < familias.length; i += CONCORRENCIA) {
    const lote = familias.slice(i, i + CONCORRENCIA);
    resultados.push(...await Promise.all(lote.map((f, j) => processar(f, i + j))));
  }
  resultados.sort((a, b) => a.i - b.i);

  for (const r of resultados) {
    fontes.push(`${r.f.nome_pai}\n${r.f.descricao_pai}`);
    saidas.A.push(r.f.descricao_ml);
    for (const c of CENARIOS) {
      saidas[c.chave].push(r.desteProduto[c.chave] ?? '');
      custo[c.chave] += r.custoDeste[c.chave] ?? 0;
      if (r.falhouEm.includes(c.chave)) falhas[c.chave] += 1;
    }
    linhas.push(...r.blocos);
  }

  const resumo: Record<string, unknown> = { A: { ...metricas(saidas.A, fontes), custo_usd: 0, falhas: 0 } };
  for (const c of CENARIOS) {
    resumo[c.chave] = {
      ...metricas(saidas[c.chave], fontes),
      custo_usd: Number(custo[c.chave].toFixed(4)),
      falhas: falhas[c.chave],
    };
  }

  writeFileSync(join(AQUI, 'resultado.md'), linhas.join('\n'), 'utf-8');
  writeFileSync(join(AQUI, 'resultado.json'), JSON.stringify(resumo, null, 2), 'utf-8');
  console.table(resumo);
  console.log('\nresultado.md e resultado.json gravados em scripts/experimento-copy/.');
}

main().catch((e) => { console.error(e); process.exit(1); });
