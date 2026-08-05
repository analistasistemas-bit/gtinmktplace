/**
 * Censo de descartes do pipeline de título (ADR-0099/ADR-0100). SOMENTE MEDIÇÃO — nenhuma
 * interpretação, nenhuma escrita no banco (só SELECT), nenhum campo persistido.
 *
 * Para cada família com nome_pai e descricao_pai:
 *   1. Chama o OpenRouter com SYSTEM + montarUserPrompt(copywriter-prompt.ts) — o prompt de
 *      produção, T8 (termos_com_risco) incluso.
 *   2. normalizarSlots → aplicarGuardsTitulo  = ANTES
 *   3. validarSlotsAncorados(ANTES, fonte)     = DEPOIS
 *   4. diff por slot entre ANTES e DEPOIS = o descarte medido (bloco B).
 *   5. termos_com_risco devolvidos pela IA = bloco A.
 *   6. posProcessarTitulo(slotsCrus, fonte) dentro de try/catch só para contar TituloInviavelError
 *      (bloco D) — não usa o título final.
 *
 * NÃO importa copywriter.ts nem client.ts: copywriter.ts importa client.ts, que usa
 * `npm:openai@^4` e `Deno.env` — ambos quebram em Node (ERR_UNSUPPORTED_ESM_URL_SCHEME). Fala
 * com o OpenRouter por fetch direto e remonta o schema de produção (SCHEMA_COPY em copywriter.ts)
 * a partir de ORDEM_LEITURA + termos_com_risco, mesmo padrão de scripts/experimento-titulo/.
 * coagirSlots/coagirTermosComRisco são cópias das funções homônimas de copywriter.ts pela mesma
 * razão (puras, sem I/O, só não importáveis por causa do import não-relacionado no topo do
 * arquivo original).
 *
 * O restante do pipeline (titulo-pos.ts, titulo-guards.ts, titulo-montar.ts, titulo-slots.ts,
 * cor/indefinida.ts, titulo.ts, titulo-marcas.ts, titulo-case.ts, cor/ordenar.ts, ai/unidade.ts)
 * não tem NENHUM import — roda em Node sem adaptação.
 *
 * Lê a amostra pela management API do Supabase (SUPABASE_ACCESS_TOKEN) — um SELECT único, sem
 * escrita. Project ref default: txvncrgkoynoxwopfkbp (pode ser sobrescrito por env var).
 *
 * A tabela `familias` tem 305 linhas; 304 têm nome_pai E descricao_pai não nulos (a exceção é
 * EXT-MLB6901126538, com descricao_pai nulo) — é sobre essas 304 que o censo roda. codigo_pai
 * repete entre orgs (multi-tenant): cada LINHA é uma família real e conta uma vez.
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=... OPENROUTER_API_KEY=... npx --no-install tsx scripts/censo-descartes/index.ts
 *   AMOSTRA=5 ... (smoke test barato antes da amostra inteira — imprime quais códigos ficaram de fora)
 *
 * pnpm tsx está quebrado neste repo (tsx não é devDependency) — use npx --no-install tsx.
 */
import { SYSTEM, montarUserPrompt, validarTipoProdutoBusca, type InputCopy } from '../../supabase/functions/_shared/ai/copywriter-prompt.ts';
import { posProcessarTitulo, type DadosFonteTitulo } from '../../supabase/functions/_shared/ai/titulo-pos.ts';
import { normalizarSlots, aplicarGuardsTitulo, validarSlotsAncorados } from '../../supabase/functions/_shared/ai/titulo-guards.ts';
import { TituloInviavelError } from '../../supabase/functions/_shared/ai/titulo-montar.ts';
import { ORDEM_LEITURA, SLOTS_VAZIOS, type SlotTitulo, type TituloSlots } from '../../supabase/functions/_shared/ai/titulo-slots.ts';
import { ehCorIndefinida } from '../../supabase/functions/_shared/cor/indefinida.ts';
import { classificarDescarte } from './classificar.ts';

const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'txvncrgkoynoxwopfkbp';
/** Sem cap por padrão — roda a amostra inteira. Defina AMOSTRA=N só para smoke test. */
const TAMANHO_AMOSTRA = process.env.AMOSTRA ? Number(process.env.AMOSTRA) : Infinity;
const CONCORRENCIA = Number(process.env.CONCORRENCIA ?? 5);
const MODELO = process.env.MODELO ?? 'openai/gpt-4.1-mini';

for (const v of ['SUPABASE_ACCESS_TOKEN', 'OPENROUTER_API_KEY']) {
  if (!process.env[v]) throw new Error(`falta a variável de ambiente ${v} — veja o cabeçalho deste arquivo`);
}

async function consultar<T>(sql: string): Promise<T[]> {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
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
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
};

async function amostra(): Promise<{ familias: Familia[]; totalElegivel: number }> {
  const candidatas = await consultar<Familia>(`
    select f.codigo_pai, f.nome_pai, f.descricao_pai, f.unidade, f.fornecedor,
           coalesce(
             (select json_agg(json_build_object('codigo', v.codigo, 'cor', v.cor, 'preco', v.preco))
              from variacoes v where v.familia_id = f.id),
             '[]'::json
           ) as variacoes
    from familias f
    where f.nome_pai is not null and f.descricao_pai is not null
    order by f.codigo_pai
  `);
  return { familias: candidatas.slice(0, TAMANHO_AMOSTRA), totalElegivel: candidatas.length };
}

/** Schema do cenário — remontado localmente, ver nota do cabeçalho. Espelha SCHEMA_COPY de
 *  copywriter.ts, incluindo termos_com_risco (ADR-0100, 11º campo/T8). */
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
      termos_com_risco: { type: 'array', items: { type: 'string' } },
    },
    required: ['titulo_slots', 'descricao', 'tipo_produto_busca', 'termos_com_risco'],
    additionalProperties: false,
  },
  strict: true,
} as const;

/** Cópia de copywriter.ts:coagirSlots (privada lá por causa do import de client.ts no topo). */
function coagirSlots(brutos: Partial<Record<SlotTitulo, unknown>> | undefined | null): TituloSlots {
  const out = { ...SLOTS_VAZIOS };
  for (const slot of ORDEM_LEITURA) {
    const v = brutos?.[slot];
    out[slot] = v == null ? '' : String(v);
  }
  return out;
}

const MAX_TERMOS_COM_RISCO = 10;

/** Cópia de copywriter.ts:coagirTermosComRisco. */
function coagirTermosComRisco(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  for (const item of bruto) {
    if (typeof item !== 'string') continue;
    const termo = item.trim();
    if (!termo || vistos.has(termo)) continue;
    vistos.add(termo);
    if (vistos.size >= MAX_TERMOS_COM_RISCO) break;
  }
  return [...vistos];
}

type Geracao = {
  tituloSlots: TituloSlots;
  tipoProdutoBusca: string;
  termosComRisco: string[];
  /** Diagnóstico do bloco A (achado do revisor): sem isto, "0 famílias com lista não-vazia" é
   *  indistinguível de "a chave nunca chegou na resposta" — metade da medição ficaria
   *  infalsificável. chavePresente = a chave existe no JSON (qualquer tipo); ehArray = além de
   *  presente, é de fato um array (o formato que coagirTermosComRisco aceita). */
  termosComRiscoChavePresente: boolean;
  termosComRiscoEhArray: boolean;
};

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
  const parsed = JSON.parse(conteudo) as {
    titulo_slots: Partial<Record<SlotTitulo, unknown>>;
    tipo_produto_busca: string;
    termos_com_risco?: unknown;
  };
  return {
    tituloSlots: coagirSlots(parsed.titulo_slots),
    tipoProdutoBusca: validarTipoProdutoBusca(parsed.tipo_produto_busca, input.nome, input.descricao_detalhado),
    termosComRisco: coagirTermosComRisco(parsed.termos_com_risco),
    termosComRiscoChavePresente: parsed.termos_com_risco !== undefined,
    termosComRiscoEhArray: Array.isArray(parsed.termos_com_risco),
  };
}

type Descarte = {
  codigoPai: string;
  slot: SlotTitulo;
  /** Valor bruto que a IA devolveu no slot, ANTES de normalizarSlots/aplicarGuardsTitulo — para
   *  distinguir dado que veio da IA de dado que um guard injetou e outro guard removeu de novo
   *  (ver nota em classificar.ts sobre `marca`). */
  bruto: string;
  antes: string;
  depois: string;
  causa: string;
};

type Resultado = {
  codigoPai: string;
  termosComRisco: string[];
  termosComRiscoChavePresente: boolean;
  termosComRiscoEhArray: boolean;
  descartes: Descarte[];
  tituloInviavel: boolean;
};

async function processarFamilia(f: Familia): Promise<
  { ok: true; resultado: Resultado } | { ok: false; codigoPai: string; erro: string }
> {
  const cores = [...new Set(f.variacoes.map((v) => v.cor).filter((c): c is string => !!c && !ehCorIndefinida(c)))];
  const input: InputCopy = {
    nome: f.nome_pai,
    descricao_detalhado: f.descricao_pai,
    variacoes: f.variacoes,
    unidade: f.unidade,
  };

  let geracao: Geracao;
  try {
    geracao = await gerar(input);
  } catch (e) {
    return { ok: false, codigoPai: f.codigo_pai, erro: (e as Error).message };
  }

  const fonte: DadosFonteTitulo = {
    nomePai: f.nome_pai,
    descricaoPai: f.descricao_pai,
    tipoProdutoBusca: geracao.tipoProdutoBusca,
    cores,
    fornecedor: f.fornecedor,
  };
  const textoFonte = `${f.nome_pai} ${f.descricao_pai}`;

  const normalizados = normalizarSlots(geracao.tituloSlots);
  const antes = aplicarGuardsTitulo(normalizados, fonte);
  const depois = validarSlotsAncorados(antes, fonte);

  const descartes: Descarte[] = [];
  for (const slot of ORDEM_LEITURA) {
    if (antes[slot] !== depois[slot]) {
      descartes.push({
        codigoPai: f.codigo_pai,
        slot,
        bruto: geracao.tituloSlots[slot],
        antes: antes[slot],
        depois: depois[slot],
        causa: classificarDescarte(slot, antes[slot], depois[slot], textoFonte, f.fornecedor),
      });
    }
  }

  // Bloco D: só para contar TituloInviavelError — não usa o título final. Qualquer outro tipo de
  // erro aqui é bug do pipeline, não falha esperada — não mascarar (regra 4 do enunciado).
  let tituloInviavel = false;
  try {
    posProcessarTitulo(geracao.tituloSlots, fonte);
  } catch (e) {
    if (e instanceof TituloInviavelError) tituloInviavel = true;
    else throw e;
  }

  return {
    ok: true,
    resultado: {
      codigoPai: f.codigo_pai,
      termosComRisco: geracao.termosComRisco,
      termosComRiscoChavePresente: geracao.termosComRiscoChavePresente,
      termosComRiscoEhArray: geracao.termosComRiscoEhArray,
      descartes,
      tituloInviavel,
    },
  };
}

// ───────────────────────────── agregação e relatório ─────────────────────────────

function top<T>(entradas: Array<[string, T]>, n: number): Array<[string, T]> {
  return entradas.slice(0, n);
}

function imprimirRelatorio(resultados: Resultado[], falhasIA: Array<{ codigoPai: string; erro: string }>, totalElegivel: number, rodadas: number, excluidos: string[]) {
  console.log(`\nElegíveis (nome_pai e descricao_pai não nulos): ${totalElegivel}`);
  console.log(`Rodadas nesta execução: ${rodadas}`);
  if (excluidos.length > 0) {
    console.log(`Excluídas por corte de amostra (AMOSTRA=${TAMANHO_AMOSTRA}): ${excluidos.length}`);
    console.log(`  codigo_pai: ${excluidos.join(', ')}`);
  } else {
    console.log('Nenhuma família elegível ficou de fora.');
  }

  // ---- A. termos_com_risco ----
  console.log('\n=== A. termos_com_risco (T8) ===');
  const chavePresente = resultados.filter((r) => r.termosComRiscoChavePresente).length;
  const ehArray = resultados.filter((r) => r.termosComRiscoEhArray).length;
  console.log(`Chave "termos_com_risco" presente na resposta: ${chavePresente}/${resultados.length}`);
  console.log(`Chave presente E é array (formato aceito por coagirTermosComRisco): ${ehArray}/${resultados.length}`);
  const comLista = resultados.filter((r) => r.termosComRisco.length > 0);
  console.log(`Famílias com lista NÃO vazia: ${comLista.length}/${resultados.length} (${(comLista.length / resultados.length * 100).toFixed(1)}%)`);

  const distribuicaoTamanho = new Map<number, number>();
  for (const r of resultados) {
    distribuicaoTamanho.set(r.termosComRisco.length, (distribuicaoTamanho.get(r.termosComRisco.length) ?? 0) + 1);
  }
  console.log('\nDistribuição do tamanho da lista:');
  for (const [tamanho, n] of [...distribuicaoTamanho.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${tamanho} termo(s): ${n} família(s)`);
  }

  const contagemTermos = new Map<string, number>();
  for (const r of resultados) {
    for (const t of r.termosComRisco) {
      const chave = t.trim().toLowerCase();
      contagemTermos.set(chave, (contagemTermos.get(chave) ?? 0) + 1);
    }
  }
  const termosOrdenados = top([...contagemTermos.entries()].sort((a, b) => b[1] - a[1]), 20);
  console.log('\nTop 20 termos mais frequentes:');
  if (termosOrdenados.length === 0) console.log('  nenhum termo registrado');
  for (const [termo, n] of termosOrdenados) console.log(`  ${n}x  ${termo}`);

  // ---- B. descartes de validarSlotsAncorados ----
  console.log('\n=== B. descartes (validarSlotsAncorados) ===');
  const comDescarte = resultados.filter((r) => r.descartes.length > 0);
  console.log(`Famílias com ALGUM descarte: ${comDescarte.length}/${resultados.length} (${(comDescarte.length / resultados.length * 100).toFixed(1)}%)`);

  const todosDescartes = resultados.flatMap((r) => r.descartes);
  const porSlot = new Map<string, number>();
  for (const slot of ORDEM_LEITURA) porSlot.set(slot, 0);
  for (const d of todosDescartes) porSlot.set(d.slot, (porSlot.get(d.slot) ?? 0) + 1);
  console.log('\nDescartes por slot (ordem de leitura):');
  for (const slot of ORDEM_LEITURA) console.log(`  ${slot}: ${porSlot.get(slot)}`);

  const porCausa = new Map<string, number>();
  for (const d of todosDescartes) porCausa.set(d.causa, (porCausa.get(d.causa) ?? 0) + 1);
  console.log('\nDescartes por causa provável:');
  for (const [causa, n] of [...porCausa.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${causa}`);

  type Padrao = { n: number; slot: string; bruto: string; antes: string; depois: string; causa: string; exemplo: string };
  const porPadrao = new Map<string, Padrao>();
  for (const d of todosDescartes) {
    const chave = `${d.slot}::${d.antes}::${d.depois}`;
    const existente = porPadrao.get(chave);
    if (existente) existente.n += 1;
    else porPadrao.set(chave, { n: 1, slot: d.slot, bruto: d.bruto, antes: d.antes, depois: d.depois, causa: d.causa, exemplo: d.codigoPai });
  }
  const padroesOrdenados = top([...porPadrao.values()].map((p): [string, Padrao] => [p.slot, p]).sort((a, b) => b[1].n - a[1].n), 20);
  console.log(`\nTotal de descartes individuais: ${todosDescartes.length}`);
  console.log('Top 20 padrões (slot, BRUTO da IA, ANTES → DEPOIS) mais frequentes:');
  if (padroesOrdenados.length === 0) console.log('  nenhum descarte registrado');
  for (const [, p] of padroesOrdenados) {
    console.log(`  ${p.n}x [${p.slot}] bruto_ia="${p.bruto}" "${p.antes}" -> "${p.depois}" | causa: ${p.causa} | ex.: ${p.exemplo}`);
  }

  // ---- C. cruzamento A × B ----
  console.log('\n=== C. cruzamento A × B ===');
  let ambos = 0, soA = 0, soB = 0, nenhum = 0;
  for (const r of resultados) {
    const temA = r.termosComRisco.length > 0;
    const temB = r.descartes.length > 0;
    if (temA && temB) ambos += 1;
    else if (temA) soA += 1;
    else if (temB) soB += 1;
    else nenhum += 1;
  }
  console.log(`Ambos (A e B): ${ambos}`);
  console.log(`Só A (termos_com_risco, sem descarte): ${soA}`);
  console.log(`Só B (descarte, sem termos_com_risco): ${soB}`);
  console.log(`Nenhum dos dois: ${nenhum}`);

  // ---- D. falhas ----
  console.log('\n=== D. falhas ===');
  console.log(`Chamadas de IA que falharam: ${falhasIA.length}/${rodadas}`);
  for (const f of falhasIA) console.log(`  ${f.codigoPai}: ${f.erro}`);
  const inviaveis = resultados.filter((r) => r.tituloInviavel);
  console.log(`TituloInviavelError (montarTitulo, dentro de posProcessarTitulo): ${inviaveis.length}/${resultados.length}`);
  for (const r of inviaveis.slice(0, 20)) console.log(`  ${r.codigoPai}`);
}

async function main() {
  const { familias, totalElegivel } = await amostra();
  const rodadasCodigos = new Set(familias.map((f) => f.codigo_pai));

  // Só recalcula a lista de excluídas quando houve corte de amostra (AMOSTRA=N) — sem corte,
  // familias já contém todas as elegíveis e não há exclusão a reportar.
  let excluidosCodigos: string[] = [];
  if (TAMANHO_AMOSTRA < totalElegivel) {
    const todasCandidatas = await consultar<{ codigo_pai: string }>(`
      select codigo_pai from familias
      where nome_pai is not null and descricao_pai is not null
      order by codigo_pai
    `);
    excluidosCodigos = todasCandidatas.map((f) => f.codigo_pai).filter((c) => !rodadasCodigos.has(c));
  }

  console.log(`Amostra: ${familias.length} famílias de ${totalElegivel} elegíveis (nome_pai e descricao_pai não nulos)\n`);

  const resultados: Resultado[] = [];
  const falhasIA: Array<{ codigoPai: string; erro: string }> = [];

  for (let i = 0; i < familias.length; i += CONCORRENCIA) {
    const lote = familias.slice(i, i + CONCORRENCIA);
    const saidas = await Promise.all(lote.map((f) => processarFamilia(f)));
    for (const s of saidas) {
      if (s.ok) resultados.push(s.resultado);
      else falhasIA.push({ codigoPai: s.codigoPai, erro: s.erro });
    }
    console.log(`  processadas ${Math.min(i + CONCORRENCIA, familias.length)}/${familias.length}`);
  }

  imprimirRelatorio(resultados, falhasIA, totalElegivel, familias.length, excluidosCodigos);
}

main().catch((e) => { console.error(e); process.exit(1); });
