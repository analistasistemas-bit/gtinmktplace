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
// Prazo global da execução (a edge corta em 150 s sem resposta). A IA termina até `PRAZO_MS - RESERVA_FINAL_MS`;
// a reserva final é de upload, registro, URL assinada e auditoria. `LIMITE_RESPOSTA_MS` é a resposta garantida no pior
// caso: passou dele, responde 503 `prazo` (o cliente repete o mesmo pedido e recupera a geração, se ela terminar).
// Sem tempo para a IA, recusa antes de reservar: nada é gerado nem cobrado.
const PRAZO_MS = 140_000;
const RESERVA_FINAL_MS = 10_000;
const LIMITE_RESPOSTA_MS = 145_000;
const MINIMO_IA_MS = 90_000;
const centavos = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6)));

// Log de erro externo por lista de permissão: status HTTP numérico, código de uma lista conhecida e mensagem fixa por
// etapa. Nenhum texto do provedor, do banco ou do storage (pode trazer credencial, URL assinada ou payload).
const CODIGOS_LOG = new Set(['23505', '23514', '40001', '57014', 'PGRST116', 'AbortError', 'TimeoutError', 'ETIMEDOUT', 'ECONNRESET']);
const MSG_LOG: Record<string, string> = {
  moderacao: 'moderação ilegível', ia: 'falha da IA', upload: 'falha no upload', registro: 'falha ao registrar',
  auditoria: 'falha na auditoria', prazo: 'prazo esgotado', interno: 'erro interno',
};
function logErro(onde: string, e: unknown) {
  const x = (e ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };
  const numero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599 ? v : undefined);
  const status = numero(x.status) ?? numero(x.statusCode);
  const bruto = typeof x.code === 'string' || typeof x.code === 'number' ? String(x.code) : typeof x.name === 'string' ? x.name : '';
  const codigo = CODIGOS_LOG.has(bruto) ? bruto : undefined;
  console.error(JSON.stringify({ fn: 'gerar-foto-kit', onde, status, codigo, msg: MSG_LOG[onde] ?? 'erro' }));
}

/** Corta `p` em `ms` (a operação de baixo pode seguir, mas o resultado é descartado: fail-closed). */
function comPrazo<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(Object.assign(new Error('prazo esgotado'), { name: 'TimeoutError' })), Math.max(0, ms));
    }),
  ]).finally(() => clearTimeout(t));
}

async function paraDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  try {
    return await comPrazo(atender(req, inicio), inicio + LIMITE_RESPOSTA_MS - Date.now());
  } catch (e) {
    const prazo = (e as { name?: unknown })?.name === 'TimeoutError';
    logErro(prazo ? 'prazo' : 'interno', e);
    return prazo
      ? json({ error: 'A geração passou do tempo. Tente de novo: a foto já gerada é recuperada.', motivo: 'prazo' }, 503)
      : json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
});

async function atender(req: Request, inicio: number): Promise<Response> {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = context;
  const admin = adminClient();
  const fim = inicio + PRAZO_MS;
  /** Tempo de uma operação da fase final, sempre antes do limite de resposta (com 2 s de folga para responder). */
  const fatiaFinal = (max: number) => Math.max(0, Math.min(max, inicio + LIMITE_RESPOSTA_MS - 2_000 - Date.now()));
  const resta = () => fim - Date.now();
  /** Tempo da próxima etapa: até `max`, deixando `reservar` para as seguintes. Sem tempo, lança. */
  const fatia = (max: number, reservar: number) => {
    const ms = Math.min(max, resta() - reservar);
    if (ms < 1_000) throw new Error('prazo esgotado');
    return ms;
  };
  // Auditoria nunca transforma o resultado: depois do registro, a geração já é cobrável e precisa chegar à tela.
  const auditar = async (t: { type: string; id: string }, r: 'denied' | 'failed' | 'succeeded') => {
    try { await comPrazo(auditarOperacaoSuporte(admin, context, t, r), fatiaFinal(3_000)); } catch (e) { logErro('auditoria', e); }
  };

  // Mesmo gate da criação do kit (ADR-0060), mais o módulo pago de imagem.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditar({ type: 'org', id: orgId }, 'denied');
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
  const { data: ja, error: errJa } = await tabela().select('status, rotulo, familia_base_id, cores, storage_path, custo_usd, criado_em')
    .eq('org_id', orgId).eq('request_id', requestId).maybeSingle();
  if (errJa) return json({ error: 'Falha ao ler a geração. Tente novamente.' }, 500);
  const limiteAbandono = new Date(Date.now() - ABANDONO_MS).toISOString();
  if (ja?.status === 'pendente' && String(ja.criado_em) < limiteAbandono) {
    // Reserva de uma execução que morreu (passou do tempo máximo da edge): sem imagem entregue, nada a cobrar.
    // O filtro por status e idade não apaga uma execução viva.
    await tabela().delete().eq('org_id', orgId).eq('request_id', requestId).eq('status', 'pendente').lt('criado_em', limiteAbandono);
  } else if (ja) {
    // Mesmo pedido = mesma base e as mesmas cores na mesma ordem; senão nunca devolve a foto de outro produto.
    if (ja.familia_base_id !== familiaBaseId || JSON.stringify(ja.cores) !== JSON.stringify(cores) || ja.rotulo !== rotulo) return json({ error: 'request_id já usado em outra combinação.', motivo: 'pedido_diferente' }, 409);
    if (ja.status === 'pendente') return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    if (ja.status === 'pendente_upload') {
      // Upload que estourou o prazo: a imagem já foi gerada (e paga ao provedor). Nunca gera de novo: confere o objeto
      // no caminho determinístico. Existe → `gerada` (cobrável). Não existe → `recusada` (a plataforma absorve).
      const caminho = String(ja.storage_path);
      const corte = caminho.lastIndexOf('/');
      const nome = caminho.slice(corte + 1);
      const { data: lista, error: errLista } = await admin.storage.from('imagens').list(caminho.slice(0, corte), { search: nome });
      if (errLista) { logErro('upload', errLista); return json({ error: 'Falha ao conferir a foto gerada. Tente novamente.' }, 500); }
      const existe = (lista ?? []).some((o: { name: string }) => o.name === nome);
      const { error: errFin } = await tabela().update({ status: existe ? 'gerada' : 'recusada', atualizado_em: new Date().toISOString() })
        .eq('org_id', orgId).eq('request_id', requestId).eq('status', 'pendente_upload');
      if (errFin) { logErro('registro', errFin); return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500); }
      if (!existe) return json({ error: 'Não foi possível guardar a foto gerada. Gere outra.', motivo: 'falha_storage' }, 502);
    } else if (ja.status !== 'gerada') {
      return json({ error: 'A foto gerada não serve ao Mercado Livre. Gere outra.', motivo: 'imagem_inadequada' }, 502);
    }
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
    const ms = fatia(30_000, MINIMO_IA_MS);
    moderadas = new Set(todas.length === 0 ? [] : await comPrazo(fotosEmItemModerado(admin, orgId, async () => {
      const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
      if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
      return await getValidAccessTokenConexao(cx);
    }, todas), ms));
  } catch (e) {
    logErro('moderacao', e);
    return json({ error: 'Não foi possível conferir as fotos no Mercado Livre. Tente novamente.', motivo: 'foto_moderacao_ilegivel' }, 502);
  }
  const origem: string[] = [];
  for (const c of cores) {
    const path = candidatas.get(c)!.find((p) => !moderadas.has(p));
    if (!path) return json({ error: `Sem foto utilizável da cor ${c} (nenhuma, de outra empresa ou de anúncio moderado). Envie a foto.`, motivo: 'sem_foto_origem' }, 409);
    origem.push(path);
  }

  if (resta() < MINIMO_IA_MS) {
    return json({ error: 'Sem tempo para gerar a foto agora. Tente novamente.', motivo: 'prazo' }, 503);
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
      const { data, error: e } = await comPrazo(admin.storage.from('imagens').download(p), fatia(15_000, 70_000));
      if (e || !data) throw new Error(`foto de origem ${p}: ${e?.message ?? 'não encontrada'}`);
      fotos.push(await paraDataUrl(data));
    }
    const descricao = await descreverPeca(fotos, fatia(25_000, 60_000));
    gerada = await gerarImagem(modelo, montarPedidoImagem({ cores, descricao: descricao.texto }), fotos, fatia(100_000, RESERVA_FINAL_MS));
    custoUsd = descricao.custoUsd + gerada.custoUsd;
  } catch (e) {
    // Falha de geração não cobra: some a reserva e o mesmo request_id pode tentar de novo.
    logErro('ia', e);
    await tabela().delete().eq('org_id', orgId).eq('request_id', requestId);
    await auditar(target, 'failed');
    return json({ error: 'Não foi possível gerar a foto. Tente novamente.' }, 502);
  }

  // Gerada com custo real. Imprópria ao ML ou sem storage: registra o custo, fora da cobrança, e não entrega.
  const recusar = async (msg: string, motivo: string) => {
    try {
      await comPrazo(tabela().update({ status: 'recusada', custo_usd: custoUsd, atualizado_em: new Date().toISOString() })
        .eq('org_id', orgId).eq('request_id', requestId), fatiaFinal(4_000));
    } catch (e) { logErro('registro', e); }
    await auditar(target, 'failed');
    return json({ error: msg, motivo }, 502);
  };
  if (!adequadaAoML(dimensoesImagem(gerada.bytes))) {
    return await recusar('A foto gerada não serve ao Mercado Livre (precisa ser vertical ou quadrada). Gere outra.', 'imagem_inadequada');
  }
  // Caminho determinístico por (org, request_id), gravado com o custo ANTES do upload (`pendente_upload`, não cobrável):
  // se o upload estourar o prazo e terminar depois, a repetição do mesmo pedido acha o objeto e finaliza.
  const path = `${orgId}/kit-variacao-ia/${requestId}.${gerada.ext}`;
  const { error: errPre } = await comPrazo(tabela().update({
    status: 'pendente_upload', storage_path: path, custo_usd: custoUsd, atualizado_em: new Date().toISOString(),
  }).eq('org_id', orgId).eq('request_id', requestId), fatiaFinal(4_000));
  if (errPre) { logErro('registro', errPre); return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500); }
  let errUp: unknown = null;
  try {
    ({ error: errUp } = await comPrazo(admin.storage.from('imagens').upload(path, new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }), {
      contentType: gerada.mime, upsert: true,
    }), fatiaFinal(6_000)));
  } catch (e) {
    // Sem resposta no prazo: o upload pode terminar depois. Fica `pendente_upload`; o cliente repete o mesmo pedido.
    logErro('upload', e);
    await auditar(target, 'failed');
    return json({ error: 'A foto está sendo guardada. Tente de novo em instantes: a mesma foto é recuperada.', motivo: 'prazo' }, 503);
  }
  if (errUp) {
    logErro('upload', errUp);
    return await recusar('Não foi possível guardar a foto gerada. Tente novamente.', 'falha_storage');
  }
  // Prazo aqui rejeita e vira 503 `prazo` no topo: o cliente repete o mesmo pedido e recupera a geração, se gravou.
  const { error: errFim } = await comPrazo(tabela().update({ status: 'gerada', atualizado_em: new Date().toISOString() })
    .eq('org_id', orgId).eq('request_id', requestId), fatiaFinal(4_000));
  if (errFim) {
    // Sem o registro não há entrega (fail-closed): a imagem não sai sem a cobrança.
    logErro('registro', errFim);
    return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500);
  }
  let url: string | null = null;
  try {
    url = (await comPrazo(admin.storage.from('imagens').createSignedUrl(path, 60 * 60 * 2), fatiaFinal(3_000))).data?.signedUrl ?? null;
  } catch { /* sem URL: a tela pede "Recarregar prévia" com o mesmo pedido */ }
  await auditar(target, 'succeeded');
  return json({ request_id: requestId, path, url, custo_centavos: centavos(custoUsd) });
}
