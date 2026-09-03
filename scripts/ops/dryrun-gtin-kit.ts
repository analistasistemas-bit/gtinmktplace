// One-off DRY-RUN: POST /items/validate no ML (valida payload; NÃO cria, NÃO altera anúncio).
// Prova qual EMPTY_GTIN_REASON a categoria do kit aceita quando o kit não tem GTIN próprio.
// Uso (raiz do repo):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env --node-modules-dir=none scripts/ops/dryrun-gtin-kit.ts <familia_id> <connection_id>
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../../supabase/functions/_shared/ml/token.ts';
import { montarAtributosPacote } from '../../supabase/functions/_shared/ml/pacote.ts';

const [familiaId, connectionId] = Deno.args;
const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!familiaId || !connectionId || !url || !key) {
  console.error('uso: dryrun-gtin-kit.ts <familia_id> <connection_id> (com SUPABASE_URL/SERVICE_ROLE_KEY)');
  Deno.exit(1);
}

const admin = createClient(url, key);
const { data: conn } = await admin.from('marketplace_connections')
  .select('id, org_id, canal, conta_externa_id, expires_at').eq('id', connectionId).single();
if (!conn) { console.error('conexão não encontrada'); Deno.exit(1); }
const token = await getValidAccessTokenConexao({
  id: conn.id, orgId: conn.org_id, canal: conn.canal,
  contaExternaId: conn.conta_externa_id, expiresAt: conn.expires_at,
});

const { data: fam } = await admin.from('familias')
  .select('titulo_ml, categoria_ml_id, atributos_ml, capa_ml_picture_id, variacoes(codigo, cor, estoque, preco_publicacao, gtin, ml_picture_id, peso_gramas, altura_cm, largura_cm, comprimento_cm)')
  .eq('id', familiaId).single();
if (!fam) { console.error('família não encontrada'); Deno.exit(1); }
const v = (fam.variacoes as Array<Record<string, unknown>>)[0];

const picIds = [fam.capa_ml_picture_id, v.ml_picture_id].filter((x): x is string => !!x);
const base = {
  title: fam.titulo_ml,
  category_id: fam.categoria_ml_id,
  currency_id: 'BRL',
  buying_mode: 'buy_it_now',
  listing_type_id: 'gold_special',
  condition: 'new',
  pictures: [...new Set(picIds)].map((id) => ({ id })),
  attributes: fam.atributos_ml ?? [],
};

// Formato PLANO (family_name): o que a publicação real acaba usando nesta categoria — a
// tentativa com `variations` é recusada com 369+374 e o app faz retry plano (ADR-0084/0087).
function plano(attrs: Array<Record<string, string>> | null) {
  const attributes = [
    ...(base.attributes as Array<Record<string, unknown>>),
    { id: 'COLOR', value_name: v.cor || 'Único' },
    ...(attrs ?? []),
  ];
  const { title: _t, ...semTitulo } = base as Record<string, unknown> & { title: unknown };
  return {
    ...semTitulo,
    attributes,
    // 1 fixo: estoque real não é o objeto do teste e 0 geraria um erro que polui o resultado.
    available_quantity: 1,
    price: Number(v.preco_publicacao),
    seller_custom_field: `DRYRUN-${v.codigo}`,
    family_name: fam.titulo_ml,
  };
}

const casos: Array<[string, unknown]> = [
  ['A) hoje: EMPTY_GTIN_REASON=17055160 (o produto não tem código cadastrado)', plano([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }])],
  ['B) proposto: EMPTY_GTIN_REASON=17055159 (o produto é um kit ou pack)', plano([{ id: 'EMPTY_GTIN_REASON', value_id: '17055159' }])],
  ['C) controle: nenhum atributo de GTIN', plano(null)],
  ['D) GTIN da unidade-base (7891000444764) + UNITS_PER_PACK=2', plano([{ id: 'GTIN', value_name: '7891000444764' }])],
  ['E) D + dimensões/peso do pacote (payload completo)', {
    ...plano([{ id: 'GTIN', value_name: '7891000444764' }]),
    attributes: [
      ...(plano([{ id: 'GTIN', value_name: '7891000444764' }]).attributes as Array<Record<string, unknown>>),
      ...montarAtributosPacote({
        peso_gramas: Number(v.peso_gramas), altura_cm: Number(v.altura_cm),
        largura_cm: Number(v.largura_cm), comprimento_cm: Number(v.comprimento_cm),
      }),
    ],
  }],
];

for (const [nome, payload] of casos) {
  const r = await fetch('https://api.mercadolibre.com/items/validate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  console.log(`\n### ${nome}\nHTTP ${r.status} ${body.slice(0, 700)}`);
}
