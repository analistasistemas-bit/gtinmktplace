// ADR-0088 — saga "tudo ou pausa" que publica N itens técnicos UP (um por SKU/cor) de UMA
// partição comercial. "Idempotente" = segura para REEXECUÇÃO SEQUENCIAL após falha (um retry
// reaproveita o trabalho persistido e não repete efeitos remotos) — NÃO segura contra duas
// execuções concorrentes da mesma partição (risco pré-existente do pipeline, fora de escopo).
//
// A saga é PURA: recebe as portas por parâmetro (testável com fakes em memória, sem rede/banco).
// O adapter real (implementação das portas) vive na integração com publicar-split-ml (próxima
// etapa) — aqui só o algoritmo + a regra de agregação.

import type { BuscaSku } from '../ml/buscar-item.ts';

// ── Regra de agregação de estado (função TOTAL, pura) ───────────────────────────────────────

export type StatusFilho =
  | 'pendente' | 'criacao_incerta' | 'criado' | 'pausado' | 'ativo'
  | 'compensacao_pendente' | 'remocao_pendente' | 'erro';

export type EstadoParticao =
  | 'publicando' | 'erro' | 'compensacao_pendente' | 'parcial' | 'ativo' | 'pausado';

export interface FilhoAgg {
  sku: string;
  status: StatusFilho;
  retirado: boolean;
}

const NAO_TERMINAIS: ReadonlySet<StatusFilho> = new Set<StatusFilho>([
  'pendente', 'criado', 'criacao_incerta', 'remocao_pendente',
]);

/**
 * Reduz os N filhos de uma partição ao estado da partição/família, na ORDEM DE PRECEDÊNCIA
 * EXATA da ADR-0088. Total: todo combo tem resultado. Opera só sobre filhos NÃO-retirados
 * (`retirado=true` é histórico — cor pausada de propósito, fora da agregação). `E` = skus_esperados.
 *
 * Só o resultado `ativo` (caso 8) libera a família p/ status='publicado'.
 */
export function agregarEstado(
  filhos: FilhoAgg[],
  skusEsperados: string[],
  mudandoComposicao: boolean,
): EstadoParticao {
  // 0. gate de mudança de composição: precede TUDO (mascara erro/ativo transitório espúrio).
  if (mudandoComposicao) return 'publicando';

  const A = filhos.filter((f) => !f.retirado);
  const E = new Set(skusEsperados);

  // 1. A vazio → publicando (nunca `ativo` por vacuidade; guard fecha também o footgun ∅==∅).
  if (A.length === 0) return 'publicando';
  // 2. algum filho em erro (precede conjunto incompleto).
  if (A.some((f) => f.status === 'erro')) return 'erro';
  // 3. algum filho em compensacao_pendente.
  if (A.some((f) => f.status === 'compensacao_pendente')) return 'compensacao_pendente';
  // 4. algum filho não-terminal (ainda subindo/em transição).
  if (A.some((f) => NAO_TERMINAIS.has(f.status))) return 'publicando';
  // 5. excesso não explicado por retirada: filho de A com SKU ∉ E.
  if (A.some((f) => !E.has(f.sku))) return 'erro';
  // 6. conjunto de A ⊊ E (faltam SKUs esperados — ex.: 7 de 9 por crash). Após o caso 5 todo
  //    SKU de A ∈ E, então |A| < |E| ⇔ subconjunto próprio.
  const skusA = new Set(A.map((f) => f.sku));
  if (skusA.size < E.size) return 'publicando';
  // aqui: conjunto de A == E e todos os filhos de A são terminais (ativo/pausado).
  const temAtivo = A.some((f) => f.status === 'ativo');
  const temPausado = A.some((f) => f.status === 'pausado');
  // 7. mistura ativo+pausado.
  if (temAtivo && temPausado) return 'parcial';
  // 8. todos ativo e conjunto == E.
  if (temAtivo) return 'ativo';
  // 9. todos pausado.
  return 'pausado';
}

// ── Saga ────────────────────────────────────────────────────────────────────────────────────

export interface FilhoRow {
  sku: string;
  status: StatusFilho;
  retirado: boolean;
  itemExternoId: string | null;
}

/** Confirmação remota de um item (GET). `ok=false` = estado remoto INESPERADO (404, deletado,
 *  seller diferente, family_id ausente) → a saga marca `erro` e para (nunca retry cego). */
export interface ConfirmacaoRemota {
  ok: boolean;
  familyId?: string;
  userProductId?: string;
  permalink?: string;
}

/**
 * Portas da saga (injetadas). A saga nunca toca rede/banco direto. Convenções:
 * - `reservar`: INSERT-IF-ABSENT (ON CONFLICT DO NOTHING) — nunca clobber IDs/status já persistidos.
 * - `criarPlano`: POST-only (o ML cria ATIVO por padrão); a saga persiste o id e SÓ ENTÃO pausa
 *   (staging) — a pausa é "outra chamada" depois de gravar, mantendo mínima a janela criacao_incerta.
 * - `salvarCriado`: grava item_externo_id e status='criado' (tira a linha de criacao_incerta).
 */
export interface PortasSaga {
  listar(anuncioExternoId: string): Promise<FilhoRow[]>;
  reservar(anuncioExternoId: string, skus: string[]): Promise<void>;
  salvarStatus(anuncioExternoId: string, sku: string, status: StatusFilho): Promise<void>;
  salvarCriado(anuncioExternoId: string, sku: string, itemExternoId: string): Promise<void>;
  buscarPorSku(sku: string): Promise<BuscaSku>;
  criarPlano(sku: string): Promise<{ itemExternoId: string; permalink: string }>;
  confirmar(itemExternoId: string): Promise<ConfirmacaoRemota>;
  mudarStatus(itemExternoId: string, status: 'ativo' | 'pausado'): Promise<void>;
  salvarConfirmacao(
    anuncioExternoId: string,
    sku: string,
    dados: { familyId: string; userProductId?: string; permalink?: string },
  ): Promise<void>;
  salvarEstadoDesejado(anuncioExternoId: string, estado: 'ativando' | 'pausando' | null): Promise<void>;
}

export interface EntradaSaga {
  anuncioExternoId: string;
  /** Snapshot do conjunto de SKUs esperados — já gravado na raiz (anuncios_externos.skus_esperados)
   *  pelo CHAMADOR, ANTES de a saga começar (ADR-0088 §4). A saga o recebe explícito e o usa na
   *  agregação; não o reescreve (composição é outra etapa). */
  skusEsperados: string[];
}

export type CodigoErroSaga = 'familia_up_desagrupada' | 'estado_remoto_inesperado' | 'busca_ambigua';

export interface ResultadoSaga {
  estado: EstadoParticao; // derivado de agregarEstado ao final (sucesso pleno / compensacao / erro)
  codigo?: CodigoErroSaga;
}

/** Pausa best-effort de todos os itens conhecidos — AÇÃO de compensação segura (nunca item ativo
 *  órfão). Pausar é sempre a ação, NUNCA o estado terminal do grupo (ADR-0088 passo 9). */
async function pausarTodos(portas: PortasSaga, filhos: FilhoRow[]): Promise<void> {
  for (const f of filhos) {
    if (f.itemExternoId) await portas.mudarStatus(f.itemExternoId, 'pausado').catch(() => {});
  }
}

export async function publicarGrupo(portas: PortasSaga, entrada: EntradaSaga): Promise<ResultadoSaga> {
  const { anuncioExternoId: id, skusEsperados } = entrada;

  // 1. reservar as linhas filhas por (anuncio_externo_id, sku) — insert-if-absent, nunca clobber.
  await portas.reservar(id, skusEsperados);

  // 2. criar/adotar cada SKU que ainda não tem item_externo_id.
  let filhos = await portas.listar(id);
  const acharSku = (lista: FilhoRow[], sku: string) => lista.find((f) => f.sku === sku);

  try {
    for (const sku of skusEsperados) {
      const existente = acharSku(filhos, sku);
      if (existente?.itemExternoId) continue; // passo 3: retry reaproveita ID, nunca repete POST.

      // passo 2: janela de idempotência — marca criacao_incerta ANTES do POST (não depois).
      await portas.salvarStatus(id, sku, 'criacao_incerta');

      const busca = await portas.buscarPorSku(sku);
      if (busca.tipo === 'ambiguo' || busca.tipo === 'truncado') {
        // adoção bloqueada → erro manual, nunca adota o primeiro nem cria duplicado.
        await portas.salvarStatus(id, sku, 'erro');
        await pausarTodos(portas, await portas.listar(id));
        return { estado: 'erro', codigo: 'busca_ambigua' };
      }
      if (busca.tipo === 'um') {
        await portas.salvarCriado(id, sku, busca.itemExternoId); // adota órfão, não duplica.
        continue;
      }
      // nenhum match → POST (cria ativo por padrão), persiste ANTES de outra chamada, depois pausa.
      const criado = await portas.criarPlano(sku);
      await portas.salvarCriado(id, sku, criado.itemExternoId); // tira de criacao_incerta.
      await portas.mudarStatus(criado.itemExternoId, 'pausado'); // staging (chamada seguinte).
    }
  } catch (e) {
    // Crash inesperado na FASE DE CRIAÇÃO (ex.: criarPlano falha no SKU 8 de 9): pausar todos os
    // IDs já conhecidos como AÇÃO de compensação segura (ADR-0088 passo 9 — nunca item ativo
    // órfão) e RE-LANÇAR. Assimetria DELIBERADA com ativação/family_id/estado-remoto (que
    // RETORNAM ResultadoSaga): um crash de criação é o caso "órfão sem ID" (passo 2), cujo estado
    // terminal NÃO é decidido aqui — a linha fica em `criacao_incerta` (marcada ANTES do POST) e é
    // resolvida pela PRÓPRIA saga na próxima execução (retry QStash/"Reenviar"), refazendo a busca
    // por SKU antes de recriar. Re-lançar sinaliza falha ao worker → reprocesso; nunca engole o erro.
    await pausarTodos(portas, await portas.listar(id));
    throw e;
  }

  // 3. confirmar todos por GET; exigir um ÚNICO family_id.
  filhos = await portas.listar(id);
  const alvos = skusEsperados
    .map((sku) => acharSku(filhos, sku))
    .filter((f): f is FilhoRow => !!f && !f.retirado && !!f.itemExternoId);

  const familyIds = new Set<string>();
  for (const f of alvos) {
    const conf = await portas.confirmar(f.itemExternoId!);
    if (!conf.ok || !conf.familyId) {
      // estado remoto inesperado → linha erro, saga para (nunca retry cego).
      await portas.salvarStatus(id, f.sku, 'erro');
      await pausarTodos(portas, await portas.listar(id));
      return { estado: 'erro', codigo: 'estado_remoto_inesperado' };
    }
    await portas.salvarConfirmacao(id, f.sku, {
      familyId: conf.familyId, userProductId: conf.userProductId, permalink: conf.permalink,
    });
    familyIds.add(conf.familyId);
  }
  if (familyIds.size !== 1) {
    // family_id divergente → pausar todos (ação) + marcar todos erro (terminal), nunca ativar.
    await pausarTodos(portas, filhos);
    for (const f of alvos) await portas.salvarStatus(id, f.sku, 'erro');
    return { estado: 'erro', codigo: 'familia_up_desagrupada' };
  }

  // 4. ativar todos — grava estado_desejado='ativando' ANTES do 1º PUT de ativação.
  await portas.salvarEstadoDesejado(id, 'ativando');
  try {
    for (const f of alvos) {
      await portas.mudarStatus(f.itemExternoId!, 'ativo');
      await portas.salvarStatus(id, f.sku, 'ativo');
    }
  } catch {
    // ativação parcial (não-atômica) → compensação: pausar todos (ação segura) + marcar todos
    // compensacao_pendente (estado terminal intermediário, NUNCA pausado). estado_desejado
    // PERMANECE 'ativando' — o reconciliador de convergência reativa os que faltam.
    await pausarTodos(portas, filhos);
    for (const f of alvos) await portas.salvarStatus(id, f.sku, 'compensacao_pendente');
    return { estado: 'compensacao_pendente' };
  }

  // todos ativos confirmados → limpa estado_desejado (fim de "ativando").
  await portas.salvarEstadoDesejado(id, null);
  const finais = await portas.listar(id);
  return { estado: agregarEstado(finais, skusEsperados, false) };
}
