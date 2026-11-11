// Plano vigente do anúncio (ADR-0203 §2, §4, §9): reaproveita o aprovado que ainda vale ou pede um novo à IA, grava
// como rascunho e aprova pela RPC `galeria_aprovar_roteiro` (mesmo caminho do ADR-0201: vigência, cobrança e saga
// seguem sem migration). Chamada só depois de elegibilidade, preço e referências: nenhuma recusa anterior paga IA.
// `admin` entra por parâmetro (só tipo importado) para os testes não carregarem `supabase.ts`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { coresDoAnuncio, type AnuncioGaleria } from './anuncio.ts';
import { gerarPlanoIA, hashDados, type DadosPlanejador } from './planejador.ts';
import { ehPlano, type Plano } from './plano.ts';
import { ehModa } from './regras.ts';

export type AtributoML = { id: string; name: string; value_name: string | null };
type ErroPlano = 'plano_ia_falhou' | 'plano_invalido' | 'categoria_indisponivel' | 'ml_indisponivel';
interface Aprovado { id: string; familia_id: string; fatos_hash: string; moda: boolean; conteudo: unknown }

const IDS_FORA = new Set(['COLOR', 'MAIN_COLOR', 'SIZE', 'GTIN', 'SELLER_SKU', 'ITEM_CONDITION']);
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Ficha do anúncio para o planejador (ADR-0203 §4): sem variação (cor, tamanho, GTIN, SKU), sem embalagem/vendor,
 * sem valor vazio e sem nenhum valor igual a uma cor do anúncio. Chaves em ordem alfabética: o `dados_hash` é estável.
 */
export function filtrarFicha(atributos: AtributoML[], cores: string[]): Record<string, string> {
  const nomesCor = new Set(cores.map(norm));
  const ok = atributos.filter((x) => typeof x.name === 'string' && typeof x.value_name === 'string' && x.value_name.trim() !== ''
    && !IDS_FORA.has(x.id) && !/embalagem|vendor/.test(norm(x.name)) && !nomesCor.has(norm(x.value_name)));
  // Nome repetido: ordena por nome e valor para o último vencer sempre o mesmo.
  ok.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : x.value_name! < y.value_name! ? -1 : x.value_name! > y.value_name! ? 1 : 0));
  return Object.fromEntries(ok.map((x) => [x.name, x.value_name!]));
}

export async function garantirPlano(admin: SupabaseClient, p: {
  orgId: string; userId: string; a: AnuncioGaleria; fatosHash: string; refUrl: string; confirmarTroca: boolean; modelo: string;
  lerFichaML: () => Promise<AtributoML[] | null>;
  lerCategoria: (id: string) => Promise<Array<{ id: string }> | null>;
  planejar?: typeof gerarPlanoIA;
}): Promise<{ roteiroId: string; plano: Plano; moda: boolean }
  | { erro: ErroPlano }
  | { erro: 'plano_desatualizado'; imagens: number }> {
  const { orgId, a } = p;
  const lerAprovado = async (): Promise<Aprovado | null> => {
    const { data, error } = await admin.from('galeria_roteiros').select('id, familia_id, fatos_hash, moda, conteudo')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('status', 'aprovado').maybeSingle();
    if (error) throw new Error(error.message);
    return data as Aprovado | null;
  };

  const cores = coresDoAnuncio(a);
  // As duas leituras no ML em paralelo: a edge tem 150 s e o planejador pode levar 90.
  const [atributos, path] = await Promise.all([
    p.lerFichaML(),
    a.vigente.categoria_ml_id ? p.lerCategoria(a.vigente.categoria_ml_id) : Promise.resolve(null),
  ]);
  if (!atributos) return { erro: 'ml_indisponivel' };
  const dados: DadosPlanejador = {
    nome: a.vigente.nome_pai ?? '', descricao_fornecedor: a.vigente.descricao_pai ?? null, marca: a.vigente.marca ?? null,
    ficha_do_anuncio: filtrarFicha(atributos, cores), total_de_cores: cores.length, conteudo_da_embalagem: '1 unidade na cor escolhida',
  };
  const dadosHash = hashDados(dados);
  if (!path) return { erro: 'categoria_indisponivel' };
  const moda = ehModa(path);

  // Único critério de "ainda vale" (passo 4 e as duas releituras). Moda entra: plano com texto nunca serve a Moda.
  const serve = (r: Aprovado | null): r is Aprovado & { conteudo: Plano } => !!r && ehPlano(r.conteudo)
    && r.familia_id === a.vigente.id && r.fatos_hash === p.fatosHash && r.conteudo.dados_hash === dadosHash
    && (r.moda === true) === moda;
  // `moda` é o da linha gravada: foi com ele que o plano foi validado.
  const usar = (r: Aprovado & { conteudo: Plano }) => ({ roteiroId: r.id, plano: r.conteudo, moda: r.moda === true });

  const atual = await lerAprovado();
  if (serve(atual)) return usar(atual);

  // Troca de plano formato 2 com imagens já exibidas (cobradas) e não aplicadas: só com confirmação (§9). Mesma
  // exclusão da RPC galeria_aprovar_roteiro (manifesto de aplicação `aplicada`).
  if (atual && ehPlano(atual.conteudo) && !p.confirmarTroca) {
    const { data: imgs, error: eI } = await admin.from('galeria_imagens').select('id')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('roteiro_id', atual.id)
      .in('status', ['gerada', 'aprovada']).not('entregue_em', 'is', null);
    if (eI) throw new Error(eI.message);
    if ((imgs ?? []).length > 0) {
      const { data: apls, error: eA } = await admin.from('galeria_aplicacoes').select('manifesto')
        .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('status', 'aplicada');
      if (eA) throw new Error(eA.message);
      const aplicadas = new Set(((apls ?? []) as Array<{ manifesto: unknown }>).flatMap((x) =>
        (Array.isArray(x.manifesto) ? x.manifesto : []).map((m) => String((m as { imagem_id?: unknown })?.imagem_id))));
      const n = (imgs as Array<{ id: string }>).filter((i) => !aplicadas.has(String(i.id))).length;
      if (n > 0) return { erro: 'plano_desatualizado', imagens: n };
    }
  }

  const r = await (p.planejar ?? gerarPlanoIA)({ modelo: p.modelo, dados, refUrl: p.refUrl, moda, cores });
  if ('erro' in r) {
    console.error('[galeria] plano', r.erro, r.erros ?? []);
    return { erro: r.erro };
  }
  const plano = r.plano;

  // Outra aba criou o plano enquanto a IA respondia: usa o dela, sem inserir.
  const depois = await lerAprovado();
  if (serve(depois)) return usar(depois);

  const { data: ult, error: eV } = await admin.from('galeria_roteiros').select('versao')
    .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).order('versao', { ascending: false }).limit(1).maybeSingle();
  if (eV) throw new Error(eV.message);
  const { data: novo, error: eIns } = await admin.from('galeria_roteiros').insert({
    org_id: orgId, anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, versao: ((ult?.versao as number | undefined) ?? 0) + 1,
    conteudo: plano, fatos_hash: p.fatosHash, moda, status: 'rascunho', criado_por: p.userId,
  }).select('id').single();
  if (eIns?.code === '23505') {
    const outro = await lerAprovado();
    if (serve(outro)) return usar(outro);
    console.error('[galeria] plano: versão disputada sem plano que sirva');
    return { erro: 'plano_ia_falhou' };
  }
  if (eIns || !novo) throw new Error(eIns?.message ?? 'rascunho do plano não gravado');
  const roteiroId = (novo as { id: string }).id;

  const { data: codigo, error: eRpc } = await admin.rpc('galeria_aprovar_roteiro', {
    p_org: orgId, p_roteiro: roteiroId, p_familia: a.vigente.id, p_fatos_hash: p.fatosHash,
    p_conteudo_lido: plano, p_conteudo: plano, p_usuario: p.userId,
  });
  if (eRpc || codigo !== 'ok') {
    console.error('[galeria] aprovar plano', eRpc?.message ?? codigo);
    // Guarda de status: se a RPC aprovou e só a resposta se perdeu, o aprovado não é apagado.
    const { error: eDel } = await admin.from('galeria_roteiros').delete().eq('id', roteiroId).eq('org_id', orgId).eq('status', 'rascunho');
    if (eDel) console.error('[galeria] apagar rascunho do plano', eDel.message);
    return { erro: 'plano_ia_falhou' };
  }
  return { roteiroId, plano, moda };
}
