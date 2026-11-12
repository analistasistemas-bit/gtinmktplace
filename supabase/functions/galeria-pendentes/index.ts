// ADR-0201 (Galeria da cor por IA): "o que falta aplicar". Chamada pela aba "Imagens IA" de Publicados com o JWT do
// operador (verify_jwt = true). Só leitura: nunca grava, nunca cobra, nunca chama o ML. Devolve uma linha por anúncio e
// cor com imagens aprovadas ainda não aplicadas (e quantas esperam aprovação). Regra em _shared/galeria/pendentes.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { agruparPendentes, type AplicacaoLinha, type ImagemLinha } from '../_shared/galeria/pendentes.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Admin = ReturnType<typeof adminClient>;
const PAGINA = 1000;

/** PostgREST corta em 1000 linhas: lê por páginas até esgotar. */
async function paginar<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    saida.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return saida;
  }
}
const blocos = <T>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, (k + 1) * n));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'read' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = auth;
  const admin: Admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) return json({ error: 'modulo_desligado' }, 403);

  try {
    const roteiros = await paginar<{ id: string; anuncio_externo_id: string }>((de, ate) =>
      admin.from('galeria_roteiros').select('id, anuncio_externo_id').eq('org_id', orgId).eq('status', 'aprovado').range(de, ate));
    const roteiroAprovado = new Map(roteiros.map((r) => [r.anuncio_externo_id, r.id]));
    if (roteiroAprovado.size === 0) return json({ pendentes: [] });

    const [imagens, aplicacoes] = await Promise.all([
      paginar<ImagemLinha>((de, ate) => admin.from('galeria_imagens').select('id, anuncio_externo_id, cor, status, roteiro_id, missao')
        .eq('org_id', orgId).in('status', ['aprovada', 'gerada']).in('roteiro_id', roteiros.map((r) => r.id)).range(de, ate)),
      paginar<AplicacaoLinha>((de, ate) => admin.from('galeria_aplicacoes').select('anuncio_externo_id, cor, status, manifesto')
        .eq('org_id', orgId).in('status', ['aplicada', 'em_andamento']).range(de, ate)),
    ]);
    const grupos = agruparPendentes(imagens, aplicacoes, roteiroAprovado);
    if (grupos.length === 0) return json({ pendentes: [] });

    // MLB de cada anúncio (Legacy: o da partição; UP: um filho vivo) e título da família publicada mais nova.
    const ids = [...new Set(grupos.map((g) => g.anuncio_externo_id))];
    const anuncios: Array<{ id: string; codigo_pai: string; item_externo_id: string | null }> = [];
    const filhos: Array<{ anuncio_externo_id: string; item_externo_id: string | null }> = [];
    for (const b of blocos(ids)) {
      const [{ data: a, error: eA }, { data: f, error: eF }] = await Promise.all([
        admin.from('anuncios_externos').select('id, codigo_pai, item_externo_id').eq('org_id', orgId).in('id', b),
        admin.from('anuncios_externos_itens').select('anuncio_externo_id, item_externo_id').eq('org_id', orgId).eq('retirado', false).in('anuncio_externo_id', b),
      ]);
      if (eA || eF) throw new Error((eA ?? eF)!.message);
      anuncios.push(...(a ?? []));
      filhos.push(...(f ?? []));
    }
    const titulos = new Map<string, string>();
    for (const b of blocos([...new Set(anuncios.map((a) => a.codigo_pai))])) {
      const { data, error } = await admin.from('familias').select('codigo_pai, titulo_ml, nome_pai')
        .eq('org_id', orgId).in('codigo_pai', b).not('publicado_em', 'is', null).order('publicado_em', { ascending: false });
      if (error) throw new Error(error.message);
      for (const f of (data ?? []) as Array<{ codigo_pai: string; titulo_ml: string | null; nome_pai: string | null }>) {
        if (!titulos.has(f.codigo_pai)) titulos.set(f.codigo_pai, f.titulo_ml ?? f.nome_pai ?? f.codigo_pai);
      }
    }
    const porId = new Map(anuncios.map((a) => [a.id, a]));
    const pendentes = grupos.flatMap((g) => {
      const an = porId.get(g.anuncio_externo_id);
      const mlItemId = an?.item_externo_id ?? filhos.find((f) => f.anuncio_externo_id === g.anuncio_externo_id && f.item_externo_id)?.item_externo_id ?? null;
      if (!an || !mlItemId) return [];   // sem MLB não há link para a galeria
      return [{ ml_item_id: mlItemId, titulo: titulos.get(an.codigo_pai) ?? an.codigo_pai, cor: g.cor,
        prontas: g.prontas, aguardando_aprovacao: g.aguardando_aprovacao, aplicando: g.aplicando }];
    });
    return json({ pendentes });
  } catch (e) {
    console.error('[galeria-pendentes]', (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
