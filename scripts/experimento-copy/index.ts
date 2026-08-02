/**
 * Experimento A/B/C de copy (ADR-0098).
 *
 *   A = baseline de produção  → familias.descricao_ml já gravada, NÃO re-executa
 *   B = prompt novo           → gpt-4o-mini
 *   C = prompt novo           → gpt-4o
 *
 * B−A mede o ganho do prompt; C−B mede o ganho do modelo. Rodar os dois juntos tornaria a
 * causa inatribuível.
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
const TAMANHO_AMOSTRA = 30;

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

async function gerar(input: InputCopy, modelo: string): Promise<string> {
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
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
  const json = await r.json();
  return JSON.parse(json.choices[0].message.content).descricao as string;
}

/**
 * Paridade com produção: process-familia aplica os dois guards DEPOIS de gerarCopy, e a
 * descricao_ml do cenário A já passou por eles. Sem aplicar aqui, B e C seriam comparados
 * crus contra um A pós-processado, enviesando estrutura e fidelidade contra os cenários novos.
 */
function comoEmProducao(descricao: string, f: Familia): string {
  return posProcessarDescricao(descricao, f.nome_pai, f.descricao_pai);
}

function metricas(descricoes: string[], fontes: string[]) {
  return {
    formulas_proibidas: descricoes.reduce((n, d) => n + detectarFormulasProibidas(d).length, 0),
    medidas_nao_ancoradas: descricoes.reduce((n, d, i) => n + medidasNaoAncoradas(d, fontes[i]).length, 0),
    comparacoes_nao_ancoradas: descricoes.reduce((n, d, i) => n + comparacoesNaoAncoradas(d, fontes[i]).length, 0),
    taxa_bullets_repetidos: Number(taxaBulletsRepetidos(descricoes).toFixed(3)),
  };
}

async function main() {
  const familias = await amostra();
  console.log(`Amostra: ${familias.length} famílias\n`);

  const linhas: string[] = ['# Experimento de copy — A/B/C (ADR-0098)\n'];
  const saidas = { A: [] as string[], B: [] as string[], C: [] as string[] };
  const fontes: string[] = [];

  for (const [i, f] of familias.entries()) {
    const input: InputCopy = {
      nome: f.nome_pai,
      descricao_detalhado: f.descricao_pai,
      variacoes: f.variacoes,
      unidade: f.unidade,
    };
    fontes.push(`${f.nome_pai}\n${f.descricao_pai}`);

    const a = f.descricao_ml;
    const b = comoEmProducao(await gerar(input, 'openai/gpt-4o-mini'), f);
    const c = comoEmProducao(await gerar(input, 'openai/gpt-4o'), f);

    saidas.A.push(a); saidas.B.push(b); saidas.C.push(c);

    linhas.push(
      `\n---\n\n## ${i + 1}. ${f.codigo_pai} — ${f.nome_pai}\n`,
      `### Fonte\n\n\`\`\`\n${f.descricao_pai}\n\`\`\`\n`,
      `### A — baseline de produção\n\n\`\`\`\n${a}\n\`\`\`\n`,
      `### B — prompt novo, gpt-4o-mini\n\n\`\`\`\n${b}\n\`\`\`\n`,
      `### C — prompt novo, gpt-4o\n\n\`\`\`\n${c}\n\`\`\`\n`,
    );
    console.log(`  ${i + 1}/${familias.length} ${f.codigo_pai}`);
  }

  const resumo = {
    A: metricas(saidas.A, fontes),
    B: metricas(saidas.B, fontes),
    C: metricas(saidas.C, fontes),
  };

  writeFileSync(join(AQUI, 'resultado.md'), linhas.join('\n'), 'utf-8');
  writeFileSync(join(AQUI, 'resultado.json'), JSON.stringify(resumo, null, 2), 'utf-8');
  console.table(resumo);
  console.log('\nresultado.md e resultado.json gravados em scripts/experimento-copy/.');
}

main().catch((e) => { console.error(e); process.exit(1); });
