// Sonar — vendas estimadas via Apify (ADR-0122). Separada da pulse-sonar de propósito: o run
// da Apify pode levar minutos e a falha dele degrada só este bloco, nunca o painel oficial.
// Só leitura; cache global 24h (dado público, mesma regra do ADR-0120 §3).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { apifyConfigurado, buscarAnunciosML } from '../_shared/apify/client.ts';
import { adminClient } from '../_shared/supabase.ts';
import { montarPainelVendas, parseItensApify, parseTotalAnuncios, linhasSnapshot, type ItemVendas } from '../_shared/pulse/sonar-vendas.ts';

// 7 dias, não 24h: "+N vendidos" é acumulado desde a criação do anúncio e arredondado em faixas
// (100 / 500 / 1k / …), então praticamente não muda de um dia para o outro — o TTL curto só
// pagava o mesmo dado de novo. Cada run custa ~US$ 0,10, então repetição é o desperdício caro.
const CACHE_TTL_S = 7 * 24 * 60 * 60;
const normalizarTermo = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Histórico (ADR-0127/D7): grava SÓ em cache-miss — 1 snapshot por termo por ciclo de TTL, por
// construção. Falha de insert não derruba a resposta (o dado Apify já foi pago), mas nunca é
// silenciosa: log + historico_gravado:false na resposta.
async function gravarSnapshots(termo: string, geradoEm: string, itens: ItemVendas[]): Promise<boolean> {
  const linhas = linhasSnapshot(termo, geradoEm, itens);
  if (linhas.length === 0) return false;
  try {
    const { error } = await adminClient()
      .from('sonar_snapshots')
      .upsert(linhas, { onConflict: 'termo,item_id,gerado_em', ignoreDuplicates: true });
    if (error) {
      console.error(`[sonar-snapshots] insert falhou para "${termo}": ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[sonar-snapshots] insert lançou para "${termo}":`, e instanceof Error ? e.message : e);
    return false;
  }
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

  // A versão da chave identifica corte E shape (v1=48 anúncios, v2=20, v3=6 — aposentada,
  // v4=20 com raio_x). Bump para v4 e não reuso da v3: a v3 guarda painéis do corte de 6.
  // ADR-0125/D2: `por_anuncio` (T1) entrou como campo ADITIVO no shape v4 — não exige bump.
  // Entrada v4 cacheada ANTES desta entrega simplesmente não tem o índice; a UI mostra "—" até
  // o TTL (≤7d) expirar sozinho. Bump só para mudança incompatível ou de corte (regra daqui pra frente).
  // ADR-0127: itens/category_id aditivos (sem bump); historico_gravado NUNCA entra no objeto cacheado (D7).
  const chave = `sonar:vendas:v4:MLB:${normalizado}`;
  const cacheado = await redisGet(chave).catch(() => null);
  // D7: historico_gravado fica FORA do objeto cacheado — em hit vale false (não gravou AGORA).
  if (cacheado) return json({ ...JSON.parse(cacheado), historico_gravado: false });

  const itens = await buscarAnunciosML(normalizado);
  // null = falha/timeout do run — não cachear (cache global 24h travaria o termo com erro
  // transitório para todo mundo, mesmo racional da pulse-sonar).
  if (itens === null) return json({ erro: 'Consulta de vendas falhou ou demorou demais. Tente de novo em instantes.' }, 502);

  const parseados = parseItensApify(itens);
  const resposta = {
    configurado: true as const,
    ...montarPainelVendas(normalizado, parseados, parseTotalAnuncios(itens)),
  };
  const historicoGravado = await gravarSnapshots(resposta.termo, resposta.gerado_em, parseados);
  await redisSet(chave, JSON.stringify(resposta), CACHE_TTL_S).catch(() => {});
  return json({ ...resposta, historico_gravado: historicoGravado });
});
