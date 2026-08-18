// Sonar — vendas estimadas via Apify (ADR-0122). Separada da pulse-sonar de propósito: o run
// da Apify pode levar minutos e a falha dele degrada só este bloco, nunca o painel oficial.
// Só leitura; cache global 24h (dado público, mesma regra do ADR-0120 §3).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { apifyConfigurado, buscarAnunciosML } from '../_shared/apify/client.ts';
import { montarPainelVendas, parseItensApify } from '../_shared/pulse/sonar-vendas.ts';

const CACHE_TTL_S = 24 * 60 * 60;
const normalizarTermo = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try { await requireUserOrg(req, { access: 'read' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { termo?: string };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const normalizado = normalizarTermo(body.termo ?? '');
  if (normalizado.length < 3) return json({ erro: 'termo obrigatório (mínimo 3 caracteres)' }, 400);

  // Sem token → indisponível explícito, com 200: ausência de configuração não é erro de busca
  // e não pode virar toast destrutivo no front (ADR-0122 §5).
  if (!apifyConfigurado()) return json({ configurado: false });

  const chave = `sonar:vendas:v1:MLB:${normalizado}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return json(JSON.parse(cacheado));

  const itens = await buscarAnunciosML(normalizado);
  // null = falha/timeout do run — não cachear (cache global 24h travaria o termo com erro
  // transitório para todo mundo, mesmo racional da pulse-sonar).
  if (itens === null) return json({ erro: 'Consulta de vendas falhou ou demorou demais. Tente de novo em instantes.' }, 502);

  const resposta = { configurado: true as const, ...montarPainelVendas(normalizado, parseItensApify(itens)) };
  await redisSet(chave, JSON.stringify(resposta), CACHE_TTL_S).catch(() => {});
  return json(resposta);
});
