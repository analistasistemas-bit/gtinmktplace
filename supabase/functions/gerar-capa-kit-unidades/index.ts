// ADR-0205: capa do kit vinculado com N unidades idênticas do produto da base, gerada por IA para a prévia da tela
// Criar kit. Só em org com o módulo `imagem_ia`. Não publica nem grava na família: devolve o caminho no storage, e a
// foto só vai ao anúncio se o operador a aprovar na tela ("Usar esta foto") e criar o kit.
// Foto de origem escolhida aqui (nunca vinda do cliente): capa da base ou, sem ela, a foto da única variação; da
// própria org e fora de item moderado no ML. Cada tentativa é uma linha de `kit_variacao_imagens` (`cores`/`rotulo`
// nulos, `n` preenchido), idempotente por `request_id`, com a mesma cobrança do kit com variação (status `gerada`).
// Máquina de estados COPIADA de `gerar-foto-kit/index.ts` (closures sobre org/pedido/início; o original não muda).
// Teto (decisão do Diego, 12/11): 6 tentativas por (org, base, n) a cada 24 h, atômico na reserva (RPC).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { adequadaAoML, dimensoesImagem, gerarImagem, resolverModeloImagem } from '../_shared/ai/imagem.ts';
import { MAX_TENTATIVAS, reprovacao, type Verificacao } from '../_shared/ai/foto-kit-fiel.ts';
import { avaliarUnidades, montarPedidoUnidades, verificarUnidades } from '../_shared/ai/foto-kit-unidades.ts';
import { fotoDaOrg } from '../criar-kit-variacao/processar.ts';
import { fotosEmItemModerado } from '../criar-kit-variacao/fotos-moderadas.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mesmos prazos do `gerar-foto-kit` (edge corta em 150 s sem resposta). Sem ficha: só geração e verificação.
const ABANDONO_MS = 5 * 60_000;
const PRAZO_MS = 140_000;
const RESERVA_FINAL_MS = 10_000;
const LIMITE_RESPOSTA_MS = 145_000;
const MINIMO_IA_MS = 90_000;
const VERIFICACAO_MS = 35_000;
const UPLOAD_VENCIDO_MS = LIMITE_RESPOSTA_MS + 30_000;
// Custo da geração sem `usage` do provedor (nem estimativa por PRECOS): medição de ~US$ 0,05 por tentativa (ADR-0205).
// Só registro de gasto (a cobrança é `image_unit_cents`); evita `custo_usd = 0`, que o check recusa (23514).
const CUSTO_GERACAO_ESTIMADO_USD = 0.05;
const centavos = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6)));

// Log de erro externo por lista de permissão (cópia do `gerar-foto-kit`): nenhum texto do provedor, banco ou storage.
const CODIGOS_LOG = new Set(['23505', '23514', '40001', '57014', 'PGRST116', 'AbortError', 'TimeoutError', 'ETIMEDOUT', 'ECONNRESET']);
const MSG_LOG: Record<string, string> = {
  moderacao: 'moderação ilegível', ia: 'falha da IA', upload: 'falha no upload', registro: 'falha ao registrar',
  auditoria: 'falha na auditoria', prazo: 'prazo esgotado', interno: 'erro interno', verificacao: 'falha na verificação',
};
function logErro(onde: string, e: unknown) {
  const x = (e ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };
  const numero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599 ? v : undefined);
  const status = numero(x.status) ?? numero(x.statusCode);
  const bruto = typeof x.code === 'string' || typeof x.code === 'number' ? String(x.code) : typeof x.name === 'string' ? x.name : '';
  const codigo = CODIGOS_LOG.has(bruto) ? bruto : undefined;
  console.error(JSON.stringify({ fn: 'gerar-capa-kit-unidades', onde, status, codigo, msg: MSG_LOG[onde] ?? 'erro' }));
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

/** Verificação gravada: a do contrato + a foto de origem e a prévia da reprovada (só internas, nunca na resposta). */
type Registro = Verificacao & { origem_path?: string; previa_path?: string; falha_tecnica?: boolean };

async function atender(req: Request, inicio: number): Promise<Response> {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = context;
  const admin = adminClient();
  const fim = inicio + PRAZO_MS;
  const fatiaFinal = (max: number) => Math.max(0, Math.min(max, inicio + LIMITE_RESPOSTA_MS - 2_000 - Date.now()));
  const resta = () => fim - Date.now();
  const fatia = (max: number, reservar: number) => {
    const ms = Math.min(max, resta() - reservar);
    if (ms < 1_000) throw new Error('prazo esgotado');
    return ms;
  };
  const auditar = async (t: { type: string; id: string }, r: 'denied' | 'failed' | 'succeeded') => {
    try { await comPrazo(auditarOperacaoSuporte(admin, context, t, r), fatiaFinal(3_000)); } catch (e) { logErro('auditoria', e); }
  };

  // Gate da criação do kit (ADR-0060) + módulo pago de imagem. Sem `kit_variacao` (ADR-0205 §2).
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditar({ type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) {
    return json({ error: 'Geração de foto por IA não habilitada para esta organização.', motivo: 'modulo_desligado' }, 403);
  }

  let body: { request_id?: unknown; familia_base_id?: unknown; n?: unknown };
  try {
    const bruto: unknown = await req.json();
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return json({ error: 'Corpo inválido.' }, 400);
    body = bruto as typeof body;
  } catch { return json({ error: 'JSON inválido' }, 400); }
  const requestId = body.request_id;
  const familiaBaseId = body.familia_base_id;
  const n = body.n;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return json({ error: 'request_id inválido.' }, 400);
  if (typeof familiaBaseId !== 'string' || !UUID.test(familiaBaseId)) return json({ error: 'familia_base_id inválido.' }, 400);
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 2 || n > 6) return json({ error: 'n deve ser de 2 a 6.' }, 400);
  const target = { type: 'familia', id: familiaBaseId };
  const tabela = () => admin.from('kit_variacao_imagens');
  const transicionar = async (t: number, de: string, campos: Record<string, unknown>): Promise<string | null> => {
    const { data, error: e1 } = await comPrazo(tabela().update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq('org_id', orgId).eq('request_id', requestId).eq('tentativa', t).eq('status', de).select('status'), fatiaFinal(4_000));
    if (e1) throw e1;
    if (data && data.length > 0) return String(campos.status);
    const { data: agora, error: e2 } = await comPrazo(tabela().select('status')
      .eq('org_id', orgId).eq('request_id', requestId).eq('tentativa', t).maybeSingle(), fatiaFinal(3_000));
    if (e2) throw e2;
    return (agora?.status as string | undefined) ?? null;
  };
  const assinar = async (path: string) => {
    try {
      return (await comPrazo(admin.storage.from('imagens').createSignedUrl(path, 60 * 60 * 2), fatiaFinal(3_000))).data?.signedUrl ?? null;
    } catch { return null; }
  };
  /** Foto de origem com URL assinada, para a prévia ampliada. Falha → lista vazia. */
  const originais = async (v: Registro | null | undefined) => {
    const url = v?.origem_path ? await assinar(v.origem_path) : null;
    return [{ cor: 'Base', urls: url ? [url] : [] }];
  };
  // Resposta sempre no formato do contrato: nunca o jsonb gravado cru (traz origem_path/previa_path).
  const publica = (v: Registro | null | undefined) =>
    (v ? { aprovado: v.aprovado === true, itens: [], motivos: v.motivos ?? [] } : null);
  type Linha = { tentativa: number; verificacao?: Registro | null };
  const entregar = async (l: Linha, path: string, custoUsd: number, existente: boolean) => {
    const url = await assinar(path);
    if (!existente) await auditar(target, 'succeeded');
    return json({
      request_id: requestId, tentativa: Number(l.tentativa), aprovado: true, proxima: false, path, url,
      custo_centavos: centavos(custoUsd), verificacao: publica(l.verificacao), originais: await originais(l.verificacao),
      ...(existente ? { existente: true } : {}),
    });
  };
  const responderReprovada = async (l: Linha, existente: boolean) => {
    const v = l.verificacao!;
    const t = Number(l.tentativa);
    return json({
      // Falha técnica nunca pede a próxima sozinha (provedor fora do ar queimaria as 3 num clique); repetir é manual.
      request_id: requestId, tentativa: t, aprovado: false, proxima: t < MAX_TENTATIVAS && !v.falha_tecnica,
      verificacao: publica(v), motivos: v.motivos ?? [],
      previa_url: v.previa_path ? await assinar(v.previa_path) : null, originais: await originais(v),
      ...(existente ? { existente: true } : {}),
    });
  };
  const incerto = () => json({ error: 'Não foi possível confirmar a foto. Tente de novo: a mesma foto é recuperada.', motivo: 'estado_incerto' }, 503);
  const falhaStorage = () => json({ error: 'Não foi possível guardar a foto gerada. Gere outra.', motivo: 'falha_storage' }, 502);

  // Repetição do mesmo pedido: responde pelo estado gravado da última tentativa, sem IA.
  const { data: linhas, error: errJa } = await tabela()
    .select('tentativa, status, familia_base_id, cores, rotulo, n, storage_path, custo_usd, verificacao, criado_em, atualizado_em')
    .eq('org_id', orgId).eq('request_id', requestId).order('tentativa', { ascending: true });
  if (errJa) return json({ error: 'Falha ao ler a geração. Tente novamente.' }, 500);
  const todas = (linhas ?? []) as Array<Record<string, unknown> & Linha>;
  const ja = todas.at(-1);
  let tentativa = 1;
  if (ja) {
    // Mesmo pedido = mesma base e mesmo n, linha de unidades (nunca a foto de uma combinação de cores).
    if (ja.familia_base_id !== familiaBaseId || ja.cores != null || ja.rotulo != null || Number(ja.n) !== n) {
      return json({ error: 'request_id já usado em outro pedido.', motivo: 'pedido_diferente' }, 409);
    }
    const t = Number(ja.tentativa);
    const limiteAbandono = new Date(Date.now() - ABANDONO_MS).toISOString();
    if (ja.status === 'pendente' && String(ja.criado_em) < limiteAbandono) {
      // Execução que morreu (passou do limite da edge): fica `recusada` sem custo (fora da cobrança), consome a
      // tentativa e segue contando no teto diário (nunca apagada: o provedor pode ter cobrado a chamada abortada).
      const registro: Registro = { ...reprovacao('Geração interrompida antes de terminar (sem cobrança).'), falha_tecnica: true };
      let final: string | null;
      try { final = await transicionar(t, 'pendente', { status: 'recusada', custo_usd: null, verificacao: registro }); }
      catch (e) { logErro('registro', e); return incerto(); }
      if (final !== 'recusada') return incerto();
      if (t >= MAX_TENTATIVAS) return await responderReprovada({ tentativa: t, verificacao: registro }, true);
      tentativa = t + 1;
    } else if (ja.status === 'pendente') {
      return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    } else if (ja.status === 'pendente_upload') {
      const caminho = String(ja.storage_path);
      const corte = caminho.lastIndexOf('/');
      const nome = caminho.slice(corte + 1);
      let lista: Array<{ name: string }> | null = null;
      try {
        const r = await comPrazo(admin.storage.from('imagens').list(caminho.slice(0, corte), { search: nome }), fatiaFinal(3_000));
        if (r.error) throw r.error;
        lista = r.data;
      } catch (e) { logErro('upload', e); return json({ error: 'Falha ao conferir a foto gerada. Tente novamente.' }, 500); }
      const existe = (lista ?? []).some((o: { name: string }) => o.name === nome);
      const limiteUpload = new Date(Date.now() - UPLOAD_VENCIDO_MS).toISOString();
      if (!existe && String(ja.atualizado_em ?? ja.criado_em) >= limiteUpload) {
        return json({ error: 'A foto ainda está sendo guardada. Tente de novo em instantes.', motivo: 'em_andamento' }, 503);
      }
      let final: string | null;
      try { final = await transicionar(t, 'pendente_upload', { status: existe ? 'gerada' : 'recusada' }); }
      catch (e) { logErro('registro', e); return incerto(); }
      if (final === 'recusada') return falhaStorage();
      if (final !== 'gerada') return incerto();
      return await entregar(ja, caminho, Number(ja.custo_usd), true);
    } else if (ja.status === 'gerada') {
      return await entregar(ja, String(ja.storage_path), Number(ja.custo_usd), true);
    } else {
      const v = ja.verificacao;
      if (v?.aprovado !== false) {
        return v?.aprovado === true
          ? falhaStorage()
          : json({ error: 'A foto gerada não serve ao Mercado Livre. Gere outra.', motivo: 'imagem_inadequada' }, 502);
      }
      if (t >= MAX_TENTATIVAS) return await responderReprovada(ja, true);
      tentativa = t + 1;
    }
  }
  // Motivos a corrigir: só da última reprovada pela verificação (falha técnica não é defeito da imagem).
  const anterior = [...todas].reverse().find((l) => l.status === 'recusada' && l.verificacao?.aprovado === false
    && !l.verificacao?.falha_tecnica && Number(l.tentativa) < tentativa);
  const motivos = anterior?.verificacao?.motivos ?? [];

  // Foto de origem: capa da base ou, sem ela, a da única variação (como o front); da própria org e fora de moderado.
  const { data: base, error } = await admin.from('familias').select('capa_storage_path, variacoes(imagem_path)')
    .eq('id', familiaBaseId).eq('org_id', orgId).maybeSingle();
  if (error) return json({ error: 'Falha ao carregar a família base. Tente novamente.' }, 500);
  if (!base) return json({ error: 'Família base não encontrada.' }, 404);
  const variacoes = (base.variacoes ?? []) as Array<{ imagem_path: string | null }>;
  const candidata = (base.capa_storage_path as string | null)
    || (variacoes.length === 1 ? variacoes[0].imagem_path : null) || null;
  const semFoto = () => json({ error: 'Sem foto utilizável da base (nenhuma, de outra empresa ou de anúncio moderado). Envie a foto.', motivo: 'sem_foto_origem' }, 409);
  if (!candidata) return semFoto();
  const { data: perfis, error: errPerfis } = await admin.from('profiles').select('id').eq('org_id', orgId);
  if (errPerfis) return json({ error: 'Falha ao carregar a empresa. Tente novamente.' }, 500);
  if (!fotoDaOrg(candidata, orgId, new Set((perfis ?? []).map((p: { id: string }) => p.id)))) return semFoto();
  try {
    const ms = fatia(30_000, MINIMO_IA_MS);
    const moderadas = await comPrazo(fotosEmItemModerado(admin, orgId, async () => {
      const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
      if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
      return await getValidAccessTokenConexao(cx);
    }, [candidata]), ms);
    if (moderadas.includes(candidata)) return semFoto();
  } catch (e) {
    logErro('moderacao', e);
    return json({ error: 'Não foi possível conferir as fotos no Mercado Livre. Tente novamente.', motivo: 'foto_moderacao_ilegivel' }, 502);
  }
  const origemPath = candidata;

  if (resta() < MINIMO_IA_MS) {
    return json({ error: 'Sem tempo para gerar a foto agora. Tente novamente.', motivo: 'prazo' }, 503);
  }

  const modelo = await resolverModeloImagem(admin, orgId);
  // Teto diário + reserva na MESMA transação (RPC com lock por org/base/n): pedidos paralelos nunca passam juntos
  // das 6 tentativas em 24 h. Toda tentativa conta (pendente, recusada, gerada). 429 antes de qualquer gasto de IA.
  const { data: reserva, error: errReserva } = await admin.rpc('kit_capa_unidades_reservar', {
    p_org_id: orgId, p_request_id: requestId, p_tentativa: tentativa, p_familia_base_id: familiaBaseId, p_n: n,
    p_modelo: modelo, p_criado_por: userId,
  });
  if (errReserva) {
    if (errReserva.code === '23505') return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    logErro('registro', errReserva);
    return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500);
  }
  if (reserva === 'teto') {
    return json({ error: 'Limite diário de gerações deste kit atingido. Envie a foto manualmente.', motivo: 'teto_diario' }, 429);
  }
  if (reserva !== 'ok') return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500);

  let gerada: Awaited<ReturnType<typeof gerarImagem>>;
  let original: string;
  let custoUsd = 0;
  try {
    const blob = await comPrazo((async () => {
      const { data, error: e } = await admin.storage.from('imagens').download(origemPath);
      if (e || !data) throw new Error('foto de origem não encontrada');
      return data as Blob;
    })(), fatia(15_000, 70_000));
    original = await paraDataUrl(blob);
    gerada = await gerarImagem(modelo, montarPedidoUnidades({ n, motivosAnteriores: motivos }).textos, [original],
      fatia(90_000, VERIFICACAO_MS + RESERVA_FINAL_MS));
    custoUsd += gerada.custoUsd > 0 ? gerada.custoUsd : CUSTO_GERACAO_ESTIMADO_USD;
  } catch (e) {
    // Falha da IA (ou da leitura da origem): a tentativa fica `recusada` sem custo (fora da cobrança) e CONTA no teto
    // diário; nunca é apagada (timeout recorrente do provedor, que pode cobrar a chamada abortada, não fica sem limite).
    logErro('ia', e);
    await auditar(target, 'failed');
    const registro: Registro = { ...reprovacao('Falha técnica na geração da foto (sem cobrança).'), falha_tecnica: true, origem_path: origemPath };
    let final: string | null;
    try { final = await transicionar(tentativa, 'pendente', { status: 'recusada', custo_usd: null, verificacao: registro }); }
    catch (e2) { logErro('registro', e2); return incerto(); }
    if (final !== 'recusada') return incerto();
    return await responderReprovada({ tentativa, verificacao: registro }, false);
  }

  // Imprópria ao ML reprova sem chamar a visão; erro ou resposta ilegível reprova (fail-closed).
  let verificacao: Registro;
  if (!adequadaAoML(dimensoesImagem(gerada.bytes))) {
    verificacao = reprovacao('Enquadramento: a foto saiu horizontal ou pequena; precisa ser quadrada ou vertical, com pelo menos 500 px.');
  } else {
    try {
      const geradaUrl = await paraDataUrl(new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }));
      const lida = await verificarUnidades({ original, gerada: geradaUrl, n, timeoutMs: fatia(VERIFICACAO_MS, RESERVA_FINAL_MS) });
      custoUsd += lida.custoUsd;
      const r = avaliarUnidades(lida.verificacao, n);
      verificacao = { aprovado: r.aprovado, itens: [], motivos: r.motivos };
    } catch (e) {
      logErro('verificacao', e);
      verificacao = reprovacao('Não foi possível conferir a foto gerada.');
    }
  }
  verificacao.origem_path = origemPath;

  if (!verificacao.aprovado) {
    const previa = `${orgId}/kit-variacao-ia/${requestId}-t${tentativa}.${gerada.ext}`;
    let previaOk = false;
    try {
      const { error: e } = await comPrazo(admin.storage.from('imagens').upload(previa, new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }), {
        contentType: gerada.mime, upsert: true,
      }), fatiaFinal(5_000));
      previaOk = !e;
    } catch (e) { logErro('upload', e); }
    const registro: Registro = { ...verificacao, ...(previaOk ? { previa_path: previa } : {}) };
    let final: string | null;
    try { final = await transicionar(tentativa, 'pendente', { status: 'recusada', custo_usd: custoUsd, verificacao: registro }); }
    catch (e) { logErro('registro', e); return incerto(); }
    await auditar(target, 'failed');
    if (final !== 'recusada') return incerto();
    return await responderReprovada({ tentativa, verificacao: registro }, false);
  }

  const linha: Linha = { tentativa, verificacao };
  const path = `${orgId}/kit-variacao-ia/${requestId}.${gerada.ext}`;
  const recusar = async (de: string, msg: string, motivo: string) => {
    let final: string | null;
    try { final = await transicionar(tentativa, de, { status: 'recusada', custo_usd: custoUsd }); }
    catch (e) { logErro('registro', e); await auditar(target, 'failed'); return incerto(); }
    if (final === 'gerada') return await entregar(linha, path, custoUsd, false);
    await auditar(target, 'failed');
    if (final !== 'recusada') return incerto();
    return json({ error: msg, motivo }, 502);
  };
  let pre: string | null;
  try { pre = await transicionar(tentativa, 'pendente', { status: 'pendente_upload', storage_path: path, custo_usd: custoUsd, verificacao }); }
  catch (e) { logErro('registro', e); return incerto(); }
  if (pre !== 'pendente_upload') return incerto();
  let errUp: unknown = null;
  try {
    ({ error: errUp } = await comPrazo(admin.storage.from('imagens').upload(path, new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }), {
      contentType: gerada.mime, upsert: true,
    }), fatiaFinal(6_000)));
  } catch (e) {
    logErro('upload', e);
    await auditar(target, 'failed');
    return json({ error: 'A foto está sendo guardada. Tente de novo em instantes: a mesma foto é recuperada.', motivo: 'prazo' }, 503);
  }
  if (errUp) {
    logErro('upload', errUp);
    return await recusar('pendente_upload', 'Não foi possível guardar a foto gerada. Gere outra.', 'falha_storage');
  }
  let final: string | null;
  try { final = await transicionar(tentativa, 'pendente_upload', { status: 'gerada' }); }
  catch (e) { logErro('registro', e); return incerto(); }
  if (final === 'gerada') return await entregar(linha, path, custoUsd, false);
  if (final === 'recusada') { await auditar(target, 'failed'); return falhaStorage(); }
  return incerto();
}
