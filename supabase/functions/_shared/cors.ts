export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, upstash-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(): Response {
  return new Response(null, { headers: corsHeaders });
}
