// ADR-0200 (Task 15): gera por IA a foto de uma combinação do kit com variação, para a prévia da tela Criar/Gerenciar.
// Só em org com o módulo `imagem_ia`, com o modelo de Configurações (`ai_model_imagem`). Não publica nem grava na
// família: devolve o caminho no storage, e a foto só vai ao anúncio se o operador a aprovar na tela e criar o kit.
// Fotos de origem: escolhidas aqui (nunca vindas do cliente), da própria org e fora de item moderado no ML.
// Cada geração fica em `kit_variacao_imagens`, idempotente por `request_id` (cobrança na Task 16: status `gerada`).
// Adendo 1 do ADR-0200: ficha estruturada por visão → geração ancorada → verificação por visão item a item. Uma
// tentativa por chamada (prazo de 145 s); até 3 por request_id, cada uma numa linha (`tentativa`). Reprovada fica
// `recusada` com custo e motivos, sem cobrança; a tela repete o mesmo request_id enquanto vier `proxima: true`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { rotuloCombinacao } from '../_shared/kit-variacao/combinacoes.ts';
import { adequadaAoML, dimensoesImagem, gerarImagem, resolverModeloImagem } from '../_shared/ai/imagem.ts';
import {
  avaliar, extrairFicha, type Ficha, type FotosDaCor, lerVerificacao, MAX_TENTATIVAS, montarPedidoFiel, reprovacao,
  type Verificacao,
} from '../_shared/ai/foto-kit-fiel.ts';
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
// Fatias da IA dentro do prazo: ficha (só na 1ª tentativa) e verificação; a geração fica com o resto.
const FICHA_MS = 25_000;
const VERIFICACAO_MS = 25_000;
// Fotos de origem por cor e no total (tamanho do pedido e CPU da edge).
const MAX_FOTOS_COR = 3;
const MAX_FOTOS = 12;
// `pendente_upload` sem objeto só vira `recusada` depois que a execução original não pode mais gravar (limite + margem).
const UPLOAD_VENCIDO_MS = LIMITE_RESPOSTA_MS + 30_000;
const centavos = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6)));

// Log de erro externo por lista de permissão: status HTTP numérico, código de uma lista conhecida e mensagem fixa por
// etapa. Nenhum texto do provedor, do banco ou do storage (pode trazer credencial, URL assinada ou payload).
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
  /**
   * Transição de estado condicional (`status = de`): devolve o estado que ficou gravado. Zero linhas afetadas = outra
   * execução decidiu antes; relê e devolve o estado dela. Toda transição terminal passa por aqui (nunca sobrescreve
   * uma decisão já gravada). Erro de escrita/leitura lança.
   */
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
    } catch { return null; }   // sem URL: a tela pede "Recarregar prévia" com o mesmo pedido
  };
  /** Fotos originais de cada cor (as da ficha) com URL assinada, para a prévia ampliada. Falha → lista vazia. */
  const originais = async (ficha: Ficha | null | undefined) => {
    const cs = Array.isArray(ficha?.cores) ? ficha!.cores : [];
    const paths = cs.flatMap((c) => c.fotos ?? []);
    let urls = new Map<string, string>();
    if (paths.length > 0) {
      try {
        const { data } = await comPrazo(admin.storage.from('imagens').createSignedUrls(paths, 60 * 60 * 2), fatiaFinal(3_000));
        urls = new Map((data ?? []).flatMap((d: { path: string | null; signedUrl: string | null }) =>
          (d.path && d.signedUrl ? [[d.path, d.signedUrl] as [string, string]] : [])));
      } catch { /* sem originais na prévia ampliada */ }
    }
    return cs.map((c) => ({ cor: c.cor, urls: (c.fotos ?? []).map((p) => urls.get(p)).filter((u): u is string => !!u) }));
  };
  type Linha = { tentativa: number; ficha?: Ficha | null; verificacao?: (Verificacao & { previa_path?: string }) | null };
  const entregar = async (l: Linha, path: string, custoUsd: number, existente: boolean) => {
    const url = await assinar(path);
    if (!existente) await auditar(target, 'succeeded');
    return json({
      request_id: requestId, tentativa: Number(l.tentativa), aprovado: true, proxima: false, path, url,
      custo_centavos: centavos(custoUsd), verificacao: l.verificacao ?? null, originais: await originais(l.ficha),
      ...(existente ? { existente: true } : {}),
    });
  };
  /** Tentativa reprovada pela verificação: nunca traz `path` (a tela não oferece "Usar esta foto"). */
  const responderReprovada = async (l: Linha, existente: boolean) => {
    const v = l.verificacao!;
    const t = Number(l.tentativa);
    return json({
      request_id: requestId, tentativa: t, aprovado: false, proxima: t < MAX_TENTATIVAS,
      verificacao: { aprovado: false, itens: v.itens ?? [], motivos: v.motivos ?? [] }, motivos: v.motivos ?? [],
      previa_url: v.previa_path ? await assinar(v.previa_path) : null, originais: await originais(l.ficha),
      ...(existente ? { existente: true } : {}),
    });
  };
  // Estado não confirmado (erro ao gravar ou reler): resposta INCERTA. A tela mantém o mesmo request_id e a repetição
  // responde pelo estado gravado. Resposta definitiva só com `recusada` lida ou gravada com confirmação.
  const incerto = () => json({ error: 'Não foi possível confirmar a foto. Tente de novo: a mesma foto é recuperada.', motivo: 'estado_incerto' }, 503);
  const falhaStorage = () => json({ error: 'Não foi possível guardar a foto gerada. Gere outra.', motivo: 'falha_storage' }, 502);

  // Repetição do mesmo pedido: responde pelo estado gravado da última tentativa, sem IA. Reprovada com tentativas
  // sobrando segue para a próxima (é o que a tela pede ao repetir com `proxima: true`).
  const { data: linhas, error: errJa } = await tabela()
    .select('tentativa, status, rotulo, familia_base_id, cores, storage_path, custo_usd, ficha, verificacao, criado_em, atualizado_em')
    .eq('org_id', orgId).eq('request_id', requestId).order('tentativa', { ascending: true });
  if (errJa) return json({ error: 'Falha ao ler a geração. Tente novamente.' }, 500);
  const todas = (linhas ?? []) as Array<Record<string, unknown> & Linha>;
  const ja = todas.at(-1);
  let tentativa = 1;
  if (ja) {
    // Mesmo pedido = mesma base e as mesmas cores na mesma ordem; senão nunca devolve a foto de outro produto.
    if (ja.familia_base_id !== familiaBaseId || JSON.stringify(ja.cores) !== JSON.stringify(cores) || ja.rotulo !== rotulo) return json({ error: 'request_id já usado em outra combinação.', motivo: 'pedido_diferente' }, 409);
    const n = Number(ja.tentativa);
    const limiteAbandono = new Date(Date.now() - ABANDONO_MS).toISOString();
    if (ja.status === 'pendente' && String(ja.criado_em) < limiteAbandono) {
      // Reserva de uma execução que morreu (passou do tempo máximo da edge): sem imagem entregue, nada a cobrar.
      // O filtro por status e idade não apaga uma execução viva. Refaz a mesma tentativa.
      await tabela().delete().eq('org_id', orgId).eq('request_id', requestId).eq('tentativa', n).eq('status', 'pendente').lt('criado_em', limiteAbandono);
      tentativa = n;
    } else if (ja.status === 'pendente') {
      return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    } else if (ja.status === 'pendente_upload') {
      // Upload que estourou o prazo: a imagem já foi gerada (e paga ao provedor). Nunca gera de novo: confere o objeto
      // no caminho determinístico. Existe → `gerada` (cobrável). Não existe → `recusada` (a plataforma absorve).
      const caminho = String(ja.storage_path);
      const corte = caminho.lastIndexOf('/');
      const nome = caminho.slice(corte + 1);
      const { data: lista, error: errLista } = await admin.storage.from('imagens').list(caminho.slice(0, corte), { search: nome });
      if (errLista) { logErro('upload', errLista); return json({ error: 'Falha ao conferir a foto gerada. Tente novamente.' }, 500); }
      const existe = (lista ?? []).some((o: { name: string }) => o.name === nome);
      // Objeto ausente com a execução original ainda dentro do prazo: o upload pode estar em curso. Não decide nada
      // (a tela trata `em_andamento` como incerto e repete o mesmo pedido).
      const limiteUpload = new Date(Date.now() - UPLOAD_VENCIDO_MS).toISOString();
      if (!existe && String(ja.atualizado_em ?? ja.criado_em) >= limiteUpload) {
        return json({ error: 'A foto ainda está sendo guardada. Tente de novo em instantes.', motivo: 'em_andamento' }, 503);
      }
      let final: string | null;
      try { final = await transicionar(n, 'pendente_upload', { status: existe ? 'gerada' : 'recusada' }); }
      catch (e) { logErro('registro', e); return incerto(); }
      if (final === 'recusada') return falhaStorage();
      if (final !== 'gerada') return incerto();
      return await entregar(ja, caminho, Number(ja.custo_usd), true);
    } else if (ja.status === 'gerada') {
      return await entregar(ja, String(ja.storage_path), Number(ja.custo_usd), true);
    } else {
      // `recusada`: reprovada pela verificação (tenta de novo até o limite) ou definitiva (storage, legado).
      const v = ja.verificacao;
      if (v?.aprovado !== false) {
        return v?.aprovado === true
          ? falhaStorage()
          : json({ error: 'A foto gerada não serve ao Mercado Livre. Gere outra.', motivo: 'imagem_inadequada' }, 502);
      }
      if (n >= MAX_TENTATIVAS) return await responderReprovada(ja, true);
      tentativa = n + 1;
    }
  }
  // Tentativa anterior reprovada: dá a ficha (não recalcula) e os motivos a corrigir.
  const anterior = [...todas].reverse().find((l) => l.status === 'recusada' && l.verificacao?.aprovado === false && Number(l.tentativa) < tentativa);
  const fichaSalva = anterior?.ficha && Array.isArray(anterior.ficha.cores) && anterior.ficha.cores.length === cores.length
    && anterior.ficha.cores.every((c, i) => c.cor === cores[i] && Array.isArray(c.fotos) && c.fotos.length > 0)
    ? anterior.ficha : null;
  const motivos = anterior?.verificacao?.motivos ?? [];

  // Fotos de origem por cor: as da ficha guardada ou, na 1ª tentativa, as variações da cor (todas, até o teto).
  let origem: string[][];
  if (fichaSalva) {
    origem = fichaSalva.cores.map((c) => c.fotos);
  } else {
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
      const todasFotos = [...new Set([...candidatas.values()].flat())];
      const ms = fatia(30_000, MINIMO_IA_MS);
      moderadas = new Set(todasFotos.length === 0 ? [] : await comPrazo(fotosEmItemModerado(admin, orgId, async () => {
        const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
        if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
        return await getValidAccessTokenConexao(cx);
      }, todasFotos), ms));
    } catch (e) {
      logErro('moderacao', e);
      return json({ error: 'Não foi possível conferir as fotos no Mercado Livre. Tente novamente.', motivo: 'foto_moderacao_ilegivel' }, 502);
    }
    // ponytail: teto de fotos por cor (3, ou menos com muitas cores) pelo tamanho do pedido e pela CPU da edge.
    const porCor = Math.min(MAX_FOTOS_COR, Math.floor(MAX_FOTOS / cores.length));
    origem = [];
    for (const c of cores) {
      // Folga de 2× o teto: o mesmo arquivo costuma estar em vários caminhos (um por tamanho); repetidas saem depois.
      const paths = candidatas.get(c)!.filter((p) => !moderadas.has(p)).slice(0, porCor * 2);
      if (paths.length === 0) return json({ error: `Sem foto utilizável da cor ${c} (nenhuma, de outra empresa ou de anúncio moderado). Envie a foto.`, motivo: 'sem_foto_origem' }, 409);
      origem.push(paths);
    }
  }

  if (resta() < MINIMO_IA_MS) {
    return json({ error: 'Sem tempo para gerar a foto agora. Tente novamente.', motivo: 'prazo' }, 503);
  }

  // Reserva antes da IA: o mesmo request_id em paralelo não gera duas vezes (unique por tentativa e uma viva por pedido).
  const modelo = await resolverModeloImagem(admin, orgId);
  const { error: errReserva } = await tabela().insert({
    org_id: orgId, request_id: requestId, tentativa, status: 'pendente', familia_base_id: familiaBaseId, cores, rotulo,
    modelo, criado_por: userId,
  });
  if (errReserva) {
    if (errReserva.code === '23505') return json({ error: 'Esta foto ainda está sendo gerada.', motivo: 'em_andamento' }, 409);
    return json({ error: 'Falha ao registrar a geração. Tente novamente.' }, 500);
  }
  // Falha antes de existir imagem: some só esta reserva (as tentativas reprovadas e o custo delas ficam).
  const liberar = () => tabela().delete().eq('org_id', orgId).eq('request_id', requestId).eq('tentativa', tentativa).eq('status', 'pendente');

  let gerada: Awaited<ReturnType<typeof gerarImagem>>;
  let ficha: Ficha;
  let grupos: FotosDaCor[];
  let custoUsd = 0;
  try {
    const ms = fatia(15_000, 70_000);
    const blobs = await comPrazo(Promise.all(origem.map((paths) => Promise.all(paths.map(async (p) => {
      const { data, error: e } = await admin.storage.from('imagens').download(p);
      if (e || !data) throw new Error('foto de origem não encontrada');
      return data as Blob;
    })))), ms);
    // Sem repetidas por conteúdo (mesmo arquivo em outro caminho), até o teto por cor.
    const porCor = Math.min(MAX_FOTOS_COR, Math.floor(MAX_FOTOS / cores.length));
    const distintas = await Promise.all(blobs.map(async (bs, i) => {
      const vistos = new Set<string>();
      const fica: number[] = [];
      for (const [j, b] of bs.entries()) {
        const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))).join(',');
        if (!vistos.has(h)) { vistos.add(h); fica.push(j); }
      }
      return fica.slice(0, porCor).map((j) => ({ path: origem[i][j], blob: bs[j] }));
    }));
    origem = distintas.map((d) => d.map((x) => x.path));
    grupos = await Promise.all(distintas.map(async (d, i) => ({ cor: cores[i], urls: await Promise.all(d.map((x) => paraDataUrl(x.blob))) })));
    if (fichaSalva) {
      ficha = fichaSalva;
    } else {
      const lida = await extrairFicha(grupos, origem, fatia(FICHA_MS, 60_000));
      ficha = lida.ficha;
      custoUsd += lida.custoUsd;
    }
    gerada = await gerarImagem(modelo, montarPedidoFiel({ ficha, grupos, motivos }), grupos.flatMap((g) => g.urls),
      fatia(90_000, VERIFICACAO_MS + RESERVA_FINAL_MS));
    custoUsd += gerada.custoUsd;
  } catch (e) {
    // Falha de geração não cobra: some a reserva e o mesmo request_id pode tentar de novo.
    logErro('ia', e);
    await liberar();
    await auditar(target, 'failed');
    return json({ error: 'Não foi possível gerar a foto. Tente novamente.' }, 502);
  }

  // Verificação: imprópria ao ML reprova sem chamar a visão; erro ou resposta ilegível reprova (fail-closed).
  let verificacao: Verificacao;
  if (!adequadaAoML(dimensoesImagem(gerada.bytes))) {
    verificacao = reprovacao('Enquadramento: a foto saiu horizontal ou pequena; precisa ser quadrada ou vertical, com pelo menos 500 px.');
  } else {
    try {
      const geradaUrl = await paraDataUrl(new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }));
      const lida = await lerVerificacao(ficha, grupos, geradaUrl, fatia(VERIFICACAO_MS, RESERVA_FINAL_MS));
      custoUsd += lida.custoUsd;
      verificacao = avaliar(ficha, lida.json);
    } catch (e) {
      logErro('verificacao', e);
      verificacao = reprovacao('Não foi possível conferir a foto gerada.');
    }
  }

  if (!verificacao.aprovado) {
    // Prévia da reprovada, sem estado e fora do caminho da aprovada: só para o operador ver o que saiu.
    const previa = `${orgId}/kit-variacao-ia/${requestId}-t${tentativa}.${gerada.ext}`;
    let previaOk = false;
    try {
      const { error: e } = await comPrazo(admin.storage.from('imagens').upload(previa, new Blob([gerada.bytes as Uint8Array<ArrayBuffer>], { type: gerada.mime }), {
        contentType: gerada.mime, upsert: true,
      }), fatiaFinal(5_000));
      previaOk = !e;
    } catch (e) { logErro('upload', e); }
    const registro = { ...verificacao, ...(previaOk ? { previa_path: previa } : {}) };
    let final: string | null;
    try { final = await transicionar(tentativa, 'pendente', { status: 'recusada', custo_usd: custoUsd, ficha, verificacao: registro }); }
    catch (e) { logErro('registro', e); return incerto(); }
    await auditar(target, 'failed');
    if (final !== 'recusada') return incerto();
    return await responderReprovada({ tentativa, ficha, verificacao: registro }, false);
  }

  // Aprovada, com custo real. Sem storage: registra o custo, fora da cobrança, e não entrega.
  const linha: Linha = { tentativa, ficha, verificacao };
  const path = `${orgId}/kit-variacao-ia/${requestId}.${gerada.ext}`;
  const recusar = async (de: string, msg: string, motivo: string) => {
    let final: string | null;
    try { final = await transicionar(tentativa, de, { status: 'recusada', custo_usd: custoUsd }); }
    catch (e) { logErro('registro', e); await auditar(target, 'failed'); return incerto(); }
    // Outra execução já finalizou como `gerada` (objeto no storage): vale o estado gravado.
    if (final === 'gerada') return await entregar(linha, path, custoUsd, false);
    await auditar(target, 'failed');
    if (final !== 'recusada') return incerto();
    return json({ error: msg, motivo }, 502);
  };
  // Caminho determinístico por (org, request_id), gravado com o custo ANTES do upload (`pendente_upload`, não cobrável):
  // se o upload estourar o prazo e terminar depois, a repetição do mesmo pedido acha o objeto e finaliza.
  let pre: string | null;
  try { pre = await transicionar(tentativa, 'pendente', { status: 'pendente_upload', storage_path: path, custo_usd: custoUsd, ficha, verificacao }); }
  catch (e) { logErro('registro', e); return incerto(); }
  if (pre !== 'pendente_upload') return incerto();
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
    return await recusar('pendente_upload', 'Não foi possível guardar a foto gerada. Gere outra.', 'falha_storage');
  }
  // Terminal condicional: nunca sobrescreve uma `recusada` decidida por uma repetição (prazo vencido). Prazo aqui
  // rejeita e vira 503 `prazo` no topo: o cliente repete o mesmo pedido e recupera o estado gravado.
  let final: string | null;
  try { final = await transicionar(tentativa, 'pendente_upload', { status: 'gerada' }); }
  catch (e) { logErro('registro', e); return incerto(); }
  if (final === 'gerada') return await entregar(linha, path, custoUsd, false);
  if (final === 'recusada') { await auditar(target, 'failed'); return falhaStorage(); }
  return incerto();
}
