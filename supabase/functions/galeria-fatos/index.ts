// ADR-0201 (Galeria da cor por IA), Task 6: Ficha Verdade e referências. Chamada pela tela com o JWT do operador.
// A tela manda o MLB da linha de Publicados; a edge resolve o anúncio/partição e a família vigente.
// Ações: montar | confirmar | descartar | manter_cadastro | corrigir_cadastro | enviar_vista. Toda ação, depois da
// sua gravação, remonta a ficha e as referências e aplica a vigência (hash ≠ roteiro aprovado → desatualiza).
// Nunca escreve no Mercado Livre: "corrigir cadastro" grava só na família.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { carregarAnuncio, coresDoAnuncio, resolverAnuncio, type AnuncioGaleria } from '../_shared/galeria/anuncio.ts';
import { hashFatos, montarFicha, type Fato, type FatoGravado } from '../_shared/galeria/fatos.ts';
import { carregarFotosAplicadas, gravarReferencia, prepararReferencia, type Referencia } from '../_shared/galeria/referencias.ts';
import type { Vista } from '../_shared/galeria/regras.ts';

type Admin = ReturnType<typeof adminClient>;
const ACOES = new Set(['montar', 'confirmar', 'descartar', 'manter_cadastro', 'corrigir_cadastro', 'enviar_vista']);
const VISTAS: Vista[] = ['frente', 'costas', 'lateral'];
const MEDIDAS = ['peso_gramas', 'altura_cm', 'largura_cm', 'comprimento_cm'] as const;
const MAX_FOTO_BYTES = 8 * 1024 * 1024;
const CONFLITO_FATO = 'org_id,anuncio_externo_id,familia_id,campo';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null);

async function lerFicha(admin: Admin, orgId: string, a: AnuncioGaleria): Promise<Fato[]> {
  const { data, error } = await admin.from('galeria_fatos').select('campo, valor, origem, evidencia, descartado')
    .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('familia_id', a.vigente.id);
  if (error) throw new Error(error.message);
  const f = a.vigente;
  return montarFicha({
    planilha: { nome: f.nome_pai, descricao_fornecedor: f.descricao_pai, marca: f.marca, origem: f.origem },
    medidasPorSku: Object.fromEntries(a.skus.filter((s) => a.porSku[s]).map((s) => [s, Object.fromEntries(
      MEDIDAS.filter((m) => a.porSku[s][m] != null).map((m) => [m, String(a.porSku[s][m])]),
    )])),
    atributosML: f.atributos_ml ?? [],
    textosIA: { titulo_ml: f.titulo_ml, descricao_ml: f.descricao_ml },
    confirmados: (data ?? []) as FatoGravado[],
  });
}

/** Vigência editorial × execução: só `pendente` e as produzidas não aplicadas mudam; submetendo|gerando concluem sozinhas. */
async function desatualizar(admin: Admin, orgId: string, anuncioId: string, roteiroId: string) {
  const agora = new Date().toISOString();
  const r1 = await admin.from('galeria_imagens').update({ status: 'falhou', erro: 'roteiro_trocado', atualizado_em: agora })
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).eq('status', 'pendente');
  if (r1.error) throw new Error(r1.error.message);
  const { data: aps, error: eAp } = await admin.from('galeria_aplicacoes').select('manifesto')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).eq('status', 'aplicada');
  if (eAp) throw new Error(eAp.message);
  const aplicadas = new Set((aps ?? []).flatMap((ap: { manifesto: Array<{ imagem_id: string }> }) => ap.manifesto.map((m) => m.imagem_id)));
  const { data: prontas, error: eIm } = await admin.from('galeria_imagens').select('id')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).in('status', ['gerada', 'aprovada']);
  if (eIm) throw new Error(eIm.message);
  const ids = (prontas ?? []).map((i: { id: string }) => i.id).filter((id: string) => !aplicadas.has(id));
  if (ids.length > 0) {
    const r2 = await admin.from('galeria_imagens').update({ status: 'desatualizada', atualizado_em: agora })
      .eq('org_id', orgId).in('id', ids).in('status', ['gerada', 'aprovada']);
    if (r2.error) throw new Error(r2.error.message);
  }
  // Por último: queda no meio deixa o roteiro aprovado e a próxima montagem refaz tudo.
  const r3 = await admin.from('galeria_roteiros').update({ status: 'desatualizado' }).eq('id', roteiroId).eq('status', 'aprovado');
  if (r3.error) throw new Error(r3.error.message);
}

async function montar(admin: Admin, orgId: string, a: AnuncioGaleria) {
  const aplicadas = await carregarFotosAplicadas(admin, orgId, a.anuncioId);
  const cores = coresDoAnuncio(a);
  const referencias: Record<string, Record<string, Referencia | { erro: 'sem_referencia' }>> = {};
  const shas: Record<string, string> = {};
  for (const cor of cores) {
    referencias[cor] = {};
    for (const vista of VISTAS) {
      const r = await prepararReferencia(admin, orgId, a.anuncioId, cor, vista, aplicadas, a);
      referencias[cor][vista] = r;
      if (!('erro' in r)) shas[`${cor}:${vista}`] = r.sha256;
    }
  }
  const fatos = await lerFicha(admin, orgId, a);
  const fatosHash = hashFatos(fatos, shas);
  const { data: roteiro, error } = await admin.from('galeria_roteiros').select('id, fatos_hash')
    .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('status', 'aprovado').maybeSingle();
  if (error) throw new Error(error.message);
  const desatualizado = !!roteiro && roteiro.fatos_hash !== fatosHash;
  if (desatualizado) await desatualizar(admin, orgId, a.anuncioId, roteiro.id);
  return {
    anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, codigo_pai: a.codigoPai, cores,
    fatos, referencias, fatos_hash: fatosHash, roteiro_desatualizado: desatualizado,
  };
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
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ error: 'foto_nao_jpeg' }, 400);
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
      const etiqueta = texto(body.etiqueta, 500);
      if (!etiqueta || fato.estado === 'VARIA_POR_TAMANHO') return json({ error: 'campo_invalido' }, 400);
      linha = {
        ...chave, ...quem, campo, valor: fato.valor, origem: fato.origem === 'planilha' ? 'planilha' : 'confirmado_operador',
        evidencia: { ...fato.evidencia, manter_cadastro: true, etiqueta_lida: etiqueta }, descartado: false,
      };
    } else {
      // corrigir_cadastro: só atributo da família vigente; o anúncio no ML segue pelo fluxo normal de atualização.
      const valor = texto(body.valor, 255);
      const id = campo.startsWith('atributo:') ? campo.slice('atributo:'.length) : null;
      const atributos = a.vigente.atributos_ml ?? [];
      if (!id || !valor || !atributos.some((x) => x.id === id)) return json({ error: 'campo_nao_corrigivel' }, 400);
      // value_id é do valor antigo: sai junto.
      const novos = atributos.map((x) => {
        if (x.id !== id) return x;
        const { value_id: _antigo, ...resto } = x;
        return { ...resto, value_name: valor };
      });
      const { error } = await admin.from('familias').update({ atributos_ml: novos, atributos_editados_pelo_operador: true })
        .eq('id', a.vigente.id).eq('org_id', orgId);
      if (error) throw new Error(error.message);
      a.vigente.atributos_ml = novos;
      linha = {
        ...chave, ...quem, campo, valor, origem: 'confirmado_operador',
        evidencia: { ...fato.evidencia, corrigido_cadastro: true, valor_anterior: fato.valor }, descartado: false,
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
