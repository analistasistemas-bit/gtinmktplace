// One-off (spike 051, ADR-0166): GET autenticado arbitrário na API do ML, com o token real da
// conexão da org. Só leitura.
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env --node-modules-dir=none scripts/ops/ml-get.ts <connection_id> <path-ou-url>

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../../supabase/functions/_shared/ml/token.ts';

const [connectionId, pathOrUrl] = Deno.args;
if (!connectionId || !pathOrUrl) {
  console.error('uso: ml-get.ts <connection_id> <path-ou-url>');
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
const target = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.mercadolibre.com${pathOrUrl}`;

const resp = await fetch(target, { headers: { Authorization: `Bearer ${token}` } });
const text = await resp.text();
console.log('HTTP', resp.status);
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
catch { console.log(text); }
