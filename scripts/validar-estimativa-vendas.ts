// Task 13 (ADR-0189 D-9): valida `estimarVendas` contra o total vendido real dos anúncios próprios.
// Critérios fixados antes de medir: docs/superpowers/plans/2026-10-21-extensao-publiai.md (Task 13). Só GET.
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env --allow-read --allow-write --node-modules-dir=none \
//     scripts/validar-estimativa-vendas.ts [saida.csv]
// O CSV por anúncio vai para o caminho dado (fora do repo, que é público); o stdout só tem agregados.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../supabase/functions/_shared/ml/token.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../supabase/functions/_shared/ml/multiget.ts';
import { estimarVendas, faixaDoTotal } from '../extensao/src/compartilhado/estimativa.ts';

const API = 'https://api.mercadolibre.com';
const saida = Deno.args[0];
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any; // ponytail: resposta do ML lida só por campo, script descartável

/** GET 200 ou aborta: coleta incompleta nunca vira medição (achado Codex). */
async function get(token: string, path: string): Promise<Json> {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429 && tentativa < 4) { await new Promise((ok) => setTimeout(ok, 1500 * (tentativa + 1))); continue; }
    if (r.status !== 200) throw new Error(`HTTP ${r.status} em ${path.split('?')[0]}: medição abortada`);
    return await r.json();
  }
}

interface Linha { conta: string; id: string; real: number; piso: number; avaliacoes: number; dias: number; premium: boolean; est: number; amostra: 'validacao' | 'ajuste' }
const linhas: Linha[] = [];
const agora = new Date();

const { data: conexoes } = await admin.from('marketplace_connections')
  .select('id, org_id, canal, conta_externa_id, expires_at').eq('canal', 'mercado_livre');

for (const c of conexoes ?? []) {
  const token = await getValidAccessTokenConexao({ id: c.id, orgId: c.org_id, canal: c.canal, contaExternaId: c.conta_externa_id, expiresAt: c.expires_at });
  // Ativos da conta (scan pagina sem o teto de 1000 do offset).
  const ids: string[] = [];
  let scroll: string | null = null;
  do {
    const r = await get(token, `/users/${c.conta_externa_id}/items/search?status=active&search_type=scan&limit=100${scroll ? `&scroll_id=${scroll}` : ''}`);
    const pagina: string[] = r.results ?? [];
    ids.push(...pagina);
    scroll = pagina.length ? r.scroll_id ?? null : null;
  } while (scroll);

  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const r = await get(token, caminhoMultiget(lote, 'id,sold_quantity,date_created,listing_type_id'));
    for (const e of (comoEnvelopeAntigo(r, lote) as Json[]) ?? []) {
      if (e?.code !== 200) throw new Error(`multiget ${e?.code} em ${e?.body?.id ?? '?'}: medição abortada`);
      const b = e.body;
      if (!(b.sold_quantity >= 5)) continue; // critério (3)
      const rev = await get(token, `/reviews/item/${b.id}?limit=1`);
      const avaliacoes = Number(rev?.paging?.total ?? 0);
      const piso = faixaDoTotal(b.sold_quantity);
      const premium = b.listing_type_id === 'gold_pro';
      const est = estimarVendas({ piso, avaliacoes, criadoEm: b.date_created, premium }, agora);
      if (est === null || piso === null) continue;
      linhas.push({
        conta: c.conta_externa_id, id: b.id, real: b.sold_quantity, piso, avaliacoes, premium, est,
        dias: Math.floor((agora.getTime() - new Date(b.date_created).getTime()) / 86_400_000),
        amostra: Number(b.id.at(-1)) % 2 === 0 ? 'validacao' : 'ajuste', // critério (5)
      });
    }
  }
}

const erro = (est: number, real: number) => Math.abs(est - real) / real;
/** Quantil com interpolação linear (mediana de n par = média dos dois centrais). */
const quantil = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q, i = Math.floor(pos);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const centroDaFaixa = (piso: number) => (piso <= 4 ? piso : Math.round((piso + (faixaProximo(piso) - 1)) / 2));
function faixaProximo(piso: number): number {
  // Patamares do ML medidos em 22/10/2026 (mesma lista de estimativa.ts); último sem teto → centro = piso.
  const p = [1, 5, 25, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 250000, 500000, 750000];
  return p[p.indexOf(piso) + 1] ?? piso + 1;
}

function relatorio(nome: string, ls: Linha[]) {
  const e = ls.map((l) => erro(l.est, l.real));
  console.log(`\n## ${nome}: n=${ls.length}`);
  if (!ls.length) return;
  console.log(`estimativa    mediana ${pct(quantil(e, 0.5))} · P75 ${pct(quantil(e, 0.75))}`);
  console.log(`centro faixa  mediana ${pct(quantil(ls.map((l) => erro(centroDaFaixa(l.piso), l.real)), 0.5))}`);
  console.log(`piso          mediana ${pct(quantil(ls.map((l) => erro(l.piso, l.real)), 0.5))}`);
  const porFaixa = new Map<number, Linha[]>();
  for (const l of ls) porFaixa.set(l.piso, [...(porFaixa.get(l.piso) ?? []), l]);
  for (const [piso, g] of [...porFaixa].sort((a, b) => a[0] - b[0])) {
    console.log(`  faixa +${piso}: n=${g.length} mediana ${pct(quantil(g.map((l) => erro(l.est, l.real)), 0.5))}`);
  }
}

const validacao = linhas.filter((l) => l.amostra === 'validacao');
relatorio('VALIDAÇÃO (gate)', validacao);
relatorio('ajuste (reservada, não decide)', linhas.filter((l) => l.amostra === 'ajuste'));
const med = quantil(validacao.map((l) => erro(l.est, l.real)), 0.5);
console.log(`\nGATE: ${validacao.length < 30 ? 'INCONCLUSIVO (n<30) → estimativa desligada' : med <= 0.3 ? `PASSA (mediana ${pct(med)} ≤ 30%)` : `REPROVA (mediana ${pct(med)} > 30%) → estimativa desligada`}`);

if (saida) {
  const cab = 'conta,id,amostra,real,piso,avaliacoes,dias,premium,estimativa,erro';
  await Deno.writeTextFile(saida, [cab, ...linhas.map((l) => [l.conta, l.id, l.amostra, l.real, l.piso, l.avaliacoes, l.dias, l.premium, l.est, erro(l.est, l.real).toFixed(4)].join(','))].join('\n'));
  console.log(`CSV: ${saida}`);
}
