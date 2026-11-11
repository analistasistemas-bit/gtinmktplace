// ADR-0201 (Galeria da cor por IA), Task 12: aprovar o arquivo final composto no navegador. Chamada pela tela com o JWT
// do operador (verify_jwt = true). Escopo = a linha de Publicados: `ml_item_id` → `anuncio_externo_id` (split: cada
// partição só alcança as imagens dela). Ações:
// - preparar_upload {ml_item_id, imagem_id}: só imagem `gerada`; URL de upload assinada (`upsert: false`) para um
//   caminho NOVO a cada chamada `${orgId}/galeria-ia/${familiaId}/finais/${imagemId}-${nonce}.jpg`, gravado em
//   `final_upload_path`. URL antiga usada depois cai em caminho próprio (ou é recusada, se for o aprovado).
// - aprovar {ml_item_id, imagem_id}: lê só `final_upload_path`; confere o arquivo (JPEG 1200×1540 ≤1 MB não branco),
//   a referência (sha atual da cor/vista = o da imagem) e grava pela RPC `galeria_aprovar_imagem` (uma aprovada por
//   cor, missão e roteiro, na mesma transação). Recorte nasce com `alertas = []`; gerador com `alertas` nulo =
//   verificação por visão ainda não rodou. `verificacao_indisponivel` não bloqueia (só aparece no cartão).
//   Gerador sem `entregue_em` (exibição ainda não confirmada = não cobrada) → `exibicao_pendente` (revisão geral).
//   Exige o módulo `imagem_ia`.
//   Missões com lupa/recorte → `lupa_pendente` enquanto travadas (portão da Task 16, regras.ts). Liberadas, exigem a
//   leitura `ok` da referência vigente com o recorte cabendo (`lupa_indisponivel`) e `lupa_hash` no corpo = o hash das
//   caixas gravadas (`lupa_desatualizada`): bundle antigo, sem hash, nunca aprova recorte às cegas.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { carregarAnuncio, resolverAnuncio } from '../_shared/galeria/anuncio.ts';
import { carregarFotosAplicadas, prepararReferencia, sha256Hex } from '../_shared/galeria/referencias.ts';
import { lupaPendente, missoesDisponiveis } from '../_shared/galeria/regras.ts';
import { validarArquivoFinal } from '../_shared/galeria/arquivo-final.ts';
import { comLupa, situacaoLupa, type DetalhesLupa } from '../_shared/galeria/lupa.ts';
import { VERSAO_LEITURA } from '../_shared/galeria/detalhes.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface LinhaImagem {
  id: string; familia_id: string; roteiro_id: string; cor: string; missao: number; origem: string; status: string;
  alertas: unknown; referencia_id: string | null; final_upload_path: string | null; entregue_em: string | null;
}

/** Status que impede preparar/aprovar → código do erro (null = `gerada`, pode seguir). */
const bloqueio = (status: string) =>
  status === 'gerada' ? null : status === 'aprovada' ? 'ja_aprovada' : status === 'desatualizada' ? 'desatualizada' : 'nao_aprovavel';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = auth;
  const admin = adminClient();
  // ADR-0201 §8 (revisão geral): aprovar escreve no Storage e na galeria; exige o módulo imagem_ia (fail-closed).
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) return json({ error: 'modulo_desligado' }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const acao = body.acao;
  const mlItemId = typeof body.ml_item_id === 'string' && body.ml_item_id.trim() !== '' && body.ml_item_id.length <= 40 ? body.ml_item_id.trim() : null;
  const imagemId = typeof body.imagem_id === 'string' && UUID.test(body.imagem_id) ? body.imagem_id.toLowerCase() : null;
  if (!mlItemId || !imagemId || !['preparar_upload', 'aprovar'].includes(acao as string)) return json({ error: 'pedido_invalido' }, 400);

  try {
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);
    const { data: im, error: eI } = await admin.from('galeria_imagens')
      .select('id, familia_id, roteiro_id, cor, missao, origem, status, alertas, referencia_id, final_upload_path, entregue_em')
      .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('id', imagemId).maybeSingle();
    if (eI) throw new Error(eI.message);
    if (!im) return json({ error: 'nao_encontrada' }, 404);
    const img = im as LinhaImagem;

    if (acao === 'preparar_upload') {
      const b = bloqueio(img.status);
      if (b) return json({ error: b }, 409);
      const path = `${orgId}/galeria-ia/${img.familia_id}/finais/${img.id}-${crypto.randomUUID()}.jpg`;
      const { data: up, error: eU } = await admin.storage.from('imagens').createSignedUploadUrl(path, { upsert: false });
      if (eU || !up) throw new Error(eU?.message ?? 'sem URL de upload');
      // Condicionado a `gerada`: aprovação concorrente vence e este preparo não troca o caminho de uma aprovada.
      const { data: gravou, error: eG } = await admin.from('galeria_imagens')
        .update({ final_upload_path: path, atualizado_em: new Date().toISOString() })
        .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('id', img.id).eq('status', 'gerada')
        .select('id');
      if (eG) throw new Error(eG.message);
      if ((gravou ?? []).length === 0) return json({ error: 'nao_aprovavel' }, 409);
      return json({ path, token: up.token, signed_url: up.signedUrl });
    }

    // aprovar: estado (barato) → arquivo → referência → RPC (confere de novo tudo o que precisa ser atômico).
    const b = img.status === 'aprovada' ? null : bloqueio(img.status);
    if (b) return json({ error: b }, 409);
    if (img.origem === 'gerador' && img.alertas == null) return json({ error: 'verificacao_pendente' }, 409);
    // Gerador só aprova já cobrada (R8.3): a tela repete `confirmar_exibicao` e tenta de novo. A RPC confere de novo.
    if (img.origem === 'gerador' && img.status !== 'aprovada' && !img.entregue_em) return json({ error: 'exibicao_pendente' }, 409);
    const { data: rot, error: eR } = await admin.from('galeria_roteiros').select('moda').eq('id', img.roteiro_id).eq('org_id', orgId).maybeSingle();
    if (eR) throw new Error(eR.message);
    const moda = rot?.moda === true;
    if (lupaPendente(img.missao, moda)) return json({ error: 'lupa_pendente' }, 409);
    if (!img.final_upload_path) return json({ error: 'sem_upload' }, 409);
    const { data: blob } = await admin.storage.from('imagens').download(img.final_upload_path);
    if (!blob) return json({ error: 'sem_arquivo' }, 409);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const erros = validarArquivoFinal(bytes);
    if (erros.length > 0) return json({ error: 'arquivo_invalido', erros }, 422);

    // Referência atual da cor e da vista da missão: a mesma fonte do galeria-gerar (calcularVigencia).
    const { data: ref, error: eRef } = img.referencia_id
      ? await admin.from('galeria_referencias').select('sha256').eq('id', img.referencia_id).eq('org_id', orgId).maybeSingle()
      : { data: null, error: null };
    if (eRef) throw new Error(eRef.message);
    const vista = missoesDisponiveis(moda, ['frente', 'costas', 'lateral']).find((m) => m.missao === img.missao)?.vista;
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);
    const atual = vista
      ? await prepararReferencia(admin, orgId, r.anuncioId, img.cor, vista, await carregarFotosAplicadas(admin, orgId, r.anuncioId), a)
      : null;
    if (!ref || !atual || 'erro' in atual || atual.sha256 !== ref.sha256) return json({ error: 'referencia_trocada' }, 409);
    if (comLupa(img.missao, moda)) {
      const { data: lida, error: eD } = await admin.from('galeria_referencias').select('detalhes').eq('id', atual.id).eq('org_id', orgId).maybeSingle();
      if (eD) throw new Error(eD.message);
      const d = (lida?.detalhes ?? null) as DetalhesLupa | null;
      if (situacaoLupa(d, img.missao, moda, VERSAO_LEITURA) !== 'ok' || d?.estado !== 'ok') return json({ error: 'lupa_indisponivel' }, 409);
      if (typeof body.lupa_hash !== 'string' || body.lupa_hash !== d.hash) return json({ error: 'lupa_desatualizada' }, 409);
    }

    const { data: res, error: eA } = await admin.rpc('galeria_aprovar_imagem', {
      p_org: orgId, p_anuncio: r.anuncioId, p_imagem: img.id, p_upload_path: img.final_upload_path,
      p_sha256: sha256Hex(bytes), p_usuario: userId,
    });
    if (eA) throw new Error(eA.message);
    if (res !== 'ok') return json({ error: res === 'nao_encontrada' ? 'nao_encontrada' : res }, res === 'nao_encontrada' ? 404 : 409);
    return json({ status: 'aprovada' });
  } catch (e) {
    console.error('[galeria-aprovar]', (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
