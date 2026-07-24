// ADR-0088 Fase 2 — mini-saga de REMOÇÃO de uma família UP já publicada (seção "Remoção de família
// UP — pausar todos os filhos no ML, depois deletar local em cascata", comportamento NOVO — o
// Legacy não toca o ML na remoção, fora de escopo, intocado).
//
// Diferente da mini-saga de COMPOSIÇÃO (atualizar-composicao.ts, que roda dentro de um worker QStash
// com orçamento de retry de fila): `remover-publicado` é síncrona, chamada direto pelo operador
// clicando "Remover" — não há retry automático. Por isso o algoritmo é TRY-ALL, não fail-fast: tenta
// pausar+confirmar TODOS os filhos alcançáveis a cada chamada (pausar é idempotente, é o estado-alvo,
// tentar todos é progresso puro e sem custo) — cada clique do operador maximiza o avanço, em vez de
// travar no primeiro filho lento/falho e nunca tentar os demais.
//
// Nunca confia em estado LOCAL sem confirmar por GET a REALIDADE do ML — nem status='pausado', nem
// retirado=true (tombstone). Um crash no readd da composição (entre ativar() remoto ter sucesso e
// marcarAtivo() local, que só então limpa retirado) pode deixar retirado=true genuinamente ATIVO no
// ML (revisão adversarial round 2); reconfirma TODO filho com itemExternoId, retirado ou não. Só
// retorna `pronto_para_deletar` quando TODOS confirmam pausado (ou o item já sumiu no ML, 404/410 —
// seguro); se algum falhar, marca `remocao_pendente` (exceto `criacao_incerta` sem id, que fica
// pendente SEM sobrescrever o status, pra não bloquear a adoção de órfão da própria composição) e
// retorna `incompleto` com a lista de pendentes — preserva todas as linhas, nunca deleta parcial.

import type { FilhoComp, ConfirmacaoComp } from './atualizar-composicao.ts';

export type { FilhoComp, ConfirmacaoComp };

export interface PortasRemocao {
  pausar(itemExternoId: string): Promise<void>;
  /** Confirmação SIMPLIFICADA (sem checagem de family_id — ao contrário do `confirmar` da
   *  composição): um item genuinamente pausado pode ter family_id ausente/lagado no ML e isso
   *  NUNCA deve impedir a remoção de convergir. */
  confirmar(itemExternoId: string): Promise<ConfirmacaoComp>;
  salvarStatus(sku: string, status: string): Promise<void>;
}

export type ResultadoRemocaoUP =
  | { tipo: 'pronto_para_deletar' }
  | { tipo: 'incompleto'; pendentes: string[] };

export async function removerComposicaoUP(
  portas: PortasRemocao,
  filhos: FilhoComp[],
): Promise<ResultadoRemocaoUP> {
  // Best-effort, nunca deixa o registro do pendente derrubar o TRY-ALL (revisão Codex): se o
  // próprio `salvarStatus` rejeitar, isso NÃO pode propagar e interromper os filhos seguintes.
  const marcarPendente = async (sku: string): Promise<void> => {
    try { await portas.salvarStatus(sku, 'remocao_pendente'); }
    catch (e) { console.error(`removerComposicaoUP: salvarStatus falhou (${sku}):`, e); }
  };

  const pendentes: string[] = [];
  for (const f of filhos) {
    if (!f.itemExternoId) {
      // Revisão Codex round 2: `criacao_incerta` é o ÚNICO status sem id que pode esconder um POST
      // real já aceito no ML (a composição grava status='criado'+id JUNTOS — todo outro status
      // sem id é genuinamente pré-POST). Nunca trivialmente "ok" aqui — bloqueia a remoção até a
      // PRÓPRIA saga de composição (buscarPorSku) adotar o órfão num retry/UPDATE futuro. NÃO
      // chama marcarPendente: `remocao_pendente` está em BLOQUEIO_REATIVACAO da composição e
      // impediria justamente a adoção de órfão que resolveria isso — preserva o status como está.
      if (f.status === 'criacao_incerta') pendentes.push(f.sku);
      continue;
    }
    // Revisão Codex round 2: NUNCA confia em `retirado=true` como "tombstone seguro, pula" — um
    // crash no readd da composição (entre ativar() remoto ter sucesso e marcarAtivo() local, que só
    // então limpa retirado) deixa a linha retirado=true LOCALMENTE mas ATIVA de verdade no ML, e o
    // catch genérico do adapter pode limpar mudando_composicao mesmo em falha transitória — o gate
    // de mudando_composicao sozinho não cobre essa janela. Reconfirma TODO filho com itemExternoId,
    // retirado ou não: a remoção verifica a REALIDADE do ML, nunca confia num flag local.
    try {
      await portas.pausar(f.itemExternoId);
      const conf = await portas.confirmar(f.itemExternoId);
      if (conf.inesperado || !conf.ok || conf.status !== 'paused') {
        pendentes.push(f.sku);
        await marcarPendente(f.sku);
      }
    } catch (e) {
      // 404/410 = item genuinamente sumido no ML (delete manual, purga, histórico) = SEGURO pra
      // remoção prosseguir — sem este caso especial, reconfirmar retirados (acima) travaria um
      // tombstone cujo item some independentemente em `remocao_pendente` permanente (nada resolve,
      // o item nunca volta). Qualquer outro erro (rede, 5xx, timeout) continua pendente/incompleto.
      // Nota (revisão Codex): na porta real (`processar.ts`), só `pausar()` (PUT, via
      // `atualizarStatusML`) LANÇA com `.status` anexado — `confirmar()` (GET, via `buscarItemUP`)
      // converte todo não-2xx em retorno `null`/`ok:false` sem lançar, então este catch só
      // intercepta 404/410 vindos do PUT na prática hoje. Documentado aqui porque a porta é uma
      // interface (`PortasRemocao`) — uma implementação futura de `confirmar()` que lance também
      // se beneficia do mesmo tratamento, sem exigir mudança nesta função.
      const status = (e as { status?: number } | null)?.status;
      if (status === 404 || status === 410) continue;
      // TRY-ALL de verdade (revisão Codex): pausar()/confirmar() podem REJEITAR (rede, HTTP não-2xx
      // de atualizarStatusML, timeout do GET) — sem este catch, uma exceção no filho N para o loop
      // inteiro e os filhos N+1..M nunca são tentados, contradizendo o propósito de "cada clique do
      // operador maximiza o progresso". Trata como pendente, igual a uma confirmação que falhou.
      console.error(`removerComposicaoUP: pausar/confirmar falhou (${f.itemExternoId}):`, e);
      pendentes.push(f.sku);
      await marcarPendente(f.sku);
    }
  }

  if (pendentes.length > 0) return { tipo: 'incompleto', pendentes };
  return { tipo: 'pronto_para_deletar' };
}
