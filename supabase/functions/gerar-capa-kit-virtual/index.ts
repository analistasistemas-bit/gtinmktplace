// ADR-0206: capa do Kit Virtual (componentes diferentes) gerada por IA para a prévia da tela Criar Kit Virtual. Só em
// org com o módulo `imagem_ia`. Não publica nem grava no kit: devolve o caminho no storage, e a foto só vai ao anúncio
// se o operador a aprovar na tela ("Usar esta foto") e criar o kit.
// Fotos de origem escolhidas aqui (nunca vindas do cliente): foto 1 de cada `item_id` no ML, com o item da própria org
// (`familias.ml_item_id` ou `anuncios_externos_itens` não retirado), do `user_product_id` pedido e fora de moderação.
// Cada tentativa é uma linha de `kit_variacao_imagens` (`composicao` + `pedido`; `cores`/`rotulo`/`n`/`familia_base_id`
// nulos), idempotente por `request_id`, com a mesma cobrança do kit com variação (status `gerada`).
// Máquina de estados COPIADA de `gerar-capa-kit-unidades/index.ts` (o original não muda: decisão do Diego, spec §6).
// Teto: 6 tentativas por (org, composição) a cada 24 h, atômico na reserva (RPC `kit_capa_virtual_reservar`).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import { adequadaAoML, dimensoesImagem, gerarImagem, resolverModeloImagem } from '../_shared/ai/imagem.ts';
import { limpar, MAX_TENTATIVAS, reprovacao, type Verificacao } from '../_shared/ai/foto-kit-fiel.ts';
import { avaliarComposicao, montarPedidoComposicao, quantidadesNaCapa, verificarComposicao } from '../_shared/ai/foto-kit-virtual.ts';
import { baixarFotoMl, ehUrlFotoMl } from '../gerar-capa-kit-unidades/capa-ml.ts';
import { fotosDeOrigem, mesmoPedido, montarChaveEPedido } from './origem.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ids do ML: só alfanuméricos (o `|` da chave da composição nunca aparece num id; nada estranho na URL do multiget).
const ITEM_ML = /^[A-Z]{3}\d{1,20}$/;
const USER_PRODUCT = /^[A-Za-z0-9]{1,40}$/;
// Mesmos prazos do `gerar-capa-kit-unidades` (edge corta em 150 s sem resposta).
const ABANDONO_MS = 5 * 60_000;
const PRAZO_MS = 140_000;
const RESERVA_FINAL_MS = 10_000;
const LIMITE_RESPOSTA_MS = 145_000;
const MINIMO_IA_MS = 90_000;
const VERIFICACAO_MS = 35_000;
const UPLOAD_VENCIDO_MS = LIMITE_RESPOSTA_MS + 30_000;
// Custo da geração sem `usage` do provedor: ~US$ 0,05 por tentativa (medição do ADR-0205). Só registro de gasto
// (a cobrança é `image_unit_cents`); evita `custo_usd = 0`, que o check recusa (23514).
const CUSTO_GERACAO_ESTIMADO_USD = 0.05;
const centavos = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6)));

// Log de erro externo por lista de permissão (cópia do `gerar-capa-kit-unidades`): nenhum texto do provedor, banco ou storage.
const CODIGOS_LOG = new Set(['23505', '23514', '40001', '57014', 'PGRST116', 'AbortError', 'TimeoutError', 'ETIMEDOUT', 'ECONNRESET']);
const MSG_LOG: Record<string, string> = {
  moderacao: 'moderação ilegível', origem: 'falha ao ler a foto de origem', ia: 'falha da IA', upload: 'falha no upload', registro: 'falha ao registrar',
  auditoria: 'falha na auditoria', prazo: 'prazo esgotado', interno: 'erro interno', verificacao: 'falha na verificação',
};
function logErro(onde: string, e: unknown) {
  const x = (e ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };
  const numero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599 ? v : undefined);
  const status = numero(x.status) ?? numero(x.statusCode);
  const bruto = typeof x.code === 'string' || typeof x.code === 'number' ? String(x.code) : typeof x.name === 'string' ? x.name : '';
  const codigo = CODIGOS_LOG.has(bruto) ? bruto : undefined;
  console.error(JSON.stringify({ fn: 'gerar-capa-kit-virtual', onde, status, codigo, msg: MSG_LOG[onde] ?? 'erro' }));
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

/** Verificação gravada: a do contrato + as fotos de origem (URLs do CDN do ML, na ordem do kit) e a prévia da
 *  reprovada (só internas, nunca na resposta). */
type Registro = Verificacao & { origem_paths?: string[]; previa_path?: string; falha_tecnica?: boolean };
type Componente = { user_product_id: string; item_id: string; quantidade: number; rotulo: string };

/** Componentes válidos (2..6, `user_product_id` únicos, quantidade 1..10) ou `null`. `rotulo` sai limpo (≤ 80). */
function lerComponentes(v: unknown): Componente[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 6) return null;
  const out: Componente[] = [];
  for (const c of v) {
    const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    if (typeof x.user_product_id !== 'string' || !USER_PRODUCT.test(x.user_product_id)) return null;
    if (typeof x.item_id !== 'string' || !ITEM_ML.test(x.item_id)) return null;
    if (typeof x.quantidade !== 'number' || !Number.isInteger(x.quantidade) || x.quantidade < 1 || x.quantidade > 10) return null;
    if (typeof x.rotulo !== 'string') return null;
    out.push({ user_product_id: x.user_product_id, item_id: x.item_id, quantidade: x.quantidade, rotulo: limpar(x.rotulo, 80) });
  }
  return new Set(out.map((c) => c.user_product_id)).size === out.length ? out : null;
}

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

  // Gate da criação do kit (ADR-0060) + módulo pago de imagem.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditar({ type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) {
    return json({ error: 'Geração de foto por IA não habilitada para esta organização.', motivo: 'modulo_desligado' }, 403);
  }

  let body: { request_id?: unknown; componentes?: unknown };
  try {
    const bruto: unknown = await req.json();
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return json({ error: 'Corpo inválido.' }, 400);
    body = bruto as typeof body;
  } catch { return json({ error: 'JSON inválido' }, 400); }
  const requestId = body.request_id;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return json({ error: 'request_id inválido.' }, 400);
  const componentes = lerComponentes(body.componentes);
  if (!componentes) return json({ error: 'Informe de 2 a 6 produtos diferentes, com quantidade de 1 a 10.' }, 400);
  // Pedido e chave do teto saem de um ponto só (origem.ts): a chave deriva dos ids do pedido, sem quantidades.
  const { pedido, composicao } = montarChaveEPedido(componentes);
  // `rotulo` é texto de terceiro (título do anúncio): só em mensagens ao operador, nunca no prompt nem no banco.
  const rotulos = componentes.map((c, i) => c.rotulo || `Produto ${i + 1}`);
  const itemIds = componentes.map((c) => c.item_id);
  const target = { type: 'kit_virtual_capa', id: requestId };

  // Posse: cada item é da org, pelos dois caminhos da busca de componentes (Legacy da família ou item UP não retirado).
  const [fams, itens] = await Promise.all([
    admin.from('familias').select('ml_item_id').eq('org_id', orgId).in('ml_item_id', itemIds),
    admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).eq('retirado', false).in('item_externo_id', itemIds),
  ]);
  if (fams.error || itens.error) return json({ error: 'Falha ao conferir os anúncios dos produtos. Tente novamente.' }, 500);
  const daOrg = new Set<unknown>([
    ...(fams.data ?? []).map((x: { ml_item_id: unknown }) => x.ml_item_id),
    ...(itens.data ?? []).map((x: { item_externo_id: unknown }) => x.item_externo_id),
  ]);
  if (itemIds.some((id) => !daOrg.has(id))) {
    await auditar(target, 'denied');
    return json({ error: 'Produto fora desta empresa. Busque os componentes de novo.', motivo: 'item_fora_da_org' }, 403);
  }

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
  /** Fotos de origem (URLs públicas do CDN do ML), uma por componente, para a prévia ampliada. */
  const originais = (v: Registro | null | undefined) =>
    (v?.origem_paths ?? []).map((u, i) => ({ cor: rotulos[i] ?? `Produto ${i + 1}`, urls: ehUrlFotoMl(u) ? [u] : [] }));
  // Resposta sempre no formato do contrato: nunca o jsonb gravado cru (traz origem_paths/previa_path).
  const publica = (v: Registro | null | undefined) =>
    (v ? { aprovado: v.aprovado === true, itens: [], motivos: v.motivos ?? [] } : null);
  type Linha = { tentativa: number; verificacao?: Registro | null };
  const entregar = async (l: Linha, path: string, custoUsd: number, existente: boolean) => {
    const url = await assinar(path);
    if (!existente) await auditar(target, 'succeeded');
    return json({
      request_id: requestId, tentativa: Number(l.tentativa), aprovado: true, proxima: false, path, url,
      custo_centavos: centavos(custoUsd), verificacao: publica(l.verificacao), originais: originais(l.verificacao),
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
      previa_url: v.previa_path ? await assinar(v.previa_path) : null, originais: originais(v),
      ...(v.falha_tecnica ? { falha_tecnica: true } : {}),
      ...(existente ? { existente: true } : {}),
    });
  };
  const incerto = () => json({ error: 'Não foi possível confirmar a foto. Tente de novo: a mesma foto é recuperada.', motivo: 'estado_incerto' }, 503);
  const falhaStorage = () => json({ error: 'Não foi possível guardar a foto gerada. Gere outra.', motivo: 'falha_storage' }, 502);

  // Repetição do mesmo pedido: responde pelo estado gravado da última tentativa, sem IA.
  const { data: linhas, error: errJa } = await tabela()
    .select('tentativa, status, familia_base_id, cores, rotulo, n, composicao, pedido, storage_path, custo_usd, verificacao, criado_em, atualizado_em')
    .eq('org_id', orgId).eq('request_id', requestId).order('tentativa', { ascending: true });
  if (errJa) return json({ error: 'Falha ao ler a geração. Tente novamente.' }, 500);
  const todas = (linhas ?? []) as Array<Record<string, unknown> & Linha>;
  const ja = todas.at(-1);
  let tentativa = 1;
  if (ja) {
    // Mesmo pedido = mesma composição e mesmas quantidades na mesma ordem, linha de composição (nunca cores/unidades).
    if (ja.familia_base_id != null || ja.cores != null || ja.rotulo != null || ja.n != null
      || ja.composicao !== composicao || !mesmoPedido(ja.pedido, pedido)) {
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
      await auditar(target, 'failed');
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

  // Fotos de origem: foto 1 de cada item no ML, conferindo item ↔ `user_product_id` e a moderação (`origem.ts`).
  let origemUrls: string[];
  try {
    const leitura = await comPrazo((async () => {
      const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
      if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
      const token = await getValidAccessTokenConexao(cx);
      // Até 6 itens: um bloco só do multiget (limite 20).
      const resp = await fetch(`https://api.mercadolibre.com${caminhoMultiget(itemIds, 'id,status,sub_status,pictures,user_product_id')}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) throw Object.assign(new Error('ML /items/bulk'), { status: resp.status });
      const entradas = comoEnvelopeAntigo(await resp.json(), itemIds);
      if (!Array.isArray(entradas)) throw new Error('ML /items/bulk: resposta inesperada');
      return fotosDeOrigem(entradas, componentes.map((c) => ({ userProductId: c.user_product_id, itemId: c.item_id })));
    })(), fatia(30_000, MINIMO_IA_MS));
    if (!leitura.ok) {
      const nome = rotulos[itemIds.indexOf(leitura.itemId)];
      return leitura.motivo === 'item_divergente'
        ? json({ error: `O anúncio de "${nome}" não corresponde ao produto escolhido. Busque o componente de novo.`, motivo: 'item_divergente' }, 409)
        : json({ error: `"${nome}" não tem foto utilizável no Mercado Livre (anúncio moderado, inativo ou sem foto). Envie a foto do kit.`, motivo: 'item_inelegivel' }, 409);
    }
    origemUrls = leitura.urls;
  } catch (e) {
    logErro('moderacao', e);
    return json({ error: 'Não foi possível conferir os anúncios no Mercado Livre. Tente novamente.', motivo: 'foto_moderacao_ilegivel' }, 502);
  }
  // Fotos de origem lidas ANTES da reserva: falha de leitura não consome o teto diário. Só a chamada ao provedor
  // (e a verificação) gasta tentativa.
  const semTempo = () => json({ error: 'Sem tempo para gerar a foto agora. Tente novamente.', motivo: 'prazo' }, 503);
  if (resta() < MINIMO_IA_MS + 1_000) return semTempo();
  let referencias: string[];
  try {
    const blobs = await comPrazo(Promise.all(origemUrls.map((u) => baixarFotoMl(u))), fatia(15_000, MINIMO_IA_MS));
    // Mesma ordem dos componentes: referência i = produto i (prompt e visão).
    referencias = await Promise.all(blobs.map(paraDataUrl));
  } catch (e) {
    logErro('origem', e);
    // Prazo (da fatia ou do download) não é defeito da foto: 503 `prazo`, sem reservar nem tocar o teto.
    const x = e as { name?: unknown; message?: unknown };
    if (x?.name === 'TimeoutError' || x?.message === 'prazo esgotado') return semTempo();
    return json({ error: 'Não foi possível ler a foto de um dos produtos no Mercado Livre. Tente de novo ou envie a foto do kit.', motivo: 'sem_foto_origem' }, 409);
  }

  if (resta() < MINIMO_IA_MS) return semTempo();

  const modelo = await resolverModeloImagem(admin, orgId);
  // Teto diário + reserva na MESMA transação (RPC com lock por org/composição): pedidos paralelos nunca passam juntos
  // das 6 tentativas em 24 h. Toda tentativa conta (pendente, recusada, gerada). 429 antes de qualquer gasto de IA.
  const { data: reserva, error: errReserva } = await admin.rpc('kit_capa_virtual_reservar', {
    p_org_id: orgId, p_request_id: requestId, p_tentativa: tentativa, p_composicao: composicao, p_pedido: pedido,
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

  // Quantidades da capa (Σ ≤ 6: todas; acima, uma de cada) nas três etapas: pedido, visão e veredito.
  const quantidades = quantidadesNaCapa(componentes);
  let gerada: Awaited<ReturnType<typeof gerarImagem>>;
  let custoUsd = 0;
  try {
    const itensPrompt = quantidades.map((quantidade) => ({ rotulo: '', quantidade }));
    gerada = await gerarImagem(modelo, montarPedidoComposicao({ itens: itensPrompt, motivosAnteriores: motivos }).textos, referencias,
      fatia(90_000, VERIFICACAO_MS + RESERVA_FINAL_MS));
    custoUsd += gerada.custoUsd > 0 ? gerada.custoUsd : CUSTO_GERACAO_ESTIMADO_USD;
  } catch (e) {
    // Falha da IA (provedor, timeout): a tentativa fica `recusada` sem custo (fora da cobrança) e CONTA no teto
    // diário; nunca é apagada (timeout recorrente do provedor, que pode cobrar a chamada abortada, não fica sem limite).
    logErro('ia', e);
    await auditar(target, 'failed');
    const registro: Registro = { ...reprovacao('Falha técnica na geração da foto (sem cobrança).'), falha_tecnica: true, origem_paths: origemUrls };
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
      const lida = await verificarComposicao({ originais: referencias, gerada: geradaUrl, quantidades, timeoutMs: fatia(VERIFICACAO_MS, RESERVA_FINAL_MS) });
      custoUsd += lida.custoUsd;
      const r = avaliarComposicao(lida.verificacao, quantidades);
      verificacao = { aprovado: r.aprovado, itens: [], motivos: r.motivos };
    } catch (e) {
      logErro('verificacao', e);
      verificacao = reprovacao('Não foi possível conferir a foto gerada.');
    }
  }
  verificacao.origem_paths = origemUrls;

  if (!verificacao.aprovado) {
    const previa = `${orgId}/kit-virtual-ia/${requestId}-t${tentativa}.${gerada.ext}`;
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
  const path = `${orgId}/kit-virtual-ia/${requestId}.${gerada.ext}`;
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
