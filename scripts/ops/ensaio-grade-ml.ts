// One-off (ADR-0182, Task 9 Step 5): ensaio das grades de tamanho contra o ML REAL. NUNCA cria
// anúncio: o único POST ao ML de item é /items/validate (dry-run). Efeito colateral autorizado:
// `garantirChart` pode CRIAR o chart na conta e gravar o cache `ml_size_charts` (o mesmo que a
// 1ª publicação faria). Token lido de get_connection_tokens SEM renovar: vencido ou a <5 min de
// vencer aborta antes de qualquer chamada ao ML.
// Uso (raiz do repo):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env --allow-read --node-modules-dir=none \
//       --config supabase/functions/deno.json scripts/ops/ensaio-grade-ml.ts \
//       <connection_id> <categoria_id> <genero> <grade> <tamanho1,tamanho2,...>

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { garantirChart, GENDER_VALUE, lerDominioCategoria, type Genero } from '../../supabase/functions/_shared/ml/size-chart.ts';
import { montarPayloadItem } from '../../supabase/functions/_shared/ml/publicar.ts';
import type { GradeTamanho } from '../../supabase/functions/_shared/produto/tipos-produto-valores.ts';

const [connectionId, categoriaId, generoArg, gradeArg, tamanhosArg] = Deno.args;
if (!connectionId || !categoriaId || !generoArg || !gradeArg || !tamanhosArg) {
  console.error('uso: ensaio-grade-ml.ts <connection_id> <categoria_id> <genero> <grade> <tamanho1,tamanho2,...>');
  Deno.exit(1);
}
const genero = generoArg as Genero;
const grade = gradeArg as GradeTamanho;
const tamanhos = tamanhosArg.split(',').map((t) => t.trim()).filter(Boolean);
if (!Object.hasOwn(GENDER_VALUE, genero)) {
  console.error(`gênero inválido: ${genero} (válidos: ${Object.keys(GENDER_VALUE).join(', ')})`);
  Deno.exit(1);
}

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios (env)');
  Deno.exit(1);
}
const admin = createClient(url, key);

// Token: nunca renova, nunca imprime.
const { data: tk, error: tkErr } = await admin.rpc('get_connection_tokens', { p_connection_id: connectionId });
const linha = (tk as { access_token: string | null; expires_at: string | null }[] | null)?.[0];
if (tkErr || !linha?.access_token || !linha.expires_at) {
  console.error(`BLOCKED: token ML indisponível (${tkErr?.message ?? 'sem linha/token'})`);
  Deno.exit(1);
}
const token = linha.access_token;
const expira = new Date(linha.expires_at).getTime();
console.log(`token expira em ${linha.expires_at}`);
if (!(expira - Date.now() > 5 * 60_000)) {
  console.error('BLOCKED: token vencido ou a <5 min de vencer; não renovar fora do app. Aguarde o app renovar.');
  Deno.exit(1);
}

// 1) Chart real (pode criar chart + gravar cache).
const resolvido = await garantirChart(admin, token, connectionId, categoriaId, genero, tamanhos, grade);
const chart = 'chartId' in resolvido ? resolvido : null;
console.log(chart ? `chart: ${chart.chartId}` : 'chart: sem guia');

// 2) 1 SKU plano, pelo mesmo montarPayloadItem do publicar-familia-up.
const tamanho = tamanhos[0];
const linhaChart = chart?.linhaPorTamanho.get(tamanho);
if (chart && !linhaChart) {
  console.error(`chart ${chart.chartId} não cobre o tamanho ${tamanho}`);
  Deno.exit(1);
}
const familia = {
  titulo_ml: 'Ensaio PubliAI grade',
  descricao_ml: null,
  categoria_ml_id: categoriaId,
  atributos_ml: [
    { id: 'GENDER', value_id: GENDER_VALUE[genero].id },
    { id: 'BRAND', value_name: 'Generica' },
    { id: 'MODEL', value_name: 'Teste' },
  ],
};
const variacao = {
  codigo: 'ENSAIO-GRADE', cor: 'Azul', estoque: 1, preco_publicacao: 49.9, gtin: null, ml_picture_id: null,
  tamanho,
  ...(chart
    ? { sizeGridId: chart.chartId, sizeGridRowId: linhaChart!.rowId, sizeLabel: linhaChart!.sizeLabel }
    : { tamanhoSemGuia: 'semGuia' in resolvido ? resolvido.semGuia : null }),
};
// 'plano' força o item plano (family_name), como as categorias de vestuário em UP.
const payload = montarPayloadItem(familia, [variacao], null, null, null, undefined, null, undefined, 'plano');
// Foto de teste por URL (montarPayloadItem só conhece picture ids já enviados ao ML).
(payload as { pictures: unknown }).pictures = [
  { source: 'https://http2.mlstatic.com/D_NQ_NP_2X_000000-MLA00000000000_000000-F.jpg' },
];
console.log('atributos enviados:', JSON.stringify(payload.attributes));

// 3) SOMENTE /items/validate.
const alvo = 'https://api.mercadolibre.com/items/validate';
if (!alvo.endsWith('/items/validate')) throw new Error('URL inesperada: só /items/validate é permitido');
const resp = await fetch(alvo, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const texto = await resp.text();
console.log('HTTP', resp.status);
if (resp.status === 204 || texto === '') {
  console.log('ML: sem causas (validação ok)');
} else {
  try {
    const j = JSON.parse(texto) as { message?: string; cause?: { type?: string; code?: string; message?: string }[] };
    if (j.message) console.log('mensagem:', j.message);
    for (const c of j.cause ?? []) console.log(`causa [${c.type}] ${c.code}: ${c.message}`);
    if (!j.cause?.length) console.log(texto);
  } catch {
    console.log(texto);
  }
}

// 4) Linha do cache.
const dominio = await lerDominioCategoria(categoriaId);
const { data: cache, error: cErr } = await admin.from('ml_size_charts')
  .select('chart_id, domain_id, genero, linhas')
  .eq('connection_id', connectionId).eq('domain_id', dominio ?? '').eq('genero', genero)
  .eq('grade_tamanho', grade)
  .maybeSingle();
if (cErr) console.error('erro lendo ml_size_charts:', cErr.message);
else if (!cache) console.log(`ml_size_charts: SEM LINHA para (${dominio}, ${genero}, ${grade})${chart ? ' — FALHA DE CACHE' : ' (esperado: sem guia)'}`);
else console.log(`ml_size_charts: chart_id=${cache.chart_id} domínio=${cache.domain_id} gênero=${cache.genero} tamanhos=${Object.keys(cache.linhas as object).join(',')}`);
