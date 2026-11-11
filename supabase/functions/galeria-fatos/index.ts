// ADR-0201 (Galeria da cor por IA), Task 6: Ficha Verdade e referências. Chamada pela tela com o JWT do operador.
// A tela manda o MLB da linha de Publicados; a edge resolve o anúncio/partição e a família vigente.
// Ações: montar | confirmar | descartar | manter_cadastro | corrigir_cadastro | enviar_vista. Toda ação, depois da
// sua gravação, remonta a ficha e as referências e aplica a vigência (hash ≠ roteiro aprovado → desatualiza).
// Nunca escreve no Mercado Livre: "corrigir cadastro" grava só na família.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { carregarAnuncio, coresDoAnuncio, resolverAnuncio, type AnuncioGaleria } from '../_shared/galeria/anuncio.ts';
import { calcularVigencia, ehJpeg, gravarReferencia, lerFicha, type Referencia } from '../_shared/galeria/referencias.ts';
import { conferirEtiqueta } from '../_shared/galeria/etiqueta.ts';
import { garantirDetalhes, VERSAO_LEITURA } from '../_shared/galeria/detalhes.ts';
import { MISSOES_COM_LUPA, situacaoLupa } from '../_shared/galeria/lupa.ts';
import type { Fato } from '../_shared/galeria/fatos.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { validarValorAtributo } from '../_shared/categoria/faltantes-editaveis.ts';
import { buscarSecureUrlFotoML } from '../_shared/ml/fotos.ts';

type Admin = ReturnType<typeof adminClient>;
const ACOES = new Set(['montar', 'confirmar', 'descartar', 'manter_cadastro', 'corrigir_cadastro', 'enviar_vista']);
const MAX_FOTO_BYTES = 8 * 1024 * 1024;
const CONFLITO_FATO = 'org_id,anuncio_externo_id,familia_id,campo';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null);

/**
 * Vigência editorial × execução, em todo `montar`:
 * - roteiro aprovado com hash diferente → `pendente` vai a falhou/roteiro_trocado e o roteiro, por último, a desatualizado;
 * - varredura: `gerada|aprovada` fora de manifesto de aplicação `aplicada` cujo roteiro não é o aprovado vigente
 *   com o hash atual → `desatualizada` (pega a `submetendo|gerando` que concluiu `gerada` depois da troca).
 * `submetendo|gerando` nunca mudam aqui: o worker com posse conclui.
 */
async function aplicarVigencia(admin: Admin, orgId: string, anuncioId: string, fatosHash: string): Promise<boolean> {
  const agora = new Date().toISOString();
  const { data: roteiro, error } = await admin.from('galeria_roteiros').select('id, fatos_hash')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).eq('status', 'aprovado').maybeSingle();
  if (error) throw new Error(error.message);
  const desatualizado = !!roteiro && roteiro.fatos_hash !== fatosHash;
  const vigente = roteiro && !desatualizado ? roteiro.id : null;

  if (desatualizado) {
    const r1 = await admin.from('galeria_imagens').update({ status: 'falhou', erro: 'roteiro_trocado', atualizado_em: agora })
      .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).eq('status', 'pendente');
    if (r1.error) throw new Error(r1.error.message);
  }
  const { data: aps, error: eAp } = await admin.from('galeria_aplicacoes').select('manifesto')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).eq('status', 'aplicada');
  if (eAp) throw new Error(eAp.message);
  const aplicadas = new Set((aps ?? []).flatMap((ap: { manifesto: Array<{ imagem_id: string }> }) => ap.manifesto.map((m) => m.imagem_id)));
  const { data: prontas, error: eIm } = await admin.from('galeria_imagens').select('id, roteiro_id')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).in('status', ['gerada', 'aprovada']);
  if (eIm) throw new Error(eIm.message);
  const ids = (prontas ?? []).filter((i: { id: string; roteiro_id: string }) => i.roteiro_id !== vigente && !aplicadas.has(i.id))
    .map((i: { id: string }) => i.id);
  if (ids.length > 0) {
    const r2 = await admin.from('galeria_imagens').update({ status: 'desatualizada', atualizado_em: agora })
      .eq('org_id', orgId).in('id', ids).in('status', ['gerada', 'aprovada']);
    if (r2.error) throw new Error(r2.error.message);
  }
  // Por último: queda no meio deixa o roteiro aprovado e a próxima montagem refaz tudo.
  if (desatualizado) {
    const r3 = await admin.from('galeria_roteiros').update({ status: 'desatualizado' }).eq('id', roteiro.id).eq('status', 'aprovado');
    if (r3.error) throw new Error(r3.error.message);
  }
  return desatualizado;
}

/**
 * URL da foto do recorte, resolvida aqui (a tela nunca monta URL de CDN): referência = URL assinada do Storage;
 * ML = `secure_url` lida do ML. Falhou → sem `url` e a tela não pré-seleciona a correção pela etiqueta.
 */
function comUrlDoRecorte(admin: Admin, orgId: string, fatos: Fato[]): Promise<Fato[]> {
  let token: string | null = null;
  const url = async (foto: { origem: 'referencia' | 'ml'; ref: string }): Promise<string | undefined> => {
    try {
      if (foto.origem === 'referencia') {
        const { data, error } = await admin.storage.from('imagens').createSignedUrl(foto.ref, 600);
        return error ? undefined : data?.signedUrl;
      }
      if (!token) {
        const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
        if (!cx) return undefined;
        token = await getValidAccessTokenConexao(cx);
      }
      return await buscarSecureUrlFotoML(token, foto.ref);
    } catch (e) {
      console.error('[galeria-fatos] url do recorte', (e as Error).message);
      return undefined;
    }
  };
  return Promise.all(fatos.map(async (f) => {
    const foto = f.estado === 'DIVERGENTE' ? f.etiqueta?.foto : null;
    if (!foto || !f.etiqueta) return f;
    const u = await url(foto);
    return u ? { ...f, etiqueta: { ...f.etiqueta, foto: { ...foto, url: u } } } : f;
  }));
}

async function montar(admin: Admin, orgId: string, a: AnuncioGaleria) {
  // Uma visão da etiqueta só quando fotos/campos/família mudaram (cache na sentinela); nunca mais que uma por montar.
  const v = await calcularVigencia(admin, orgId, a, (ctx) => conferirEtiqueta(admin, orgId, a, ctx));
  const desatualizado = await aplicarVigencia(admin, orgId, a.anuncioId, v.fatos_hash);
  return {
    anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, codigo_pai: a.codigoPai, cores: coresDoAnuncio(a),
    ...v, fatos: await comUrlDoRecorte(admin, orgId, v.fatos), roteiro_desatualizado: desatualizado,
    lupa: await lerLupas(admin, orgId, v.referencias),
  };
}

/**
 * Lupa pela caixa do produto: lê (visão, prazo global) só a referência `frente` de cada cor que precisa, depois do
 * hash (a leitura não entra em `fatos_hash`). Devolve, por cor, a situação de cada missão com lupa (geral e Moda;
 * o roteiro decide qual vale), calculada sobre a leitura relida do banco. Falha nunca derruba o `montar`.
 */
async function lerLupas(admin: Admin, orgId: string, referencias: Record<string, Record<string, Referencia | { erro: string }>>) {
  const frente: Record<string, Referencia> = {};
  for (const [cor, r] of Object.entries(referencias)) if (r.frente && !('erro' in r.frente)) frente[cor] = r.frente;
  const lidas = await garantirDetalhes(admin, orgId, Object.values(frente));
  const porModo = (cor: string, moda: boolean) => Object.fromEntries((moda ? MISSOES_COM_LUPA.moda : MISSOES_COM_LUPA.geral)
    .map((m) => [m, situacaoLupa(frente[cor] ? lidas[frente[cor].id] : null, m, moda, VERSAO_LEITURA)]));
  return Object.fromEntries(Object.keys(referencias).map((cor) => [cor, { geral: porModo(cor, false), moda: porModo(cor, true) }]));
}

/** Valor do atributo pela regra da Revisão (`atributos-familia`): closed-set grava o `value_id` do dicionário. */
async function valorDoAtributo(admin: Admin, orgId: string, categoriaId: string, atributoId: string, bruto: string) {
  const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
  if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
  const schema = await lerSchemaAtributos(await getValidAccessTokenConexao(cx), categoriaId);
  // Lista fechada: a sugestão da etiqueta "100% X" vira o valor "X" do dicionário, se existir.
  const puro = /^\s*100\s*%\s*(.+)$/.exec(bruto)?.[1];
  const v = validarValorAtributo(schema, atributoId, bruto) ?? (puro ? validarValorAtributo(schema, atributoId, puro) : null);
  if (!v) return null;
  const nome = v.value_name ?? schema.find((x) => x.id === atributoId)?.valores.find((x) => x.id === v.value_id)?.nome;
  return nome ? { value_id: v.value_id, value_name: nome } : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = auth;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const acao = String(body.acao ?? '');
  const mlItemId = texto(body.ml_item_id, 40);
  if (!ACOES.has(acao)) return json({ error: 'acao_invalida' }, 400);
  if (!mlItemId) return json({ error: 'ml_item_id_obrigatorio' }, 400);

  const admin = adminClient();
  try {
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);
    if (acao === 'montar') return json(await montar(admin, orgId, a));

    // Trabalho novo só na família vigente (a tela manda a que mostrou).
    if (body.familia_id !== a.vigente.id) return json({ error: 'familia_nao_vigente', familia_id_vigente: a.vigente.id }, 409);
    const chave = { org_id: orgId, anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id };
    const quem = { confirmado_por: userId, confirmado_em: new Date().toISOString() };

    if (acao === 'enviar_vista') {
      const cor = texto(body.cor, 200);
      const vista = body.vista;
      if (vista !== 'costas' && vista !== 'lateral') return json({ error: 'vista_invalida' }, 400);
      if (!cor || !coresDoAnuncio(a).includes(cor)) return json({ error: 'cor_invalida' }, 400);
      const b64 = typeof body.imagem_base64 === 'string' ? body.imagem_base64 : '';
      if (b64 === '' || b64.length > Math.ceil(MAX_FOTO_BYTES / 3) * 4) return json({ error: 'foto_invalida' }, 400);
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
      catch { return json({ error: 'foto_invalida' }, 400); }
      // Só JPEG: o caminho imutável é .jpg.
      if (!ehJpeg(bytes)) return json({ error: 'foto_nao_jpeg' }, 400);
      await gravarReferencia(admin, orgId, a, cor, vista, bytes, 'upload_operador');
      return json(await montar(admin, orgId, a));
    }

    const campo = texto(body.campo, 200);
    const fato = (await lerFicha(admin, orgId, a)).find((x) => x.campo === campo);
    if (!campo || !fato) return json({ error: 'campo_invalido' }, 400);
    let linha: Record<string, unknown>;

    if (acao === 'confirmar' || acao === 'descartar') {
      if (fato.estado !== 'SUGERIDO') return json({ error: 'campo_nao_sugerido' }, 400);
      linha = {
        ...chave, ...quem, campo, valor: fato.valor, origem: 'confirmado_operador',
        evidencia: { ...fato.evidencia, origem_sugestao: fato.origem }, descartado: acao === 'descartar',
      };
    } else if (acao === 'manter_cadastro') {
      // Só destrava divergência que o servidor leu; a leitura gravada é a do servidor, nunca a do cliente.
      const etiqueta = fato.etiqueta?.valor;
      if (fato.estado !== 'DIVERGENTE' || !etiqueta) return json({ error: 'campo_nao_divergente' }, 409);
      linha = {
        ...chave, ...quem, campo, valor: fato.valor, origem: fato.origem === 'planilha' ? 'planilha' : 'confirmado_operador',
        evidencia: { ...fato.evidencia, manter_cadastro: true, etiqueta_lida: etiqueta }, descartado: false,
      };
    } else {
      // corrigir_cadastro: só atributo da família vigente; o anúncio no ML segue pelo fluxo normal de atualização
      // (UP compara por value_id: sem ele o UPDATE acharia que "confere" e nunca reenviaria).
      const bruto = texto(body.valor, 255);
      const id = campo.startsWith('atributo:') ? campo.slice('atributo:'.length) : null;
      const atributos = a.vigente.atributos_ml ?? [];
      // BRAND tem fluxo próprio (marca por produto, ADR-0186/0188).
      if (!id || id === 'BRAND' || !bruto || !a.vigente.categoria_ml_id || !atributos.some((x) => x.id === id)) {
        return json({ error: 'campo_nao_corrigivel' }, 400);
      }
      const novo = await valorDoAtributo(admin, orgId, a.vigente.categoria_ml_id, id, bruto);
      if (!novo) return json({ error: 'valor_invalido' }, 422);
      const valor = novo.value_name;
      const novos = atributos.map((x) => {
        if (x.id !== id) return x;
        const { value_id: _antigo, ...resto } = x;
        return { ...resto, value_name: novo.value_name, ...(novo.value_id ? { value_id: novo.value_id } : {}) };
      });
      const { error } = await admin.from('familias').update({ atributos_ml: novos, atributos_editados_pelo_operador: true })
        .eq('id', a.vigente.id).eq('org_id', orgId);
      if (error) throw new Error(error.message);
      a.vigente.atributos_ml = novos;
      linha = {
        ...chave, ...quem, campo, valor, origem: 'confirmado_operador',
        // A leitura superada fica gravada (como no manter): o fato não volta a DIVERGENTE enquanto ela não mudar.
        evidencia: {
          ...fato.evidencia, corrigido_cadastro: true, valor_anterior: fato.valor,
          ...(fato.etiqueta?.legivel && fato.etiqueta.valor ? { etiqueta_lida: fato.etiqueta.valor } : {}),
        }, descartado: false,
      };
    }
    const { error } = await admin.from('galeria_fatos').upsert(linha, { onConflict: CONFLITO_FATO });
    if (error) throw new Error(error.message);
    return json(await montar(admin, orgId, a));
  } catch (e) {
    console.error('[galeria-fatos]', acao, (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
