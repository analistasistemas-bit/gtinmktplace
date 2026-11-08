// ADR-0197 (Task 15): gera por IA a foto de uma combinação do kit com variação, para a prévia da tela Criar/Gerenciar.
// Só em org com o módulo `imagem_ia`, com o modelo de Configurações (`ai_model_imagem`). Não publica nem grava na
// família: devolve o caminho no storage, e a foto só vai ao anúncio se o operador a aprovar na tela e criar o kit.
// Fotos de origem: escolhidas aqui (nunca vindas do cliente), da própria org e fora de item moderado no ML.
// Cada geração fica em `kit_variacao_imagens`, idempotente por `request_id` (cobrança na Task 16: status `gerada`).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { rotuloCombinacao } from '../_shared/kit-variacao/combinacoes.ts';
import {
  adequadaAoML, descreverPeca, dimensoesImagem, gerarImagem, montarPedidoImagem, resolverModeloImagem,
} from '../_shared/ai/imagem.ts';
import { fotoDaOrg } from '../criar-kit-variacao/processar.ts';
import { fotosEmItemModerado } from '../criar-kit-variacao/fotos-moderadas.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Além do limite de uma execução da edge (150 s sem resposta): reserva `pendente` mais velha que isto foi abandonada.
const ABANDONO_MS = 5 * 60_000;
const centavos = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6)));

async function paraDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = context;
  const admin = adminClient();

  // Mesmo gate da criação do kit (ADR-0060), mais o módulo pago de imagem.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'kit_variacao')) || !(await exigirModulo(admin, orgId, 'imagem_ia'))) {
    return json({ error: 'Geração de foto por IA não habilitada para esta organização.', motivo: 'modulo_desligado' }, 403);
  }

  let body: { request_id?: unknown; familia_base_id?: unknown; cores?: unknown };
  try {
    const bruto: unknown = await req.json();
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return json({ error: 'Corpo inválido.' }, 400);
    body = bruto as typeof body;
  } catch { return json({ error: 'JSON inválido' }, 400); }
  const requestId = body.request_id;
  const familiaBaseId = body.familia_base_id;
  const cores = Array.isArray(body.cores) ? body.cores.map((c) => (typeof c === 'string' ? c.trim() : '')) : null;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return json({ error: 'request_id inválido.' }, 400);
  if (typeof familiaBaseId !== 'string' || !familiaBaseId) return json({ error: 'familia_base_id é obrigatório.' }, 400);
  if (!cores || cores.length < 2 || cores.length > 6 || cores.some((c) => !c) || new Set(cores).size !== cores.length) {
    return json({ error: 'cores deve ter de 2 a 6 cores distintas.' }, 400);
  }
  const rotulo = rotuloCombinacao(cores);
  const target = { type: 'familia', id: familiaBaseId };
  const tabela = () => admin.from('kit_variacao_imagens');

  // Repetição do mesmo pedido: devolve a mesma imagem, sem IA.
  const { data: ja, error: errJa } = await tabela().select('status, rotulo, storage_path, custo_usd, criado_em')
    .eq('org_id', orgId).eq('request_id', requestId).maybeSingle();
  if (errJa) return json({ error: 'Falha ao ler a geração. Tente novamente.' }, 500);
  const limiteAbandono = new Date(Date.now() - ABANDONO_MS).toISOString();
  if (ja?.status === 'pendente' && String(ja.criado_em) < limiteAbandono) {
    // Reserva de uma execução que morreu (passou do tempo máximo da edge): sem imagem entregue, nada a cobrar.
    // O filtro por status e idade não apaga uma execução viva.
    await tabela().delete().eq('org_id', orgId).eq('request_id', requestId).eq('status', 'pendente').lt('criado_em', limiteAbandono);
  } else if (ja) {
    if (ja.rotulo !== rotulo) return json({ error: 'request_id já usado em outra combinação.', motivo: 'pedido_diferente' }, 409);
    if (ja.status === 'pendente') return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    if (ja.status !== 'gerada') return json({ error: 'A foto gerada não serve ao Mercado Livre. Gere outra.', motivo: 'imagem_inadequada' }, 502);
    const { data: assinada } = await admin.storage.from('imagens').createSignedUrl(ja.storage_path as string, 60 * 60 * 2);
    return json({ request_id: requestId, path: ja.storage_path, url: assinada?.signedUrl ?? null, custo_centavos: centavos(Number(ja.custo_usd)), existente: true });
  }

  // Base da própria org; cores só dela (nunca texto livre do cliente no pedido à IA).
  const { data: base, error } = await admin.from('familias').select('variacoes(cor, imagem_path, excluida_da_publicacao)')
    .eq('id', familiaBaseId).eq('org_id', orgId).maybeSingle();
  if (error) return json({ error: 'Falha ao carregar a família base. Tente novamente.' }, 500);
  if (!base) return json({ error: 'Família base não encontrada.' }, 404);
  const variacoes = ((base.variacoes ?? []) as Array<{ cor: string | null; imagem_path: string | null; excluida_da_publicacao?: boolean }>)
    .filter((v) => !v.excluida_da_publicacao);
  if (cores.some((c) => !variacoes.some((v) => String(v.cor ?? '').trim() === c))) return json({ error: 'Cor fora da base.' }, 400);

  // Fotos de origem: da própria org (mesma regra da criação, Task 10) e fora de item moderado no ML.
  const { data: perfis, error: errPerfis } = await admin.from('profiles').select('id').eq('org_id', orgId);
  if (errPerfis) return json({ error: 'Falha ao carregar a empresa. Tente novamente.' }, 500);
  const usuarios = new Set((perfis ?? []).map((p: { id: string }) => p.id));
  const candidatas = new Map(cores.map((c) => [c, [...new Set(variacoes
    .filter((v) => String(v.cor ?? '').trim() === c && v.imagem_path && fotoDaOrg(v.imagem_path, orgId, usuarios))
    .map((v) => v.imagem_path as string))]]));
  let moderadas: Set<string>;
  try {
    const todas = [...new Set([...candidatas.values()].flat())];
    moderadas = new Set(todas.length === 0 ? [] : await fotosEmItemModerado(admin, orgId, async () => {
      const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
      if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
      return await getValidAccessTokenConexao(cx);
    }, todas));
  } catch (e) {
    console.error('gerar-foto-kit: moderação ilegível:', e);
    return json({ error: 'Não foi possível conferir as fotos no Mercado Livre. Tente novamente.', motivo: 'foto_moderacao_ilegivel' }, 502);
  }
  const origem: string[] = [];
  for (const c of cores) {
    const path = candidatas.get(c)!.find((p) => !moderadas.has(p));
    if (!path) return json({ error: `Sem foto utilizável da cor ${c} (nenhuma, de outra empresa ou de anúncio moderado). Envie a foto.`, motivo: 'sem_foto_origem' }, 409);
    origem.push(path);
  }

  // Reserva antes da IA: o mesmo request_id em paralelo não gera duas vezes.
  const modelo = await resolverModeloImagem(admin, orgId);
  const { error: errReserva } = await tabela().insert({
    org_id: orgId, request_id: requestId, status: 'pendente', familia_base_id: familiaBaseId, cores, rotulo, modelo,
    criado_por: userId,
  });
  if (errReserva) {
    if (errReserva.code === '23505') return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500);
  }

  let gerada: Awaited<ReturnType<typeof gerarImagem>>;
  let custoUsd: number;
  try {
    const fotos: string[] = [];
    for (const p of origem) {
      const { data, error: e } = await admin.storage.from('imagens').download(p);
      if (e || !data) throw new Error(`foto de origem ${p}: ${e?.message ?? 'não encontrada'}`);
      fotos.push(await paraDataUrl(data));
    }
    const descricao = await descreverPeca(fotos);
    gerada = await gerarImagem(modelo, montarPedidoImagem({ cores, descricao: descricao.texto }), fotos);
    custoUsd = descricao.custoUsd + gerada.custoUsd;
  } catch (e) {
    // Falha de geração não cobra: some a reserva e o mesmo request_id pode tentar de novo.
    console.error('gerar-foto-kit: IA falhou:', e);
    await tabela().delete().eq('org_id', orgId).eq('request_id', requestId);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Não foi possível gerar a foto. Tente novamente.' }, 502);
  }

  // Gerada com custo real. Imprópria ao ML ou sem storage: registra o custo, fora da cobrança, e não entrega.
  const recusar = async (msg: string, motivo: string) => {
    await tabela().update({ status: 'recusada', custo_usd: custoUsd, atualizado_em: new Date().toISOString() })
      .eq('org_id', orgId).eq('request_id', requestId);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: msg, motivo }, 502);
  };
  if (!adequadaAoML(dimensoesImagem(gerada.bytes))) {
    return await recusar('A foto gerada não serve ao Mercado Livre (precisa ser vertical ou quadrada). Gere outra.', 'imagem_inadequada');
  }
  const path = `${orgId}/kit-variacao-ia/${requestId}.${gerada.ext}`;
  const { error: errUp } = await admin.storage.from('imagens').upload(path, new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }), {
    contentType: gerada.mime, upsert: true,
  });
  if (errUp) {
    console.error('gerar-foto-kit: upload falhou:', errUp);
    return await recusar('Não foi possível guardar a foto gerada. Tente novamente.', 'falha_storage');
  }
  const { error: errFim } = await tabela().update({
    status: 'gerada', storage_path: path, custo_usd: custoUsd, atualizado_em: new Date().toISOString(),
  }).eq('org_id', orgId).eq('request_id', requestId);
  if (errFim) {
    // Sem o registro não há entrega (fail-closed): a imagem não sai sem a cobrança.
    console.error('gerar-foto-kit: registro da geração falhou:', errFim);
    return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500);
  }
  const { data: assinada } = await admin.storage.from('imagens').createSignedUrl(path, 60 * 60 * 2);
  await auditarOperacaoSuporte(admin, context, target, 'succeeded');
  return json({ request_id: requestId, path, url: assinada?.signedUrl ?? null, custo_centavos: centavos(custoUsd) });
});
