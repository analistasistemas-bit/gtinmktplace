// ADR-0201 (Galeria da cor por IA), Task 7: roteiro. Chamada pela tela com o JWT do operador (verify_jwt = true).
// A tela manda o MLB da linha de Publicados; a edge resolve o anúncio/partição e a família vigente.
// Ações: ler | criar | salvar | aprovar. Validação sempre em código (validarRoteiro); Moda é da edge, pelo path_from_root
// da categoria lida ao vivo. Nunca escreve no Mercado Livre (só GET do item e da categoria).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { carregarAnuncio, coresDoAnuncio, resolverAnuncio, type AnuncioGaleria } from '../_shared/galeria/anuncio.ts';
import { calcularVigencia } from '../_shared/galeria/referencias.ts';
import { conferirEtiqueta } from '../_shared/galeria/etiqueta.ts';
import { cienciaPendente, errosPorMissao, gerarRoteiroIA, sanearRoteiro, validarRoteiro, type Roteiro } from '../_shared/galeria/roteiro.ts';
import { ehModa, type Vista } from '../_shared/galeria/regras.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarItemML } from '../_shared/ml/atualizar-item.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';

type Admin = ReturnType<typeof adminClient>;
type Vigencia = Awaited<ReturnType<typeof calcularVigencia>>;
interface LinhaRoteiro {
  id: string; familia_id: string; versao: number; status: string; moda: boolean; conteudo: Roteiro;
}
const ACOES = new Set(['ler', 'criar', 'salvar', 'aprovar']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null);

/** Vistas com referência cadastrada em pelo menos uma cor (R3.2); o pedido de geração recusa a cor sem ela. */
const vistasDe = (v: Vigencia): Vista[] =>
  (['frente', 'costas', 'lateral'] as Vista[]).filter((vista) => Object.values(v.referencias).some((porVista) => porVista[vista] && !('erro' in porVista[vista])));

/**
 * Categoria lida ao vivo: GET do item no ML → categoria → path_from_root (público). Sem fallback para a categoria
 * gravada na família: qualquer falha → `null` e a ação recusa, sem decidir Moda.
 */
async function lerCategoria(admin: Admin, orgId: string, a: AnuncioGaleria): Promise<{ nome: string; moda: boolean } | null> {
  try {
    const itemId = Object.values(a.itemPorSku)[0];
    if (!itemId) return null;
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx) return null;
    const categoriaId = (await buscarItemML(await getValidAccessTokenConexao(cx), itemId)).categoriaId;
    if (!categoriaId) return null;
    const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const cat = await r.json() as { name?: unknown; path_from_root?: Array<{ id: string; name?: string }> };
    if (!Array.isArray(cat.path_from_root) || cat.path_from_root.length === 0) return null;
    return { nome: typeof cat.name === 'string' ? cat.name : categoriaId, moda: ehModa(cat.path_from_root) };
  } catch (e) {
    console.error('[galeria-roteiro] categoria', (e as Error).message);
    return null;
  }
}

async function proximaVersao(admin: Admin, orgId: string, a: AnuncioGaleria): Promise<number> {
  const { data, error } = await admin.from('galeria_roteiros').select('versao')
    .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('familia_id', a.vigente.id)
    .order('versao', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.versao ?? 0) + 1;
}

/** Novo rascunho (versão seguinte da família vigente). Corrida com outra aba → 23505 → `null`. */
async function inserirRascunho(
  admin: Admin, orgId: string, userId: string, a: AnuncioGaleria, conteudo: Roteiro, moda: boolean, fatosHash: string,
): Promise<LinhaRoteiro | null> {
  const { data, error } = await admin.from('galeria_roteiros').insert({
    org_id: orgId, anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, versao: await proximaVersao(admin, orgId, a),
    conteudo, fatos_hash: fatosHash, moda, status: 'rascunho', criado_por: userId,
  }).select().single();
  if (error?.code === '23505') return null;
  if (error) throw new Error(error.message);
  return data as LinhaRoteiro;
}

/** Vigência com a mesma conferência da etiqueta do `montar` (visão só quando o cache da leitura venceu). */
const vigencia = (admin: Admin, orgId: string, a: AnuncioGaleria) =>
  calcularVigencia(admin, orgId, a, (ctx) => conferirEtiqueta(admin, orgId, a, ctx));

/** `erros` + `erros_por_missao`: a tela mostra o erro na missão (que segue ativa) até o operador corrigir ou desativar. */
const resposta = (linha: LinhaRoteiro, v: Vigencia, a: AnuncioGaleria) => {
  const erros = validarRoteiro(linha.conteudo, v.fatos, linha.moda, vistasDe(v), coresDoAnuncio(a));
  return { roteiro: linha, erros, erros_por_missao: errosPorMissao(erros), ciencia_pendente: cienciaPendente(linha.conteudo, v.fatos), fatos: v.fatos };
};

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
  // ADR-0201 §8 (revisão geral): modelo de texto e escrita do roteiro por conta da Daludi → exige o módulo imagem_ia (fail-closed).
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) return json({ error: 'modulo_desligado' }, 403);
  try {
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);
    if (acao === 'ler') {
      // Roteiro vigente da família vigente: a versão mais alta (rascunho mais novo que o aprovado vence; senão o aprovado).
      // Moda ao vivo, sem fallback do banco: leitura falhou → moda null + aviso, a tela segue.
      const cat = await lerCategoria(admin, orgId, a);
      const moda = cat ? cat.moda : null;
      const aviso = cat ? undefined : 'categoria_indisponivel';
      const { data: vigente, error: eL } = await admin.from('galeria_roteiros').select('id, familia_id, versao, status, moda, conteudo')
        .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('familia_id', a.vigente.id)
        .in('status', ['rascunho', 'aprovado', 'desatualizado'])
        .order('versao', { ascending: false }).limit(1).maybeSingle();
      if (eL) throw new Error(eL.message);
      if (!vigente) return json({ roteiro: null, moda, familia_id: a.vigente.id, ...(aviso ? { aviso } : {}) });
      return json({ ...resposta(vigente as LinhaRoteiro, await vigencia(admin, orgId, a), a), moda, familia_id: a.vigente.id, ...(aviso ? { aviso } : {}) });
    }

    // Trabalho novo só na família vigente (a tela manda a que mostrou).
    if (body.familia_id !== a.vigente.id) return json({ error: 'familia_nao_vigente', familia_id_vigente: a.vigente.id }, 409);

    if (acao === 'criar') {
      const v = await vigencia(admin, orgId, a);
      const divergentes = v.fatos.filter((f) => f.estado === 'DIVERGENTE').map((f) => f.campo);
      if (divergentes.length > 0) return json({ error: 'fato_divergente', campos: divergentes }, 409);
      const cat = await lerCategoria(admin, orgId, a);
      if (!cat) return json({ error: 'categoria_indisponivel' }, 503);
      let conteudo: Roteiro;
      try {
        conteudo = await gerarRoteiroIA({
          modelo: await resolverModeloTexto(admin, orgId), categoria: cat.nome, moda: cat.moda, vistas: vistasDe(v), fatos: v.fatos,
          cores: coresDoAnuncio(a),
        });
      } catch (e) {
        console.error('[galeria-roteiro] modelo', (e as Error).message);
        return json({ error: 'roteiro_ia_falhou' }, 502);
      }
      const linha = await inserirRascunho(admin, orgId, userId, a, conteudo, cat.moda, v.fatos_hash);
      return linha ? json(resposta(linha, v, a)) : json({ error: 'conflito_versao' }, 409);
    }

    const roteiroId = texto(body.roteiro_id, 64);
    const { data: achado, error: eR } = roteiroId
      ? await admin.from('galeria_roteiros').select('id, familia_id, versao, status, moda, conteudo')
        .eq('id', roteiroId).eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).maybeSingle()
      : { data: null, error: null };
    if (eR) throw new Error(eR.message);
    if (!achado) return json({ error: 'roteiro_nao_encontrado' }, 404);
    const linha = achado as LinhaRoteiro;
    if (linha.familia_id !== a.vigente.id) return json({ error: 'familia_nao_vigente', familia_id_vigente: a.vigente.id }, 409);

    if (acao === 'salvar') {
      // Categoria e Moda são da edge (gravadas no criar); a ciência só o `aprovar` grava.
      const conteudo = sanearRoteiro(body.conteudo, linha.conteudo.categoria);
      if (!conteudo) return json({ error: 'conteudo_invalido' }, 400);
      const v = await vigencia(admin, orgId, a);
      if (linha.status === 'rascunho') {
        const { data, error } = await admin.from('galeria_roteiros').update({ conteudo })
          .eq('id', linha.id).eq('org_id', orgId).eq('status', 'rascunho').select();
        if (error) throw new Error(error.message);
        if (data && data.length > 0) return json(resposta(data[0] as LinhaRoteiro, v, a));
        // Aprovado por outra aba entre a leitura e o update: segue como edição de versão aprovada.
      }
      // Roteiro aprovado (ou desatualizado) é imutável: a edição vira a versão seguinte, em rascunho.
      const nova = await inserirRascunho(admin, orgId, userId, a, conteudo, linha.moda, v.fatos_hash);
      return nova ? json(resposta(nova, v, a)) : json({ error: 'conflito_versao' }, 409);
    }

    // aprovar
    if (linha.status !== 'rascunho') return json({ error: 'nao_rascunho' }, 409);
    // Moda ao vivo de novo: se a categoria mudou de lado desde o criar, o roteiro não vale (texto × sem texto).
    const cat = await lerCategoria(admin, orgId, a);
    if (!cat) return json({ error: 'categoria_indisponivel' }, 503);
    if (cat.moda !== linha.moda) return json({ error: 'categoria_mudou', moda: cat.moda }, 409);
    // fatos_hash pela MESMA chamada do `montar` (calcularVigencia + conferência da etiqueta): sem a conferência,
    // leitura velha daria outro hash e o próximo `montar` desatualizaria o roteiro na hora. DIVERGENTE nova
    // reprova a aprovação (R1.3).
    const v = await vigencia(admin, orgId, a);
    const erros = validarRoteiro(linha.conteudo, v.fatos, linha.moda, vistasDe(v), coresDoAnuncio(a));
    if (erros.length > 0) return json({ error: 'roteiro_invalido', erros, erros_por_missao: errosPorMissao(erros) }, 422);
    let conteudo = linha.conteudo;
    const pendentes = cienciaPendente(conteudo, v.fatos);
    if (pendentes.length > 0) {
      // R1.3: o operador marca ciência, campo a campo, do que não foi conferido na etiqueta.
      const ciente = new Set(Array.isArray(body.ciencia_nao_conferido) ? body.ciencia_nao_conferido : []);
      const faltam = pendentes.filter((c) => !ciente.has(c));
      if (faltam.length > 0) return json({ error: 'ciencia_pendente', campos: faltam }, 409);
      const campos = [...new Set([...(conteudo.ciencia_nao_conferido?.campos ?? []), ...pendentes])].sort();
      conteudo = { ...conteudo, ciencia_nao_conferido: { campos, por: userId, em: new Date().toISOString() } };
    }
    const { data: codigo, error } = await admin.rpc('galeria_aprovar_roteiro', {
      // p_conteudo_lido: o que foi validado; salvo no meio → conteudo_mudou, sem gravar.
      p_org: orgId, p_roteiro: linha.id, p_familia: a.vigente.id, p_fatos_hash: v.fatos_hash,
      p_conteudo_lido: linha.conteudo, p_conteudo: conteudo, p_usuario: userId,
    });
    if (error) throw new Error(error.message);
    if (codigo !== 'ok') return json({ error: codigo }, 409);
    return json({ roteiro_id: linha.id, status: 'aprovado', fatos_hash: v.fatos_hash });
  } catch (e) {
    console.error('[galeria-roteiro]', acao, (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
