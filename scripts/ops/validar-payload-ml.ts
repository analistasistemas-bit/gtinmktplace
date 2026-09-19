// One-off (spike 051, ADR-0166): valida um payload de item via POST /items/validate — NUNCA cria
// nada, é o endpoint de dry-run do ML. Usa o token real da conexão da org (read-only na prática).
// Uso (raiz do repo):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env --node-modules-dir=none scripts/ops/validar-payload-ml.ts <connection_id> <payload.json>

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../../supabase/functions/_shared/ml/token.ts';

const [connectionId, payloadPath] = Deno.args;
if (!connectionId || !payloadPath) {
  console.error('uso: validar-payload-ml.ts <connection_id> <payload.json>');
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
const body = await Deno.readTextFile(payloadPath);

const resp = await fetch('https://api.mercadolibre.com/items/validate', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body,
});
const json = await resp.json();
console.log('HTTP', resp.status);
console.log(JSON.stringify(json, null, 2));
