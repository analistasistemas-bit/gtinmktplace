// Saga de aplicar e reverter da galeria (ADR-0201, Task 14; Global Constraints "Trava de escrita por MLB", "PUT
// incerto", "Encerramento atômico", "Upload foto a foto", "Vigência", "Claim", "Posse"). O worker executa UMA fase por
// mensagem, decidida pela linha (nunca por `msg.acao`); a fase de envio sobe todas as fotos pendentes no mesmo lease,
// uma gravação por foto (ADR-0201 (k)): claim atômico dentro do ciclo (`galeria_assumir_item`), toda
// gravação condicionada à posse, todo estado terminal por `galeria_concluir_item` (aborto, agregação e soltura da trava
// na mesma transação). Nunca publica nada: o despachante encontra a próxima ação.
//
// Ida: fotos_antes (gravado no preparar) → fotos em laço (marca `enviando` ANTES do POST: queda com a marca e sem
// id = upload incerto → falhou, nunca re-sobe às cegas) → espera todas prontas → GET + plano (portão de avanço relido)
// → grava corpo_planejado/base/destino/put_em → PUT → GET de conferência → aplicado com os ids lidos no GET.
// PUT sem resposta, timeout ou 5xx → continua `aplicando` e a reconciliação por GET decide (destino → concluído; base →
// espera 10 min e refaz, ou `pulado` com o portão fechado; outra coisa → reversao_incompleta; GET indisponível 30 min →
// reversao_incompleta). Volta (compensando): sem portão de avanço; trava, compensar_ate e a conferência das fotos.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { CorpoFotosML } from '../ml/atualizar-item.ts';
import { atualizarFotosItemML } from '../ml/atualizar-item.ts';
import { lerFotoProntaML, subirFotoMLArquivo } from '../ml/fotos.ts';
import { lerElegibilidadeItemML, type Alvo, type ItemElegibilidade } from './alvos.ts';
import { fotosDaCorNoItem, planejarFotosItem, type FotosPorSku, type RetratoItem } from './aplicar.ts';
import { createHash } from 'node:crypto';

export const LEASE_S = 150;
export const ASSENTAMENTO_MS = 10 * 60_000;
export const GET_INDISPONIVEL_MS = 30 * 60_000;
export const COMPENSAR_MS = 60 * 60_000;
/** Foto nova só começa com menos de 60 s de execução: sobram 90 s do lease (150 s) para o pior caso de uma foto (POST 30 s). */
export const ORCAMENTO_SUBIDA_MS = 60_000;
/** ponytail: limites fixos do ML (10 por variação, 12 por item sem variações); ler da categoria ao vivo se o ML mudar. */
export const LIMITE_VAR = 10;
export const LIMITE_ITEM = 12;

// Mesmo hash de `sha256Hex` (referencias.ts), sem carregar a cadeia de referências/conexão no worker.
const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const EXECUCAO = new Set(['em_andamento', 'abortando', 'revertendo']);

/** Uploads recusados com 429 por foto antes de falhar a aplicação (1 min entre tentativas, o prazo da aplicação segue valendo). */
export const MAX_429_POR_FOTO = 5;
export interface FotoNova { imagem_id: string; missao: number; final_sha256: string; upload_id: string | null; pronta: boolean; enviando?: boolean; tentativas?: number }
export interface ItemSaga {
  id: string; org_id: string; anuncio_externo_id: string | null; aplicacao_id: string; item_id: string; status: string;
  fase: number; posse: string | null; lease_ate: string | null; put_em: string | null; compensar_ate: string | null;
  fotos_antes: FotosPorSku | null; fotos_novas: FotoNova[] | null; fotos_depois: FotosPorSku | null;
  variacoes_alvo: Alvo['variacoes'] | null; corpo_planejado: { direcao: 'ida' | 'volta'; corpo: CorpoFotosML } | null;
  base_esperada: FotosPorSku | null; destino: FotosPorSku | null;
}
export interface AplicacaoSaga {
  id: string; org_id: string; anuncio_externo_id?: string | null; familia_id?: string; status: string;
  modo: 'substituir' | 'adicionar'; roteiro_id: string; fatos_hash: string;
  prazo_ate: string | null; abortar_em: string | null; retrato: Record<string, RetratoItem> | null;
}

export type Passo = 'subir' | 'put' | 'conferir' | 'concluir' | 'pular' | 'compensar' | 'marcar_incompleta' | 'abortar' | 'ignorar' | 'ocupado';
/** `vigente`: o roteiro da aplicação ainda é o aprovado com o mesmo fatos_hash. Família vigente não entra (só no confirmar). */
export interface CtxPasso { agora: Date; vigente: boolean; trava: boolean }

const ms = (iso: string | null) => (iso == null ? null : Date.parse(iso));

/** Portão de avanço (só a ida): aplicação fora de em_andamento, abortar_em, prazo vencido ou roteiro/fatos trocados. */
export function portaoFechado(a: AplicacaoSaga, ctx: Pick<CtxPasso, 'agora' | 'vigente'>): string | null {
  if (a.status !== 'em_andamento' || a.abortar_em != null) return 'abortada';
  if (a.prazo_ate != null && ms(a.prazo_ate)! < ctx.agora.getTime()) return 'prazo_vencido';
  return ctx.vigente ? null : 'roteiro_trocado';
}

/** Puro. Decide a fase pela linha. `concluir` não sai daqui (é desfecho de `conferir`/`put`). */
export function passoSaga(item: ItemSaga, aplicacao: AplicacaoSaga, ctx: CtxPasso): Passo {
  if (!EXECUCAO.has(aplicacao.status)) return 'ignorar';
  if (item.lease_ate != null && ms(item.lease_ate)! >= ctx.agora.getTime()) return 'ocupado';
  // Sem a trava `galeria` do item ninguém escreve (o relógio no banco encerra a saga).
  if (!ctx.trava) return 'ignorar';
  if (item.status === 'compensando') {
    return item.compensar_ate != null && ms(item.compensar_ate)! < ctx.agora.getTime() ? 'marcar_incompleta' : 'compensar';
  }
  if (item.status === 'aplicando') return 'conferir';
  if (item.status !== 'pendente' && item.status !== 'subindo') return 'ignorar';
  if (portaoFechado(aplicacao, ctx)) return 'pular';
  const fotos = item.fotos_novas ?? [];
  const proxima = fotos.find((f) => !f.upload_id);
  if (proxima?.enviando) return 'abortar';   // POST saiu e a resposta se perdeu: upload incerto
  if (proxima || fotos.some((f) => !f.pronta)) return 'subir';
  return 'put';
}

const igual = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export function mesmasFotos(a: FotosPorSku | null, b: FotosPorSku | null): boolean {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  return igual(ka, Object.keys(b).sort()) && ka.every((k) => Array.isArray(a[k]) && Array.isArray(b[k]) && igual(a[k], b[k]));
}

/**
 * Puro. Reconciliação por GET (ida e volta). `atual` null = GET indisponível. `putEm` null = nenhum PUT desta
 * direção saiu (a janela de assentamento não se aplica). `podeRefazer` = portão aberto (ida) / sempre (volta).
 */
export function decidirReconciliacao(r: {
  atual: FotosPorSku | null; getOk: boolean; base: FotosPorSku | null; destino: FotosPorSku | null;
  putEm: string | null; desde: number; agora: Date; podeRefazer: boolean;
}): 'concluir' | 'esperar' | 'refazer' | 'pular' | 'incompleta' {
  const t = r.agora.getTime();
  if (!r.getOk) return t - r.desde > GET_INDISPONIVEL_MS ? 'incompleta' : 'esperar';
  if (mesmasFotos(r.atual, r.destino)) return 'concluir';
  if (mesmasFotos(r.atual, r.base)) {
    if (r.putEm != null && t - ms(r.putEm)! < ASSENTAMENTO_MS) return 'esperar';
    return r.podeRefazer ? 'refazer' : 'pular';
  }
  return 'incompleta';
}

/** Fotos de cada SKU-alvo como o corpo planejado as deixa (o `destino` do PUT). */
function destinoDoCorpo(corpo: CorpoFotosML, alvos: Alvo['variacoes']): FotosPorSku | null {
  return fotosDaCorNoItem({
    pictures: corpo.pictures.map((p) => p.id),
    variacoes: (corpo.variations ?? []).map((v) => ({ id: v.id, sku: null, pictureIds: v.picture_ids })),
  }, alvos);
}

/** Demais variações (fora da cor-alvo) como o corpo as enviou. */
function outrasIntactas(atual: ItemElegibilidade, corpo: CorpoFotosML, alvos: Alvo['variacoes']): boolean {
  const alvo = new Set(alvos.map((a) => a.variationId));
  return (corpo.variations ?? []).filter((v) => !alvo.has(v.id))
    .every((v) => igual(atual.variacoes.find((x) => x.id === v.id)?.pictureIds ?? ['∅'], v.picture_ids));
}

export interface PortasML {
  lerItem(token: string, itemId: string): Promise<ItemElegibilidade | null>;
  subir(token: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<{ id: string; pronta: boolean }>;
  lerFotoPronta(token: string, pictureId: string): Promise<boolean | null>;
  putFotos(token: string, itemId: string, corpo: CorpoFotosML): Promise<void>;
}
export const PORTAS_ML: PortasML = {
  lerItem: lerElegibilidadeItemML,
  subir: (t, b, m) => subirFotoMLArquivo(t, b, m),
  lerFotoPronta: (t, id) => lerFotoProntaML(t, id),
  putFotos: (t, id, c) => atualizarFotosItemML(t, id, c),
};
export interface DepsSaga { agora: () => Date; token: (orgId: string) => Promise<string>; ml?: PortasML }

export type ResultadoSaga =
  | 'ignorar' | 'ocupado' | 'perdeu_posse' | 'esperar' | 'subiu' | 'pronta' | 'aguardando_pronta' | 'aplicando'
  | 'aplicado' | 'compensando' | 'compensado' | 'falhou' | 'pulado' | 'reversao_incompleta';

const statusHttp = (e: unknown) => (e as { status?: number } | null)?.status;

export async function executarItem(admin: SupabaseClient, msg: { id: string; fase: number }, deps: DepsSaga): Promise<ResultadoSaga> {
  const ml = deps.ml ?? PORTAS_ML;
  const posse = crypto.randomUUID();
  const { data: assumidos, error: eA } = await admin.rpc('galeria_assumir_item',
    { p_item: msg.id, p_fase: msg.fase, p_posse: posse, p_lease_seg: LEASE_S });
  if (eA) throw new Error(`galeria_assumir_item: ${eA.message}`);
  const item = ((assumidos ?? []) as ItemSaga[])[0];
  if (!item) return 'ocupado';   // fase velha, lease vigente, item terminal, aplicação fora do ciclo ou não executável

  const agora = deps.agora();
  const tab = () => admin.from('galeria_aplicacao_itens');
  /** Gravação condicionada à posse; `fim` solta o lease e zera publicado_em (volta no próximo tick do despachante). */
  const gravar = async (campos: Record<string, unknown>, fim: boolean): Promise<boolean> => {
    const extra = fim ? { posse: null, lease_ate: null, publicado_em: null } : {};
    const { data, error } = await tab().update({ ...campos, ...extra, atualizado_em: agora.toISOString() })
      .eq('id', item.id).eq('posse', posse).select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  };
  const soltar = async (r: ResultadoSaga, avancar = false): Promise<ResultadoSaga> =>
    (await gravar(avancar ? { fase: item.fase + 1 } : {}, true)) ? r : 'perdeu_posse';
  const concluir = async (status: 'aplicado' | 'falhou' | 'pulado' | 'compensado' | 'reversao_incompleta', dados: Record<string, unknown> = {}) => {
    const { error } = await admin.rpc('galeria_concluir_item', { p_item: item.id, p_posse: posse, p_status: status, p_dados: dados });
    if (error) throw new Error(`galeria_concluir_item: ${error.message}`);
    return status;
  };

  const [{ data: apl, error: eP }, { data: trava, error: eT }] = await Promise.all([
    admin.from('galeria_aplicacoes').select('id, org_id, anuncio_externo_id, familia_id, status, modo, roteiro_id, fatos_hash, prazo_ate, abortar_em, retrato')
      .eq('id', item.aplicacao_id).maybeSingle(),
    admin.from('ml_item_travas').select('dono_tipo, dono_id').eq('org_id', item.org_id).eq('item_id', item.item_id).maybeSingle(),
  ]);
  if (eP || eT) throw new Error((eP ?? eT)!.message);
  if (!apl) return soltar('ignorar');
  const aplicacao = apl as AplicacaoSaga;
  const minhaTrava = (t: unknown) => (t as { dono_tipo?: string; dono_id?: string } | null)?.dono_tipo === 'galeria'
    && (t as { dono_id?: string }).dono_id === aplicacao.id;
  // Vigência por proxy (desvio registrado): o roteiro da aplicação ainda é o aprovado do anúncio com o mesmo fatos_hash
  // (galeria-fatos e galeria-roteiro desatualizam o aprovado quando fatos/referências mudam ou outro é aprovado).
  // Família vigente do anúncio NÃO entra (revisão T14): é checada no `confirmar` (RPC); um import só de estoque que
  // publique outra família no meio da ida não aborta nem compensa a galeria já confirmada.
  const roteiroVigente = async (fatosHash: string) => {
    const { data: rot, error: eR } = await admin.from('galeria_roteiros').select('status, fatos_hash').eq('id', aplicacao.roteiro_id).maybeSingle();
    if (eR) throw new Error(eR.message);
    return rot?.status === 'aprovado' && rot.fatos_hash === fatosHash;
  };
  const vigente = await roteiroVigente(aplicacao.fatos_hash);
  // O lease agora é meu (claim acima): a decisão olha a linha como estava antes dele.
  const passo = passoSaga({ ...item, lease_ate: null }, aplicacao, { agora, vigente, trava: minhaTrava(trava) });

  if (passo === 'ignorar' || passo === 'ocupado') return soltar(passo);
  if (passo === 'pular') {
    return concluir('pulado', { erro: portaoFechado(aplicacao, { agora, vigente }), abortar: true });
  }
  if (passo === 'abortar') return concluir('falhou', { erro: 'upload_incerto' });
  if (passo === 'marcar_incompleta') return concluir('reversao_incompleta', { erro: 'compensar_ate_vencido' });

  const alvos = item.variacoes_alvo ?? [];
  const token = await deps.token(item.org_id);
  /** Confere no banco, imediatamente antes de cada PUT, que a trava `galeria` do item ainda é desta aplicação. */
  const travaAinda = async () => {
    const { data, error } = await admin.from('ml_item_travas').select('dono_tipo, dono_id')
      .eq('org_id', item.org_id).eq('item_id', item.item_id).maybeSingle();
    if (error) throw new Error(error.message);
    return minhaTrava(data);
  };
  const portaoRelido = async (): Promise<string | null> => {
    const { data: a, error } = await admin.from('galeria_aplicacoes').select('status, prazo_ate, abortar_em, fatos_hash')
      .eq('id', aplicacao.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) return 'abortada';
    const atual = { ...aplicacao, ...(a as Partial<AplicacaoSaga>) };
    return portaoFechado(atual, { agora: deps.agora(), vigente: await roteiroVigente(atual.fatos_hash) });
  };
  const concluirAplicado = async (lido: ItemElegibilidade) => {
    const depois = fotosDaCorNoItem(lido, alvos)!;
    const ids = new Set(Object.values(depois).flat());
    // Id lido no GET (o ensaio provou id do upload = id no item); antes do concluir: queda nunca deixa foto sem registro.
    const linhas = (item.fotos_novas ?? []).filter((f) => f.upload_id && ids.has(f.upload_id)).map((f) => ({
      org_id: item.org_id, anuncio_externo_id: item.anuncio_externo_id, imagem_id: f.imagem_id, aplicacao_id: item.aplicacao_id,
      item_id: item.item_id, upload_id: f.upload_id, picture_id: f.upload_id,
    }));
    if (linhas.length > 0) {
      const { error } = await admin.from('galeria_imagem_itens')
        .upsert(linhas, { onConflict: 'imagem_id,item_id,aplicacao_id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return concluir('aplicado', { fotos_depois: depois });
  };

  // ── Volta ──────────────────────────────────────────────────────────────────────────────────────────────────────
  if (passo === 'compensar') {
    const retrato = aplicacao.retrato?.[item.item_id];
    const entrada = ms(item.compensar_ate)! - COMPENSAR_MS;
    const voltaSaiu = item.corpo_planejado?.direcao === 'volta' && item.put_em != null && ms(item.put_em)! >= entrada;
    const lido = await ml.lerItem(token, item.item_id);
    const atual = lido ? fotosDaCorNoItem(lido, alvos) : null;
    const d = decidirReconciliacao({
      atual, getOk: !!lido, base: item.fotos_depois, destino: item.fotos_antes, putEm: voltaSaiu ? item.put_em : null,
      desde: Math.max(entrada, voltaSaiu ? ms(item.put_em)! : 0), agora, podeRefazer: true,
    });
    if (d === 'concluir') return concluir('compensado');
    if (d === 'esperar') return soltar('esperar');
    if (d === 'incompleta') return concluir('reversao_incompleta', { erro: lido ? 'fotos_divergentes' : 'get_indisponivel' });
    const plano = planejarFotosItem({ direcao: 'volta', atual: lido!, variacoesAlvo: alvos, fotosDaCor: item.fotos_antes ?? {},
      fotosDepois: item.fotos_depois ?? {}, picturesAntes: retrato?.pictures as string[] });
    if (!plano.ok) {
      if (plano.motivo === 'reversao_incompleta') return concluir('reversao_incompleta', { erro: plano.detalhe });
      return soltar('esperar');   // catálogo/migração: GET de novo no tick seguinte, até compensar_ate (adendo 1)
    }
    if (!(await gravar({ corpo_planejado: { direcao: 'volta', corpo: plano.corpo }, base_esperada: item.fotos_depois,
      destino: item.fotos_antes, put_em: agora.toISOString() }, false))) return 'perdeu_posse';
    if (!(await travaAinda())) return soltar('ignorar');
    try {
      await ml.putFotos(token, item.item_id, plano.corpo);
    } catch {
      return soltar('compensando', true);   // qualquer falha: reconciliação no próximo tick, até compensar_ate
    }
    const conf = await ml.lerItem(token, item.item_id);
    if (conf && mesmasFotos(fotosDaCorNoItem(conf, alvos), item.fotos_antes)) return concluir('compensado');
    return soltar('compensando', true);
  }

  // ── Ida: upload das fotos em laço (ADR-0201 (k)) e consulta de prontas ─────────────────────────────────────────────────────────────
  const fotos = [...(item.fotos_novas ?? [])];
  if (passo === 'subir') {
    const i = fotos.findIndex((f) => !f.upload_id);
    if (i < 0) {
      for (const [k, f] of fotos.entries()) {
        if (!f.pronta && (await ml.lerFotoPronta(token, f.upload_id!)) === true) fotos[k] = { ...f, pronta: true };
      }
      const todas = fotos.every((f) => f.pronta);
      if (!(await gravar({ fotos_novas: fotos, ...(todas ? { fase: item.fase + 1 } : {}) }, true))) return 'perdeu_posse';
      return todas ? 'pronta' : 'aguardando_pronta';
    }
    // ADR-0201 (k): sobe as fotos pendentes em laço, no mesmo lease. Uma gravação por foto, sempre condicionada à posse
    // (posse anulada por aborto ou lease perdido → `perdeu_posse`, o laço acaba); `fase` avança uma vez, ao soltar.
    const inicio = agora.getTime();
    let subidas = 0;
    for (let j = fotos.findIndex((f) => !f.upload_id); j >= 0; j = fotos.findIndex((f) => !f.upload_id)) {
      if (subidas > 0) {
        const agoraLaco = deps.agora();
        if (agoraLaco.getTime() - inicio >= ORCAMENTO_SUBIDA_MS || portaoFechado(aplicacao, { agora: agoraLaco, vigente })) break;
      }
      const foto = fotos[j];
      const { data: img, error: eI } = await admin.from('galeria_imagens').select('final_path, final_sha256')
        .eq('id', foto.imagem_id).eq('org_id', item.org_id).maybeSingle();
      if (eI) throw new Error(eI.message);
      const { data: blob } = img?.final_path ? await admin.storage.from('imagens').download(img.final_path) : { data: null };
      if (!blob) return concluir('falhou', { erro: 'final_indisponivel' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (sha256Hex(bytes) !== foto.final_sha256) return concluir('falhou', { erro: 'sha_divergente' });
      fotos[j] = { ...foto, enviando: true };
      if (!(await gravar({ fotos_novas: fotos, status: 'subindo' }, false))) return 'perdeu_posse';
      let subida: { id: string; pronta: boolean };
      try {
        subida = await ml.subir(token, bytes, 'image/jpeg');
      } catch (e) {
        // 429 = o ML recusou antes de criar a foto (ADR-0201 (m)): tira a marca, solta e tenta no tick seguinte, até
        // MAX_429_POR_FOTO vezes. Os outros erros seguem iguais: sem status (timeout/rede) = incerto, o ML pode ter
        // criado a foto e nunca re-sobe às cegas; com outro status, recusa.
        if (statusHttp(e) === 429) {
          const tentativas = (foto.tentativas ?? 0) + 1;
          if (tentativas > MAX_429_POR_FOTO) return concluir('falhou', { erro: 'upload_429' });
          fotos[j] = { ...foto, enviando: false, tentativas };
          return (await gravar({ fotos_novas: fotos, fase: item.fase + 1 }, true)) ? 'esperar' : 'perdeu_posse';
        }
        return concluir('falhou', { erro: statusHttp(e) ? `upload_recusado_${statusHttp(e)}` : 'upload_incerto' });
      }
      fotos[j] = { ...foto, upload_id: subida.id, pronta: subida.pronta, enviando: false };
      if (!(await gravar({ fotos_novas: fotos }, false))) return 'perdeu_posse';
      subidas++;
    }
    return (await gravar({ fase: item.fase + 1 }, true)) ? 'subiu' : 'perdeu_posse';
  }

  // ── Ida: PUT (ou reconciliação de PUT incerto) ────────────────────────────────────────────────────────────────
  const retrato = aplicacao.retrato?.[item.item_id];
  const fechado = portaoFechado(aplicacao, { agora, vigente });
  if (passo === 'conferir') {
    const lido = await ml.lerItem(token, item.item_id);
    const atual = lido ? fotosDaCorNoItem(lido, alvos) : null;
    const d = decidirReconciliacao({ atual, getOk: !!lido, base: item.base_esperada, destino: item.destino,
      putEm: item.put_em, desde: ms(item.put_em) ?? 0, agora, podeRefazer: !fechado });
    if (d === 'esperar') return soltar('esperar');
    if (d === 'concluir') {
      if (item.corpo_planejado && !outrasIntactas(lido!, item.corpo_planejado.corpo, alvos)) {
        return concluir('reversao_incompleta', { erro: 'outras_variacoes_divergentes' });
      }
      return concluirAplicado(lido!);
    }
    if (d === 'pular') return concluir('pulado', { erro: 'put_incerto_sem_efeito', abortar: true });
    if (d === 'incompleta') return concluir('reversao_incompleta', { erro: lido ? 'fotos_divergentes' : 'get_indisponivel' });
    // refazer: base depois da janela com o portão aberto → mesmo caminho do PUT.
  }

  if (fechado) return concluir('pulado', { erro: fechado, abortar: true });
  const lido = await ml.lerItem(token, item.item_id);
  if (!lido) return soltar('esperar');
  if (!retrato) return concluir('falhou', { erro: 'sem_retrato' });
  const plano = planejarFotosItem({
    direcao: 'ida', atual: lido, retrato, variacoesAlvo: alvos,
    fotosDaCor: fotos.map((f) => ({ missao: f.missao, id: f.upload_id! })),
    capaAprovada: fotos.some((f) => f.missao === 1), modo: aplicacao.modo, limiteVar: LIMITE_VAR, limiteItem: LIMITE_ITEM,
  });
  // mudou/limite/catálogo/migração/variação ausente → nenhum PUT; falhou aborta e compensa os já aplicados.
  if (!plano.ok) return concluir('falhou', { erro: `${plano.motivo}:${plano.detalhe}` });
  const destino = destinoDoCorpo(plano.corpo, alvos);
  if (!(await gravar({ status: 'aplicando', corpo_planejado: { direcao: 'ida', corpo: plano.corpo },
    base_esperada: item.fotos_antes, destino, put_em: agora.toISOString() }, false))) return 'perdeu_posse';
  // Portão de avanço relido do banco, com o relógio de agora, imediatamente antes do PUT de ida (revisão T14): o GET
  // pode ter atravessado o prazo, um aborto ou outro roteiro aprovado. Fechado → nenhum PUT de ida; item `pulado`
  // e aborto na mesma transação. (put_em já gravado → quarentena de 15 min sem PUT real: conservador.)
  const [minha, portao] = await Promise.all([travaAinda(), portaoRelido()]);
  if (!minha) return soltar('ignorar');
  if (portao) return concluir('pulado', { erro: portao, abortar: true });
  try {
    await ml.putFotos(token, item.item_id, plano.corpo);
  } catch (e) {
    const st = statusHttp(e);
    // 4xx = recusa definitiva (nada mudou); 5xx, timeout ou rede = incerto → continua aplicando e reconcilia.
    if (st != null && st < 500) return concluir('falhou', { erro: `put_recusado_${st}` });
    return soltar('aplicando', true);
  }
  const conf = await ml.lerItem(token, item.item_id);
  if (conf && mesmasFotos(fotosDaCorNoItem(conf, alvos), destino) && outrasIntactas(conf, plano.corpo, alvos)) {
    return concluirAplicado(conf);
  }
  return soltar('aplicando', true);
}
