// ADR-0088 Fase 2 — mini-saga de MUDANÇA DE COMPOSIÇÃO (adicionar/retirar cor) de uma família UP
// já publicada. Simétrica à saga de criação (publicar-grupo.ts): idempotente para REEXECUÇÃO
// SEQUENCIAL (um retry retoma do estado real das linhas), NÃO para concorrência simultânea.
//
// Segue LITERALMENTE a seção "Mudança de composição" da ADR-0088 (linhas ~397-425):
//   1. antes de qualquer chamada remota: persistir na raiz o NOVO skus_esperados E ligar
//      mudando_composicao=true (atômico);
//   2. mutação remota: cor nova genuína → reservar/criacao_incerta/buscarPorSku/criar; cor
//      readicionada (linha retirado=true) → REATIVAR o item existente (nunca CREATE); cor retirada
//      → pausar;
//   3. confirmar por GET (cor nova/readicionada active + family_id da partição; cor retirada paused);
//   4. só então: retirado=true nas retiradas (após pausa confirmada) e limpar mudando_composicao.
//
// A saga é PURA: recebe as portas por parâmetro (testável com fakes). O adapter real vive em
// atualizar-familia-up.ts. Diferente de publicar-grupo: NÃO pausa as cores vivas ao falhar uma cor
// nova (a família já está publicada — derrubar N cores vivas por 1 erro é pior que isolar a cor).

import type { StatusFilho } from './publicar-grupo.ts';
import type { BuscaSku } from '../ml/buscar-item.ts';

export type { StatusFilho };

/** Estados terminais/administrativos de um filho não-retirado que a mini-saga NÃO pode reativar em
 *  silêncio (Fix 2). `pausado`-não-retirado é tratado à parte (o flag `retirado` distingue readd). */
const BLOQUEIO_REATIVACAO: ReadonlySet<StatusFilho> = new Set<StatusFilho>([
  'erro', 'compensacao_pendente', 'remocao_pendente',
]);

export interface FilhoComp {
  sku: string;
  status: StatusFilho;
  retirado: boolean;
  itemExternoId: string | null;
  familyId: string | null;
}

/** Confirmação por GET que EXPÕE o `status` cru do ML ('active'/'paused'/null) — diferente do
 *  `ConfirmacaoRemota` da saga de criação (que só traz ok/family_id), porque aqui a mini-saga
 *  precisa distinguir "ativou" de "pausou" por GET (nunca assumir pelo PUT sem erro HTTP). */
export interface ConfirmacaoComp {
  ok: boolean;              // GET ok, seller confere e family_id presente
  status: string | null;   // status cru do ML ('active'/'paused') — null se GET falhou
  /** true = GET SUCEDEU mas é o item ERRADO (seller divergente): estado remoto inesperado,
   *  TERMINAL (nunca retentável). Distinto de ok:false transitório (GET falhou/family_id ainda
   *  não computado), que é retentável. Sem isto os dois casos colapsam num retry infinito. */
  inesperado?: boolean;
  familyId?: string;
  userProductId?: string;
  permalink?: string;
}

export interface PortasComposicao {
  listar(): Promise<FilhoComp[]>;
  /** Grava skus_esperados + mudando_composicao=true na raiz, atômico (passo 1). */
  iniciarComposicao(skusEsperados: string[]): Promise<void>;
  /** mudando_composicao=false na raiz (passo 4 / corolário do erro terminal). */
  limparComposicao(): Promise<void>;
  reservar(sku: string): Promise<void>;                       // insert-if-absent (pendente)
  salvarStatus(sku: string, status: StatusFilho): Promise<void>;
  salvarCriado(sku: string, itemExternoId: string): Promise<void>;   // status=criado + id
  salvarConfirmacao(sku: string, dados: { familyId: string; userProductId?: string; permalink?: string }): Promise<void>;
  marcarAtivo(sku: string): Promise<void>;                    // status=ativo, retirado=false
  marcarRetirado(sku: string): Promise<void>;                 // status=pausado, retirado=true
  buscarPorSku(sku: string): Promise<BuscaSku>;
  criarPlano(sku: string): Promise<{ itemExternoId: string; permalink: string }>;
  confirmar(itemExternoId: string): Promise<ConfirmacaoComp>;
  ativar(itemExternoId: string): Promise<void>;
  pausar(itemExternoId: string): Promise<void>;
  repor(itemExternoId: string, patch: { available_quantity: number; price?: number }): Promise<void>;
}

export interface EntradaComposicao {
  skusDesejados: string[];
  estoquePorSku: Record<string, number>;
  precoFamilia: number | null;
  somenteEstoque: boolean;
  /** family_id das cores existentes (validação da cor nova). null → sem validação (sem cor viva). */
  familyIdEsperado: string | null;
}

export type ResultadoComposicao =
  | { tipo: 'sem_mudanca' }              // nenhuma mudança de composição — só reposição rodou
  | { tipo: 'concluido'; criadas: string[] } // composição aplicada; `criadas` = cores GENUINAMENTE
                                        // novas (POST/adoção, não readd) — base do reenfileirar catálogo
  | { tipo: 'incompleto' }              // transiente (confirmação não obtida) — flag persiste, retoma depois
  // 3 membros separados (não `codigo: 'a' | 'b' | 'c'` num só) — com um `codigo` de tipo união dentro
  // de UM membro, o TS não discrimina esse membro contra `filho_em_estado_terminal` (a checagem
  // `resultado.codigo === 'x'` não elimina o membro inteiro), e o acesso a `.sku`/`.status` no branch
  // final do consumidor (atualizar-familia-up.ts) falhava o type-check mesmo com `tipo` já = 'erro'.
  | { tipo: 'erro'; codigo: 'familia_up_desagrupada' }
  | { tipo: 'erro'; codigo: 'busca_ambigua' }
  | { tipo: 'erro'; codigo: 'estado_remoto_inesperado' }
  | { tipo: 'erro'; codigo: 'filho_em_estado_terminal'; sku: string; status: StatusFilho };

async function reposicao(portas: PortasComposicao, entrada: EntradaComposicao, desejados: Set<string>): Promise<void> {
  // Reposição de estoque/preço em TODOS os filhos que ficam ativos e não-retirados (os
  // recém-pausados/retirados já saem por retirado=true). ADR: {available_quantity, ...(somenteEstoque?{}:{price})}.
  const filhos = await portas.listar();
  for (const f of filhos) {
    if (f.retirado || !f.itemExternoId || !desejados.has(f.sku)) continue;
    const estoque = entrada.estoquePorSku[f.sku] ?? 0;
    const patch = entrada.somenteEstoque || entrada.precoFamilia == null
      ? { available_quantity: estoque }
      : { available_quantity: estoque, price: entrada.precoFamilia };
    await portas.repor(f.itemExternoId, patch);
  }
}

export async function atualizarComposicao(
  portas: PortasComposicao,
  entrada: EntradaComposicao,
): Promise<ResultadoComposicao> {
  const desejados = entrada.skusDesejados;
  const desejadosSet = new Set(desejados);

  const filhos = await portas.listar();
  const naoRetirados = filhos.filter((f) => !f.retirado);

  // paraRetirar: filho não-retirado cujo SKU saiu do conjunto desejado.
  const paraRetirar = naoRetirados.filter((f) => !desejadosSet.has(f.sku));

  // Estados de um filho NÃO-retirado que NÃO podem ser reativados/retomados em silêncio: são
  // terminais/administrativos, exigem intervenção manual (a saga de CRIAÇÃO já produz `erro`/
  // `compensacao_pendente`; `remocao_pendente` e `pausado`-não-retirado são administrativos). Só
  // `pendente`/`criado`/`criacao_incerta` são retomáveis (ainda em transição de criação). Reativar
  // cegamente um filho terminal mascararia um erro que o operador precisa resolver primeiro.
  const filhoPorSku = new Map(filhos.map((f) => [f.sku, f]));
  for (const sku of desejados) {
    const f = filhoPorSku.get(sku);
    if (!f || f.retirado) continue;                          // sem filho vivo, ou retirado (readd) → ok
    if (f.status === 'ativo' && f.itemExternoId) continue;   // já ativo → nada a fazer
    if (BLOQUEIO_REATIVACAO.has(f.status) || (f.status === 'pausado' && !f.retirado)) {
      return { tipo: 'erro', codigo: 'filho_em_estado_terminal', sku: f.sku, status: f.status };
    }
  }

  // paraAdicionar: SKU desejado sem um filho não-retirado JÁ ATIVO. Usar 'ativo' (não só "tem id")
  // garante retomada: uma cor deixada em 'criado'/'criacao_incerta' por crash é reprocessada.
  const jaAtivos = new Set(naoRetirados.filter((f) => f.status === 'ativo' && f.itemExternoId).map((f) => f.sku));
  const paraAdicionar = desejados.filter((sku) => !jaAtivos.has(sku));

  if (paraRetirar.length === 0 && paraAdicionar.length === 0) {
    await reposicao(portas, entrada, desejadosSet);
    return { tipo: 'sem_mudanca' };
  }

  // 1. persistir o novo conjunto + ligar o marcador transitório ANTES de qualquer chamada remota.
  await portas.iniciarComposicao(desejados);

  const acharFilho = (sku: string) => filhos.find((f) => f.sku === sku);

  // Erro remoto TERMINAL (item errado / seller divergente, ou family_id divergente): isola a cor em
  // `erro` + limpa a flag + para. Espelha `estado_remoto_inesperado`/`familia_up_desagrupada` da saga
  // de criação (nunca retry cego). NÃO pausa as cores vivas (família já publicada).
  const erroRemotoInesperado = async (
    sku: string,
    codigo: 'estado_remoto_inesperado' | 'familia_up_desagrupada' = 'estado_remoto_inesperado',
  ): Promise<ResultadoComposicao> => {
    await portas.salvarStatus(sku, 'erro');
    await portas.limparComposicao();
    return { tipo: 'erro', codigo };
  };

  const criadas: string[] = [];       // cores GENUINAMENTE novas nesta chamada (não readd) — Fix 5.
  const familyIdsVistos = new Set<string>(); // Fix 6: sem referência viva, exigir 1 family_id entre as novas.

  // Valida um family_id confirmado contra a referência (viva, ou entre as próprias novas desta
  // chamada — Fix 6) e isola a cor em erro terminal se divergir. Chamado nas DUAS confirmações
  // (pré e pós-ativação, revisão v3): o GET pós-ativar() pode devolver um family_id diferente do
  // pré-ativação (reagrupamento no meio) e isso NÃO pode passar batido.
  const validarFamilyId = (sku: string, familyId: string): Promise<ResultadoComposicao> | null => {
    if (entrada.familyIdEsperado != null) {
      if (familyId !== entrada.familyIdEsperado) return erroRemotoInesperado(sku, 'familia_up_desagrupada');
    } else {
      familyIdsVistos.add(familyId);
      if (familyIdsVistos.size > 1) return erroRemotoInesperado(sku, 'familia_up_desagrupada');
    }
    return null;
  };

  // 2-3. adicionar cada cor (nova genuína ou readicionada) → item ativo confirmado.
  for (const sku of paraAdicionar) {
    const existente = acharFilho(sku);
    const readd = !!existente && existente.retirado && !!existente.itemExternoId;
    let itemId: string | null = existente?.itemExternoId ?? null;

    if (!readd && !itemId) {
      // cor genuinamente nova: reservar → criacao_incerta ANTES do POST → buscarPorSku → adotar/criar.
      await portas.reservar(sku);
      await portas.salvarStatus(sku, 'criacao_incerta');
      const busca = await portas.buscarPorSku(sku);
      if (busca.tipo === 'ambiguo' || busca.tipo === 'truncado') {
        await portas.salvarStatus(sku, 'erro');
        await portas.limparComposicao();
        return { tipo: 'erro', codigo: 'busca_ambigua' };
      }
      itemId = busca.tipo === 'um' ? busca.itemExternoId : (await portas.criarPlano(sku)).itemExternoId;
      await portas.salvarCriado(sku, itemId);   // tira de criacao_incerta (status=criado + id)
      await portas.pausar(itemId);              // staging (ML cria ativo por padrão)
    }
    // Revisão v3 (Codex): `criadas` precisa contar TODA cor não-readd, mesmo se o POST aconteceu
    // numa tentativa ANTERIOR (crash antes de confirmar/ativar) — senão uma cor nunca vinculada ao
    // catálogo nunca dispara o opt-in se a 1ª tentativa não fechar (base do reenfileirar catálogo).
    if (!readd) criadas.push(sku);

    // confirmar family_id ANTES de ativar (readd/criado estão pausados aqui).
    const conf = await portas.confirmar(itemId!);
    if (conf.inesperado) return erroRemotoInesperado(sku); // GET ok mas item errado → terminal.
    if (!conf.ok) return { tipo: 'incompleto' };   // GET falhou / family_id ainda não computado → transiente.
    const erroFamilyId = await validarFamilyId(sku, conf.familyId!);
    if (erroFamilyId) return erroFamilyId;
    await portas.salvarConfirmacao(sku, {
      familyId: conf.familyId!, userProductId: conf.userProductId, permalink: conf.permalink,
    });

    await portas.ativar(itemId!);
    const confAtivo = await portas.confirmar(itemId!);
    if (confAtivo.inesperado) return erroRemotoInesperado(sku);
    if (!confAtivo.ok || confAtivo.status !== 'active') return { tipo: 'incompleto' };
    // Revalida o family_id da confirmação PÓS-ativação (revisão v3): o ML pode reagrupar entre as
    // duas chamadas de GET; nunca ativar/marcar a cor sem confirmar que o agrupamento se manteve.
    const erroFamilyIdPosAtivacao = await validarFamilyId(sku, confAtivo.familyId!);
    if (erroFamilyIdPosAtivacao) return erroFamilyIdPosAtivacao;
    await portas.marcarAtivo(sku);   // status=ativo, retirado=false (limpa readd)
  }

  // 2-3. retirar cada cor: pausar + confirmar pausado.
  const retiradosConfirmados: string[] = [];
  for (const f of paraRetirar) {
    if (!f.itemExternoId) { retiradosConfirmados.push(f.sku); continue; }  // nunca subiu → só marca.
    await portas.pausar(f.itemExternoId);
    const conf = await portas.confirmar(f.itemExternoId);
    if (conf.inesperado) return erroRemotoInesperado(f.sku); // item errado ao pausar → terminal.
    if (!conf.ok || conf.status !== 'paused') return { tipo: 'incompleto' };
    retiradosConfirmados.push(f.sku);
  }

  // 4. concluir: retirado=true (só após pausa confirmada) e limpar mudando_composicao.
  for (const sku of retiradosConfirmados) await portas.marcarRetirado(sku);
  await portas.limparComposicao();

  await reposicao(portas, entrada, desejadosSet);
  return { tipo: 'concluido', criadas };
}
