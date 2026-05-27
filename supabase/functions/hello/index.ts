// Edge Function: hello
// Smoke test que valida que Supabase está deployando funções corretamente.

interface HelloResponse {
  message: string;
  timestamp: string;
}

Deno.serve((_req) => {
  const body: HelloResponse = {
    message: 'PubliAI foundation OK',
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
