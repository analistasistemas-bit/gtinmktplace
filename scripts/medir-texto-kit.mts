// Medição do texto do kit com variação (ADR-0200) no modelo real. FORA da suíte: chama OpenRouter de
// verdade e lê bases reais (só SELECT, Management API). Não grava nada.
//   node --experimental-transform-types scripts/medir-texto-kit.mts [execucoes=4] [modelo]
// Env (do .env.local do checkout principal): OPENROUTER_API_KEY, SUPABASE_ACCESS_TOKEN.
import fs from 'node:fs';
import {
  montarTextoKit, montarUserPromptKit, SYSTEM_KIT_VARIACAO, type DadosTextoKit,
} from '../supabase/functions/_shared/ai/copywriter-kit-prompt.ts';
import { linhaTamanhos, tamanhosDaGradeCopy } from '../supabase/functions/_shared/ai/copywriter-prompt.ts';
import { PROIBIDOS } from '../supabase/functions/_shared/ai/titulo-grade.ts';

const ENV = process.env.ENV_FILE ?? '/Users/diego/Desktop/IA/Anuncios MktPlace/.env.local';
const env = Object.fromEntries(fs.readFileSync(ENV, 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].trim().replace(/^"|"$/g, '')]));
for (const k of ['OPENROUTER_API_KEY', 'SUPABASE_ACCESS_TOKEN']) if (!env[k]) throw new Error(`falta ${k} em ${ENV}`);

const EXECUCOES = Number(process.argv[2] ?? 4);
const MODELO = process.argv[3] ?? 'openai/gpt-6-luna';

async function sql<T>(query: string): Promise<T[]> {
  for (let t = 0; ; t++) {
    const r = await fetch('https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query', {
      method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (r.ok) return r.json() as Promise<T[]>;
    if (r.status !== 502 || t === 2) throw new Error(`SQL ${r.status}: ${await r.text()}`);
  }
}

interface Base {
  org_id: string; codigo_pai: string; nome_pai: string; titulo_ml: string | null; descricao_ml: string;
  variacoes: Array<{ cor: string; tamanho: string; excluida_da_publicacao: boolean | null }>;
}
// Base canônica por org e PAI (criado_em desc, id desc), roupa em grade com ≥ 2 cores e descrição no padrão.
const bases = await sql<Base>(`
  with c as (select distinct on (org_id, codigo_pai) id, org_id, codigo_pai, nome_pai, titulo_ml, descricao_ml
             from familias order by org_id, codigo_pai, criado_em desc, id desc)
  select c.org_id, c.codigo_pai, c.nome_pai, c.titulo_ml, c.descricao_ml,
         json_agg(json_build_object('cor', v.cor, 'tamanho', v.tamanho, 'excluida_da_publicacao', v.excluida_da_publicacao)) variacoes
  from c join variacoes v on v.familia_id = c.id
  where c.descricao_ml like '%✅%' and v.tamanho is not null
  group by 1,2,3,4,5 having count(distinct v.cor) filter (where not coalesce(v.excluida_da_publicacao,false)) >= 2
  order by 2, 1`);

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const numeros = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
const palavras = (s: string) => new Set(norm(s).match(/\p{L}{5,}/gu) ?? []);

interface Caso { base: Base; dados: DadosTextoKit }
const casos: Caso[] = bases.map((b, i) => {
  const vivas = b.variacoes.filter((v) => !v.excluida_da_publicacao);
  const coresBase = [...new Set(vivas.map((v) => v.cor.trim()))];
  const pecas = i % 3 === 2 && coresBase.length >= 3 ? 3 : 2;
  // Subconjunto que não é sempre o das primeiras; metade dos casos com uma cor a mais que as peças.
  const n = Math.min(coresBase.length, pecas + (i % 2));
  const coresKit = Array.from({ length: n }, (_, k) => coresBase[(i + k) % coresBase.length]);
  const todos = tamanhosDaGradeCopy(vivas.map((v, k) => ({ codigo: String(k), cor: v.cor, preco: 1, tamanho: v.tamanho }))) ?? [];
  const tamanhosKit = todos.length > 1 ? todos.slice(0, -1) : todos; // tira um tamanho para provar o filtro
  return {
    base: b,
    dados: {
      descricaoBase: b.descricao_ml, tituloBase: b.titulo_ml ?? b.nome_pai, nomeBase: b.nome_pai, pecas, coresBase, coresKit, tamanhosKit, tamanhosBase: todos,
    },
  };
});

async function chamar(d: DadosTextoKit) {
  const t0 = Date.now();
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO, temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_KIT_VARIACAO }, { role: 'user', content: montarUserPromptKit(d) }],
    }),
  });
  const j = await r.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens: number; completion_tokens: number }; error?: unknown };
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${JSON.stringify(j.error ?? j)}`);
  return { ia: JSON.parse(j.choices?.[0]?.message?.content ?? ''), ms: Date.now() - t0, usage: j.usage };
}

function conferir(c: Caso, ia: { cabecalho?: string; paragrafos?: string[]; fechamento?: string }) {
  const d = c.dados;
  const { titulo, descricao } = montarTextoKit(d, ia);
  const ordem = ['🧵', '✅', '📌', '📏', '❓', '🎨', 'A tonalidade pode variar conforme a tela do dispositivo.'];
  const pos = ordem.map((h) => descricao.indexOf(h));
  const ini = descricao.indexOf('🎨');
  const fimCores = descricao.indexOf('A tonalidade', ini);
  const listaCores = descricao.slice(ini, fimCores).match(/^- .+$/gm)?.map((l) => l.slice(2)) ?? [];
  let semKit = norm(descricao + ' ' + titulo);
  for (const k of [...d.coresKit].sort((a, b) => b.length - a.length)) semKit = semKit.split(norm(k)).join(' ');
  const corFora = d.coresBase.filter((x) => !d.coresKit.includes(x))
    .filter((x) => new RegExp(`(?<![\\p{L}])${norm(x)}(?![\\p{L}])`, 'u').test(semKit));
  const permitidos = new Set([...numeros(`${d.descricaoBase} ${d.tituloBase} ${d.nomeBase}`), String(d.pecas)]);
  const numFora = numeros(descricao + ' ' + titulo).filter((n) => !permitidos.has(n));
  const abertura = descricao.slice(0, descricao.indexOf('\n✅') > -1 ? descricao.indexOf('\n✅') : 400);
  const vistas = palavras(`${d.descricaoBase} ${d.tituloBase} ${d.nomeBase} ${d.coresKit.join(' ')} kit pecas cores combinadas unidades`);
  const novas = [...palavras(abertura)].filter((w) => !vistas.has(w));
  const paragrafosIa = (ia.paragrafos ?? []).filter((p) => descricao.includes(String(p).trim())).length;
  return {
    titulo, descricao,
    ordem: pos.every((p) => p > -1) && pos.every((p, k) => k === 0 || p > pos[k - 1]) && descricao.startsWith(`🧵 KIT ${d.pecas} `),
    tituloOk: titulo.startsWith(`Kit ${d.pecas} `) && titulo.length <= 60
      && !titulo.split(' ').some((w) => w.toLowerCase() !== 'top' && PROIBIDOS.has(norm(w).replace(/[^a-z0-9%]/g, ''))),
    // Depois do aviso de tonalidade, só a frase final (uma linha de prosa).
    fimOk: descricao.slice(descricao.indexOf('A tonalidade pode variar')).trim().split('\n').filter(Boolean).length === 2,
    coresOk: JSON.stringify([...listaCores].sort()) === JSON.stringify([...d.coresKit].sort()) && corFora.length === 0,
    tamanhosOk: descricao.includes(linhaTamanhos(d.tamanhosKit)) && (descricao.match(/Tamanhos disponíveis:/g) ?? []).length === 1,
    qtdOk: descricao.includes(`• Quantidade: Kit com ${d.pecas} unidades`)
      && descricao.includes(`▪ Quantas unidades acompanham o produto? ${d.pecas} unidades (kit).`) && !/\b1 unidade\b/.test(descricao),
    numerosOk: numFora.length === 0,
    corFora, numFora, novas,
    iaCab: descricao.split('\n')[0] !== `🧵 KIT ${d.pecas} ${d.descricaoBase.split('\n')[0].replace(/^🧵\s*/u, '').toLocaleUpperCase('pt-BR')}`,
    iaPar: paragrafosIa, iaFim: !!ia.fechamento && descricao.trim().endsWith(String(ia.fechamento).trim()),
  };
}

const tarefas = casos.flatMap((c) => Array.from({ length: EXECUCOES }, () => c));
const resultados = await Promise.all(tarefas.map(async (c) => {
  try {
    const { ia, ms, usage } = await chamar(c.dados);
    return { c, ms, usage, ia, ...conferir(c, ia), erro: '' };
  } catch (e) {
    return { c, erro: (e as Error).message };
  }
}));

fs.writeFileSync('/tmp/medir-texto-kit.json', JSON.stringify(resultados.map((r) => ({ ...r, c: { codigo: r.c.base.codigo_pai, dados: { ...r.c.dados, descricaoBase: undefined } } })), null, 2));
console.log(`modelo ${MODELO} · ${casos.length} produtos × ${EXECUCOES}\n`);
console.log('| PAI | org | N | cores kit | tamanhos | ordem | título | cores | tamanhos | qtd | números | fim | IA cab/par/fim | ms méd | erros |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of casos) {
  const rs = resultados.filter((r) => r.c === c);
  const ok = rs.filter((r) => !r.erro) as Array<ReturnType<typeof conferir> & { ms: number }>;
  const n = (f: (r: (typeof ok)[number]) => boolean) => `${ok.filter(f).length}/${rs.length}`;
  const ms = ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : 0;
  console.log(`| ${c.base.codigo_pai} | ${c.base.org_id.slice(0, 4)} | ${c.dados.pecas} | ${c.dados.coresKit.join(', ')} | ${c.dados.tamanhosKit.join(' ')} | ${n((r) => r.ordem)} | ${n((r) => r.tituloOk)} | ${n((r) => r.coresOk)} | ${n((r) => r.tamanhosOk)} | ${n((r) => r.qtdOk)} | ${n((r) => r.numerosOk)} | ${n((r) => r.fimOk)} | ${n((r) => r.iaCab)} / ${ok.reduce((s, r) => s + r.iaPar, 0)} par / ${n((r) => r.iaFim)} | ${ms} | ${rs.length - ok.length} |`);
}
const falhas = resultados.filter((r) => r.erro || !r.ordem || !r.tituloOk || !r.coresOk || !r.tamanhosOk || !r.qtdOk || !r.numerosOk || !r.fimOk);
console.log(`\nfalhas: ${falhas.length}`);
for (const f of falhas.slice(0, 10)) console.log(f.c.base.codigo_pai, f.erro || JSON.stringify({ corFora: f.corFora, numFora: f.numFora, titulo: f.titulo }));
const novas = resultados.flatMap((r) => (r.novas ?? []).map((w: string) => `${r.c.base.codigo_pai}:${w}`));
console.log(`\npalavras da abertura que não estão na base (revisar à mão): ${[...new Set(novas)].join(', ')}`);
