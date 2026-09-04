// One-off: consulta categoria/domínio de um item ML via token da org (read-only).
// Uso (raiz do repo, env de produção):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env --node-modules-dir=none scripts/ops/consultar-item-ml.ts MLB7488356960 f157fd42-6fd2-41b2-835a-507e9f221b78

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../../supabase/functions/_shared/ml/token.ts';
import { mlGet } from '../../supabase/functions/_shared/ml/http.ts';

const [itemId, connectionId] = Deno.args;
if (!itemId || !connectionId) {
  console.error('uso: consultar-item-ml.ts <MLB...> <connection_id>');
  Deno.exit(1);
}

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios');
  Deno.exit(1);
}

const admin = createClient(url, key);
const { data: row } = await admin.from('marketplace_connections')
  .select('id, org_id, canal, conta_externa_id, expires_at')
  .eq('id', connectionId).single();
if (!row) { console.error('conexão não encontrada'); Deno.exit(1); }

const conexao = {
  id: row.id as string,
  orgId: row.org_id as string,
  canal: row.canal as string,
  contaExternaId: row.conta_externa_id as string | null,
  expiresAt: row.expires_at as string | null,
};

const token = await getValidAccessTokenConexao(conexao);
const json = await mlGet(
  `https://api.mercadolibre.com/items/${itemId}?attributes=id,status,sub_status,category_id,domain_id,title,price`,
  token,
);
if (!json) { console.error('GET item falhou'); Deno.exit(1); }

const item = json as Record<string, unknown>;
console.log(JSON.stringify({
  item_id: item.id,
  status: item.status,
  sub_status: item.sub_status,
  category_id: item.category_id,
  domain_id: item.domain_id,
  title: item.title,
  price: item.price,
}, null, 2));
