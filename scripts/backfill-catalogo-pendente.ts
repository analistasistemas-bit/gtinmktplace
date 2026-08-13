// Backfill das famílias congeladas em catalog_status='pendente' (spec 2026-08-12 §1.4).
// Re-enfileira vincular-catalogo com tentativa=1 via QStash — NÃO toca ML nem banco.
// SILENCIOSO (decisão 2026-08-13): alertar=false suprime o Telegram desta cadeia; o
// resultado é conferido pela tela "Catálogo em risco" e pelo SQL de conferência.
//
// PRÉ-REQUISITO: o worker corrigido precisa estar deployado. Worker antigo ignora o campo
// `alertar` (desconhecido para ele) e dispararia a enxurrada de Telegram que a decisão veta.
//
// Uso (na raiz do repo, env de PRODUÇÃO):
//   SUPABASE_URL=https://<ref>.supabase.co QSTASH_TOKEN=... \
//     deno run --allow-net --allow-env --allow-read \
//     scripts/backfill-catalogo-pendente.ts familias.txt [--executar]
//
// familias.txt: um familia_id (uuid) por linha. Sem --executar: dry-run (só imprime).
// A saída da execução real (familia_id<TAB>messageId<TAB>delay) DEVE ser salva — os
// messageIds são o mecanismo de reversão (DELETE na API do QStash antes da entrega).
//
// Publica DIRETO no QStash (mesmo destino/formato de enfileirarVinculacaoCatalogo) porque a
// helper não conhece o campo `alertar` — de propósito: queue.ts intocado = deploy de 8 funções.
import { qstashClient } from '../supabase/functions/_shared/queue.ts';

const TARGET = `${Deno.env.get('SUPABASE_URL')!}/functions/v1/vincular-catalogo`;

const [arquivo, flag] = Deno.args;
if (!arquivo) { console.error('uso: backfill-catalogo-pendente.ts <familias.txt> [--executar]'); Deno.exit(1); }
const ids = (await Deno.readTextFile(arquivo)).split('\n').map((s) => s.trim()).filter(Boolean);
console.error(`${ids.length} famílias no arquivo`);

if (flag !== '--executar') {
  for (const [i, id] of ids.entries()) console.log(`${id}\t(dry-run)\tdelay=${60 + i * 30}s`);
  console.error('dry-run — nada enfileirado. Rode com --executar para valer.');
  Deno.exit(0);
}

for (const [i, id] of ids.entries()) {
  const delay = 60 + i * 30; // escalona p/ não martelar a API do ML (publishJSON não serializa)
  const { messageId } = await qstashClient().publishJSON({
    url: TARGET,
    body: { familia_id: id, tentativa: 1, alertar: false }, // silencioso (decisão 2026-08-13)
    delay,
    retries: 5,
  });
  console.log(`${id}\t${messageId}\tdelay=${delay}s`);
}
console.error('concluído — salve esta saída (messageIds = reversão).');
