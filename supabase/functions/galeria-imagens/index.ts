// ADR-0201 (Galeria da cor por IA), Task 10: imagens geradas na tela. Chamada pela tela com o JWT do operador
// (verify_jwt = true). Ações:
// - listar {ml_item_id, roteiro_versao}: imagens do roteiro daquela versão da família vigente, com URL assinada, preço do
//   mês (mesma fonte do galeria-gerar) e se "Gerar de novo" ainda cabe. Nunca cobra nem grava.
// - confirmar_exibicao {ml_item_id, imagem_ids}: o navegador exibiu e validou a imagem → `galeria_confirmar_exibicao`
//   (cobrança = exibição, Task 2; idempotente). Operação histórica: só exige o mesmo anúncio.
// - reportar_invalida {ml_item_id, imagem_id}: imagem branca/ilegível no navegador → `falhou` sem cobrança (falha
//   técnica não gasta vaga). Só linha `gerada`, `gerador`, ainda não exibida, deste anúncio e desta org.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { carregarAnuncio, resolverAnuncio } from '../_shared/galeria/anuncio.ts';
import { bloqueioDaVaga, precoDoMes, type LinhaVaga } from '../_shared/galeria/pedido.ts';
import { missoesDisponiveis } from '../_shared/galeria/regras.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;
const URL_SEG = 600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface LinhaImagem extends LinhaVaga {
  id: string; cena_path: string | null; referencia_id: string | null; alertas: unknown; erro: string | null; entregue_em: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = auth;
  const admin = adminClient();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const acao = body.acao;
  const mlItemId = typeof body.ml_item_id === 'string' && body.ml_item_id.trim() !== '' && body.ml_item_id.length <= 40 ? body.ml_item_id.trim() : null;
  if (!mlItemId || !['listar', 'confirmar_exibicao', 'reportar_invalida'].includes(acao as string)) return json({ error: 'pedido_invalido' }, 400);

  try {
    if (acao === 'confirmar_exibicao') {
      const ids = Array.isArray(body.imagem_ids) && body.imagem_ids.length > 0 && body.imagem_ids.length <= MAX_IDS
        && body.imagem_ids.every((i) => typeof i === 'string' && UUID.test(i))
        ? [...new Set((body.imagem_ids as string[]).map((i) => i.toLowerCase()))] : null;
      if (!ids) return json({ error: 'pedido_invalido' }, 400);
      const r = await resolverAnuncio(admin, orgId, mlItemId);
      if ('erro' in r) return json({ error: r.erro }, 409);
      // Org do auth e anúncio resolvido no servidor: id de outra org/partição não casa no WHERE da RPC.
      const { data, error } = await admin.rpc('galeria_confirmar_exibicao', { p_org: orgId, p_anuncio: r.anuncioId, p_ids: ids });
      if (error) throw new Error(error.message);
      return json({ cobradas: Number(data ?? 0) });
    }

    if (acao === 'reportar_invalida') {
      const id = typeof body.imagem_id === 'string' && UUID.test(body.imagem_id) ? body.imagem_id.toLowerCase() : null;
      if (!id) return json({ error: 'pedido_invalido' }, 400);
      const r = await resolverAnuncio(admin, orgId, mlItemId);
      if ('erro' in r) return json({ error: r.erro }, 409);
      // Um único update condicional; `entregue_em is null` impede derrubar imagem já cobrada.
      const { data, error } = await admin.from('galeria_imagens')
        .update({ status: 'falhou', erro: 'imagem_invalida', atualizado_em: new Date().toISOString() })
        .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('id', id)
        .eq('origem', 'gerador').eq('status', 'gerada').is('entregue_em', null)
        .select('id');
      if (error) throw new Error(error.message);
      return json({ reportada: (data ?? []).length > 0 });
    }

    // listar
    const versao = Number.isInteger(body.roteiro_versao) ? body.roteiro_versao as number : null;
    if (versao === null) return json({ error: 'pedido_invalido' }, 400);
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);
    const { unitCents } = await precoDoMes(admin, orgId);

    // A versão é numerada por família: a mesma versão pode existir em famílias anteriores do anúncio.
    const { data: rot, error: eR } = await admin.from('galeria_roteiros').select('id, moda')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('familia_id', a.vigente.id).eq('versao', versao).maybeSingle();
    if (eR) throw new Error(eR.message);
    if (!rot) return json({ roteiro_id: null, unit_cents: unitCents, imagens: [] });

    // Todas as linhas do anúncio: a geração aberta de qualquer roteiro bloqueia a (cor, missão), como na RPC.
    const { data: todas, error: eI } = await admin.from('galeria_imagens')
      .select('id, roteiro_id, cor, missao, geracao, origem, status, cena_path, referencia_id, alertas, erro, entregue_em')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId);
    if (eI) throw new Error(eI.message);
    const linhas = (todas ?? []) as LinhaImagem[];
    const doRoteiro = linhas.filter((l) => l.roteiro_id === rot.id)
      .sort((x, y) => x.cor.localeCompare(y.cor) || x.missao - y.missao || x.geracao - y.geracao);

    const refIds = [...new Set(doRoteiro.filter((l) => l.origem === 'recorte' && l.referencia_id).map((l) => l.referencia_id!))];
    const refPath = new Map<string, string>();
    if (refIds.length > 0) {
      const { data: refs, error: eRef } = await admin.from('galeria_referencias').select('id, path').eq('org_id', orgId).in('id', refIds);
      if (eRef) throw new Error(eRef.message);
      for (const x of (refs ?? []) as Array<{ id: string; path: string }>) refPath.set(x.id, x.path);
    }
    const assinar = async (path: string | null | undefined) => {
      if (!path) return null;
      const { data, error } = await admin.storage.from('imagens').createSignedUrl(path, URL_SEG);
      return error ? null : data?.signedUrl ?? null;
    };

    const usaGerador = new Map(missoesDisponiveis(rot.moda === true, ['frente', 'costas', 'lateral']).map((m) => [m.missao as number, m.usaGerador]));
    const imagens = await Promise.all(doRoteiro.map(async (l) => ({
      id: l.id, cor: l.cor, missao: l.missao, geracao: l.geracao, origem: l.origem, status: l.status,
      alertas: l.alertas ?? null, erro: l.erro, exibida: l.entregue_em !== null,
      url: await assinar(l.origem === 'recorte' ? refPath.get(l.referencia_id ?? '') : l.cena_path),
      pode_gerar_de_novo: l.origem === 'gerador' && bloqueioDaVaga(linhas, rot.id, l.cor, l.missao, usaGerador.get(l.missao) ?? true) === null,
    })));
    return json({ roteiro_id: rot.id, unit_cents: unitCents, imagens });
  } catch (e) {
    console.error('[galeria-imagens]', (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
