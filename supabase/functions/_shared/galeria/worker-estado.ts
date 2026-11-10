// Worker de geração da galeria (ADR-0201, Task 9; Global Constraints "Claim", "Posse", "Jobs", "Higgsfield",
// "Vigência editorial × execução"). Executa UMA fase por mensagem e grava o estado; nunca publica nada (o despachante
// encontra a próxima ação). Claim = um único update condicionado (fase, tentativa, status aberto, lease livre) que
// grava posse + lease; toda gravação seguinte exige `posse = minha`. A conclusão (cena_path, prompt, custo e
// gerada|desatualizada pela vigência do roteiro) é um único update, na RPC `galeria_concluir_geracao`. A visão é fase
// própria: claim só de posse/lease, grava só `alertas`. O worker nunca cobra (a cobrança é da exibição, Task 10).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { openrouterClient } from '../ai/client.ts';
import { dimensoesImagem, extrairImagem } from '../ai/imagem.ts';
import { consultarHF, submeterHF, TIMEOUT_HF_MS, type ConsultaHF } from '../ai/higgsfield.ts';
import { corpoHF, modeloGaleria, type ModeloGaleria } from './provedores.ts';
import { corpoOpenRouter, LAYOUT_PADRAO, montarPromptCena } from './prompt.ts';
import { verificarCena } from './alertas.ts';
import { cenaUtil } from './corte.ts';
import { corSlug } from './referencias.ts';
import type { Roteiro } from './roteiro.ts';

export const LEASE_MS = 150_000;
export const PRAZO_GERACAO_MS = 12 * 60_000;
export const MIN_BYTES = 40 * 1024;
/** Vida máxima de uma linha aberta: `galeria_relogio` grava `falhou`/`expirada` em `criado_em + 60 min`. É o teto
 * das retentativas de consulta/download depois do prazo. */
export const VIDA_MAXIMA_MS = 60 * 60_000;
/** A Higgsfield baixa a referência quando processa (pode ser depois do prazo de 12 min): a URL vale a vida inteira
 * da linha. */
export const VALIDADE_REFERENCIA_S = Math.max(PRAZO_GERACAO_MS, VIDA_MAXIMA_MS) / 1000;
/** Teto de cada chamada de imagem (abaixo do lease de 150 s; nunca passar mais que isto à Higgsfield). */
export const TIMEOUT_GERACAO_MS = Math.min(100_000, TIMEOUT_HF_MS);

export type FaseWorker = 'submeter' | 'consultar' | 'baixar' | 'consulta_final' | 'alertar' | 'falhar' | 'ignorar' | 'ocupado';

export interface LinhaWorker {
  id: string; org_id: string; familia_id: string; roteiro_id: string; referencia_id: string | null;
  cor: string; missao: number; geracao: number; origem: string; modelo: string | null;
  provider_request_id: string | null; status: string; fase: number; tentativa: number;
  lease_ate: string | null; prazo_ate: string | null; criado_em: string;
  prompt: string | null; cena_path: string | null; alertas: unknown;
}
export interface MensagemWorker { fase: number; tentativa: number }

const ABERTOS = ['pendente', 'submetendo', 'gerando'];
const COLUNAS = 'id, org_id, familia_id, roteiro_id, referencia_id, cor, missao, geracao, origem, modelo, '
  + 'provider_request_id, status, fase, tentativa, lease_ate, prazo_ate, criado_em, prompt, cena_path, alertas';

const prazoDe = (l: LinhaWorker) => (l.prazo_ate ? Date.parse(l.prazo_ate) : Date.parse(l.criado_em) + PRAZO_GERACAO_MS);

/**
 * Puro. Decide pela linha (não por `msg.acao`). `consulta` = resultado da consulta à Higgsfield feita sob a posse:
 * concluída → `baixar`; falha, ou pendente depois do prazo → `falhar`; pendente no prazo → `ignorar` (só solta o lease).
 */
export function proximaFase(
  l: Pick<LinhaWorker, 'origem' | 'status' | 'fase' | 'tentativa' | 'lease_ate' | 'provider_request_id' | 'cena_path' | 'alertas' | 'prazo_ate' | 'criado_em'>,
  msg: MensagemWorker, agora: Date, consulta?: ConsultaHF['status'],
): FaseWorker {
  if (l.origem !== 'gerador') return 'ignorar';
  const ocupada = l.lease_ate != null && Date.parse(l.lease_ate) >= agora.getTime();
  // Visão: qualquer status, qualquer mensagem; o claim próprio (alertas nulo) protege.
  if (l.cena_path != null) return l.alertas != null ? 'ignorar' : ocupada ? 'ocupado' : 'alertar';
  if (!ABERTOS.includes(l.status)) return 'ignorar';
  if (msg.fase !== l.fase || msg.tentativa !== l.tentativa) return 'ignorar';
  if (consulta) {
    if (consulta === 'concluida') return 'baixar';
    return consulta === 'falhou' || agora.getTime() > prazoDe(l as LinhaWorker) ? 'falhar' : 'ignorar';
  }
  if (ocupada) return 'ocupado';
  if (l.provider_request_id) return agora.getTime() > prazoDe(l as LinhaWorker) ? 'consulta_final' : 'consultar';
  if (l.status === 'pendente') return 'submeter';
  // submetendo sem id com lease vencido = queda durante a chamada: no máximo uma nova submissão.
  return l.status === 'submetendo' && l.tentativa < 2 ? 'submeter' : 'falhar';
}

export interface DepsWorker {
  agora: () => Date;
  fetchFn?: typeof fetch;
  /** Testes; na edge vale o env HF_CREDENTIALS. */
  credenciaisHF?: string;
}

export type ResultadoWorker =
  | 'ignorar' | 'ocupado' | 'falhou' | 'gerando' | 'pendente' | 'liberada' | 'gerada' | 'desatualizada' | 'perdeu_posse' | 'alertada';

type Erro = Error & { status?: number };

export async function executarImagem(admin: SupabaseClient, msg: MensagemWorker & { id: string }, deps: DepsWorker): Promise<ResultadoWorker> {
  const { data: l, error } = await admin.from('galeria_imagens').select(COLUNAS).eq('id', msg.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!l) return 'ignorar';
  const linha = l as unknown as LinhaWorker;
  const agora = deps.agora();
  const fase = proximaFase(linha, msg, agora);
  if (fase === 'ignorar' || fase === 'ocupado') return fase;
  if (fase === 'alertar') return alertar(admin, linha, deps);

  const tabela = () => admin.from('galeria_imagens');
  const livre = (q: ReturnType<ReturnType<typeof tabela>['update']>) =>
    q.eq('id', linha.id).eq('fase', linha.fase).eq('tentativa', linha.tentativa).in('status', ABERTOS)
      .or(`lease_ate.is.null,lease_ate.lt.${agora.toISOString()}`);
  const falharSemPosse = async (erro: string) => {
    const { data, error } = await livre(tabela().update({ status: 'falhou', erro, posse: null, lease_ate: null, fase: linha.fase + 1 })).select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1 ? 'falhou' : 'ocupado';
  };
  if (fase === 'falhar') return falharSemPosse('queda_repetida');

  const roteiro = await lerRoteiro(admin, linha.roteiro_id);
  // Linha de roteiro trocado nunca paga nova chamada (a pendente vai a falhou; a submetendo sem id também).
  if ((fase === 'submeter') && roteiro?.status !== 'aprovado') return falharSemPosse('roteiro_trocado');

  // Claim atômico com a transição.
  const posse = crypto.randomUUID();
  const submeter = fase === 'submeter';
  const tentativa = submeter ? linha.tentativa + 1 : linha.tentativa;
  const claimQ = livre(tabela().update({
    posse, lease_ate: new Date(agora.getTime() + LEASE_MS).toISOString(),
    status: submeter ? 'submetendo' : 'gerando', tentativa, prazo_ate: new Date(prazoDe(linha)).toISOString(),
  }));
  const { data: claim, error: eC } = await (submeter ? claimQ.is('provider_request_id', null) : claimQ).select('id');
  if (eC) throw new Error(eC.message);
  if ((claim ?? []).length !== 1) return 'ocupado';

  const comPosse = async (campos: Record<string, unknown>) => {
    const { data, error } = await tabela().update(campos).eq('id', linha.id).eq('posse', posse).select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  };
  const liberar = async (): Promise<ResultadoWorker> => ((await comPosse({ posse: null, lease_ate: null })) ? 'liberada' : 'perdeu_posse');
  const falhar = async (erro: string): Promise<ResultadoWorker> =>
    ((await comPosse({ status: 'falhou', erro, posse: null, lease_ate: null, fase: linha.fase + 1 })) ? 'falhou' : 'perdeu_posse');
  const modelo = modeloGaleria(linha.modelo);
  const opHF = { fetchFn: deps.fetchFn, credenciais: deps.credenciaisHF, timeoutMs: TIMEOUT_GERACAO_MS };

  const concluir = async (bytes: Uint8Array, ext: string, mime: string, prompt: string | null, custo: number): Promise<ResultadoWorker> => {
    const d = dimensoesImagem(bytes);
    if (!d || bytes.length < MIN_BYTES || !cenaUtil(linha.missao, d.largura, d.altura)) return falhar('cena_inutil');
    // Caminho imutável por posse: upload tardio de quem perdeu a posse nunca sobrescreve o do vencedor.
    const path = `${linha.org_id}/galeria-ia/${linha.familia_id}/${corSlug(linha.cor)}/${linha.missao}-${linha.geracao}-${linha.id}-${posse}.${ext}`;
    const { error: eUp } = await admin.storage.from('imagens').upload(path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), { contentType: mime, upsert: false });
    if (eUp) { console.error('[galeria-worker] upload', linha.id, eUp.message); return liberar(); }
    const { data: status, error: eR } = await admin.rpc('galeria_concluir_geracao', {
      p_imagem: linha.id, p_posse: posse, p_cena_path: path, p_prompt: prompt, p_custo: custo,
    });
    if (eR) throw new Error(eR.message);
    return status === 'gerada' || status === 'desatualizada' ? status : 'perdeu_posse';
  };

  // Erro da chamada paga: 4xx definitivo → falhou; transitório (5xx, 408, 429, rede, timeout) → solta o lease e a
  // regra de `tentativa` decide (no máximo uma nova submissão).
  const erroPago = (e: Erro): Promise<ResultadoWorker> => {
    console.error('[galeria-worker] provedor', linha.id, e?.status, e?.message);
    const s = e?.status;
    const definitivo = typeof s === 'number' && s >= 400 && s < 500 && s !== 408 && s !== 429;
    return definitivo || tentativa >= 2 ? falhar(definitivo ? `provedor_${s}` : 'provedor_indisponivel') : liberar();
  };

  if (submeter) {
    const m = roteiro!.conteudo.missoes?.find((x) => x.missao === linha.missao);
    if (!m) return falhar('missao_ausente');
    const prompt = montarPromptCena(m, roteiro!.conteudo, roteiro!.moda, linha.cor, LAYOUT_PADRAO);
    const refUrl = await urlAssinada(admin, await caminhoReferencia(admin, linha.referencia_id), VALIDADE_REFERENCIA_S);
    if (!refUrl) return falhar('sem_referencia');
    if (modelo.provedor === 'openrouter') {
      let gerada: ReturnType<typeof extrairImagem> & { custo: number };
      try {
        // deno-lint-ignore no-explicit-any
        const resp = await openrouterClient().chat.completions.create(corpoOpenRouter(modelo.slug, prompt, [refUrl]) as any,
          { maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_GERACAO_MS) });
        gerada = { ...extrairImagem(resp), custo: custoOpenRouter(modelo, resp) };
      } catch (e) {
        return erroPago(e as Erro);
      }
      return concluir(gerada.bytes, gerada.ext, gerada.mime, prompt, gerada.custo);
    }
    let requestId: string;
    try {
      requestId = await submeterHF(modelo.endpoint!, corpoHF(modelo, prompt, modelo.campoReferencia ? [refUrl] : []), opHF);
    } catch (e) {
      return erroPago(e as Erro);
    }
    const ok = await comPosse({ provider_request_id: requestId, status: 'gerando', prompt, posse: null, lease_ate: null, fase: linha.fase + 1 });
    return ok ? 'gerando' : 'perdeu_posse';
  }

  // consultar | consulta_final (Higgsfield). Só o provedor dizendo pendente/falhou depois do prazo leva a `falhar`;
  // erro transitório de consulta ou de download (imagem paga, URL válida por 7 dias) só solta o lease e o despachante
  // repete. ponytail: teto = relógio no banco (`VIDA_MAXIMA_MS`), sem contador próprio.
  let r: ConsultaHF;
  try {
    r = await consultarHF(linha.provider_request_id!, opHF);
  } catch (e) {
    console.error('[galeria-worker] consulta', linha.id, (e as Error).message);
    return liberar();
  }
  const depois = proximaFase(linha, msg, deps.agora(), r.status);
  if (depois === 'ignorar') return (await liberar()) === 'liberada' ? 'pendente' : 'perdeu_posse';
  if (depois === 'falhar') return falhar(r.status === 'falhou' ? `provedor_${r.erro ?? 'falhou'}` : 'prazo_esgotado');
  // baixar
  try {
    const res = await (deps.fetchFn ?? fetch)(r.url!, { signal: AbortSignal.timeout(TIMEOUT_GERACAO_MS) });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return concluir(bytes, png ? 'png' : 'jpg', png ? 'image/png' : 'image/jpeg', linha.prompt, modelo.custoUsd);
  } catch (e) {
    console.error('[galeria-worker] download', linha.id, (e as Error).message);
    return liberar();
  }
}

/** Custo da imagem: `usage.cost` do OpenRouter; sem ele, o custo do registro do modelo (nunca 0 por omissão). */
function custoOpenRouter(modelo: ModeloGaleria, resp: unknown): number {
  // deno-lint-ignore no-explicit-any
  const c = (resp as any)?.usage?.cost;
  return typeof c === 'number' && c > 0 ? c : modelo.custoUsd;
}

async function lerRoteiro(admin: SupabaseClient, id: string) {
  const { data, error } = await admin.from('galeria_roteiros').select('id, status, moda, conteudo').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; status: string; moda: boolean; conteudo: Roteiro } | null;
}

async function caminhoReferencia(admin: SupabaseClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data, error } = await admin.from('galeria_referencias').select('path').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.path as string | undefined) ?? null;
}

async function urlAssinada(admin: SupabaseClient, path: string | null, segundos = 600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from('imagens').createSignedUrl(path, segundos);
  return error ? null : data?.signedUrl ?? null;
}

/** Visão: claim só de posse/lease (nunca status, fase nem tentativa); grava só `alertas`. */
async function alertar(admin: SupabaseClient, l: LinhaWorker, deps: DepsWorker): Promise<ResultadoWorker> {
  const agora = deps.agora();
  const posse = crypto.randomUUID();
  const { data: claim, error } = await admin.from('galeria_imagens')
    .update({ posse, lease_ate: new Date(agora.getTime() + LEASE_MS).toISOString() })
    .eq('id', l.id).is('alertas', null).not('cena_path', 'is', null)
    .or(`lease_ate.is.null,lease_ate.lt.${agora.toISOString()}`).select('id');
  if (error) throw new Error(error.message);
  if ((claim ?? []).length !== 1) return 'ocupado';
  const roteiro = await lerRoteiro(admin, l.roteiro_id);
  const cenaUrl = await urlAssinada(admin, l.cena_path);
  const alertas = cenaUrl
    ? await verificarCena({
      cenaUrl, referenciaUrl: await urlAssinada(admin, await caminhoReferencia(admin, l.referencia_id)),
      cor: l.cor, contrato: roteiro?.conteudo?.contrato ?? '',
    })
    : [{ tipo: 'verificacao_indisponivel', nota: 'cena indisponível' }];
  const { data, error: eF } = await admin.from('galeria_imagens').update({ alertas, posse: null, lease_ate: null })
    .eq('id', l.id).eq('posse', posse).select('id');
  if (eF) throw new Error(eF.message);
  return (data ?? []).length === 1 ? 'alertada' : 'perdeu_posse';
}
