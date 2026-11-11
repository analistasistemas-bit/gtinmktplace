// ADR-0201 (Galeria da cor por IA), Task 10: imagens geradas na tela. Chamada pela tela com o JWT do operador
// (verify_jwt = true). Ações:
// - listar {ml_item_id}: título e cores do anúncio, posições (nomes das 7 imagens; `indisponivel` vem do plano), o plano
//   aprovado (`plano_id`, só se for formato 2 — ADR-0203) e as imagens que ainda importam (as do roteiro aprovado + toda
//   cena produzida não exibida, de qualquer família), com URL assinada, o preço congelado no pedido de cada uma, o preço
//   do mês (só para pedido novo; mesma fonte do galeria-gerar) e se "Gerar de novo" ainda cabe. Nunca cobra nem grava.
// - confirmar_exibicao {ml_item_id, imagem_ids}: o navegador exibiu e validou a imagem → `galeria_confirmar_exibicao`
//   (cobrança = exibição, Task 2; idempotente). Operação histórica: só exige o mesmo anúncio.
// - reportar_invalida {ml_item_id, imagem_id}: imagem branca/ilegível no navegador → `falhou` sem cobrança (falha
//   `imagem_invalida`; revisão geral: ocupa vaga no teto, pois o provedor foi pago — pedido.ts / galeria_reservar_pedido).
//   Só linha `gerada`, `gerador`, ainda não exibida, deste anúncio (qualquer família) e desta org.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { carregarAnuncio, coresDoAnuncio, resolverAnuncio } from '../_shared/galeria/anuncio.ts';
import { bloqueioDaVaga, precoDoMes, type LinhaVaga } from '../_shared/galeria/pedido.ts';
import { missoesDisponiveis } from '../_shared/galeria/regras.ts';
import { ehPlano } from '../_shared/galeria/plano.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;
const URL_SEG = 600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Produzidas e cobráveis ao exibir; descartada/desatualizada de roteiros antigos não voltam à tela.
const PENDENTES_DE_EXIBICAO = new Set(['gerada', 'aprovada']);

interface LinhaImagem extends LinhaVaga {
  id: string; pedido_id: string; cena_path: string | null; alertas: unknown; erro: string | null; entregue_em: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = auth;
  const admin = adminClient();
  // ADR-0201 §8 (revisão geral): mostrar, cobrar e reportar imagens exige o módulo imagem_ia (fail-closed).
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) return json({ error: 'modulo_desligado' }, 403);

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
      // Um único update condicional (operação histórica: mesmo anúncio, qualquer família); `entregue_em is null`
      // impede derrubar imagem já cobrada.
      const { data, error } = await admin.from('galeria_imagens')
        .update({ status: 'falhou', erro: 'imagem_invalida', atualizado_em: new Date().toISOString() })
        .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('id', id)
        .eq('origem', 'gerador').eq('status', 'gerada').is('entregue_em', null)
        .select('id');
      if (error) throw new Error(error.message);
      return json({ reportada: (data ?? []).length > 0 });
    }

    // listar (histórico: o anúncio da linha, qualquer família)
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);
    const { unitCents } = await precoDoMes(admin, orgId);

    // O aprovado do anúncio (índice único), mesmo com rascunho mais novo por cima ou família nova publicada.
    const { data: rot, error: eR } = await admin.from('galeria_roteiros').select('id, moda, conteudo')
      .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('status', 'aprovado').maybeSingle();
    if (eR) throw new Error(eR.message);

    // Todas as linhas do anúncio: a geração aberta de qualquer roteiro bloqueia a (cor, missão), como na RPC.
    const { data: todas, error: eI } = await admin.from('galeria_imagens')
      .select('id, pedido_id, roteiro_id, cor, missao, geracao, origem, status, cena_path, alertas, erro, entregue_em')
      .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId);
    if (eI) throw new Error(eI.message);
    const linhas = (todas ?? []) as LinhaImagem[];
    // Que ainda importam: todas do roteiro aprovado + toda cena produzida ainda não exibida (qualquer família/roteiro),
    // para que exibição e cobrança aconteçam mesmo depois de trocar a família ou abrir um rascunho.
    const mostrar = linhas.filter((l) => (rot && l.roteiro_id === rot.id)
      || (l.origem === 'gerador' && PENDENTES_DE_EXIBICAO.has(l.status) && l.entregue_em === null))
      .sort((x, y) => x.cor.localeCompare(y.cor) || x.missao - y.missao || x.geracao - y.geracao);

    // Preço da exibição = o congelado no pedido (é o que a RPC cobra), nunca o do mês.
    const pedidoIds = [...new Set(mostrar.map((l) => l.pedido_id).filter(Boolean))];
    const precoPedido = new Map<string, number>();
    if (pedidoIds.length > 0) {
      const { data: peds, error: eP } = await admin.from('galeria_pedidos').select('id, unit_cents').eq('org_id', orgId).in('id', pedidoIds);
      if (eP) throw new Error(eP.message);
      for (const x of (peds ?? []) as Array<{ id: string; unit_cents: number }>) precoPedido.set(x.id, Number(x.unit_cents));
    }
    const assinar = async (path: string | null | undefined) => {
      if (!path) return null;
      const { data, error } = await admin.storage.from('imagens').createSignedUrl(path, URL_SEG);
      return error ? null : data?.signedUrl ?? null;
    };

    const moda = rot?.moda === true;
    const missoes = missoesDisponiveis(moda, ['frente']);
    const usaGerador = new Map(missoes.map((m) => [m.missao as number, m.usaGerador]));
    // Roteiro aprovado em formato antigo não é plano: as imagens dele aparecem, mas nada novo nasce dele.
    const plano = rot && ehPlano(rot.conteudo) ? rot.conteudo : null;
    const planoId = plano ? (rot!.id as string) : null;
    const indisponivel = new Map((plano?.imagens ?? []).filter((i) => i.indisponivel).map((i) => [i.posicao as number, i.indisponivel!]));
    const posicoes = missoes.map((m) => ({ posicao: m.missao as number, nome: m.nome, ...(indisponivel.has(m.missao) ? { indisponivel: indisponivel.get(m.missao) } : {}) }));
    const imagens = await Promise.all(mostrar.map(async (l) => ({
      id: l.id, cor: l.cor, missao: l.missao, geracao: l.geracao, status: l.status,
      alertas: l.alertas ?? null, erro: l.erro, exibida: l.entregue_em !== null,
      unit_cents: precoPedido.get(l.pedido_id) ?? null,
      url: await assinar(l.cena_path), roteiro_id: l.roteiro_id,
      // Gerar novo só pelo plano vigente.
      pode_gerar_de_novo: planoId !== null && l.roteiro_id === planoId && l.origem === 'gerador'
        && bloqueioDaVaga(linhas, planoId, l.cor, l.missao, usaGerador.get(l.missao) ?? true) === null,
    })));
    return json({
      titulo: a.vigente.titulo_ml ?? a.vigente.nome_pai ?? null, cores: coresDoAnuncio(a), moda: rot ? moda : null, unit_cents: unitCents,
      posicoes, plano_id: planoId, imagens,
    });
  } catch (e) {
    console.error('[galeria-imagens]', (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
