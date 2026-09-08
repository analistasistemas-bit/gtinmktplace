export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // `x-region`: header que o supabase-js envia quando `invoke()` recebe `region` (perf FASE 1.1 —
  // roda a função perto do Postgres em us-east-1); sem ele no allow-list o preflight falha e a
  // chamada nem executa.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, upstash-signature, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Preflight cacheado pelo browser por 24h (perf FASE 1.2) — evita o round-trip OPTIONS extra em
  // toda chamada quente.
  'Access-Control-Max-Age': '86400',
};

export function handleOptions(): Response {
  return new Response(null, { headers: corsHeaders });
}
