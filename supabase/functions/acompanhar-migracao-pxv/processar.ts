// ADR-0161 — acompanha a migração UPtin até concluir, adota os anúncios novos e recompõe o estado.
//
// A API do ML não tem webhook de conclusão nem estado de falha: só dá para saber que terminou
// consultando `migration_live_listing` até `activation_completed` aparecer. Migração travada é
// indistinguível de migração lenta — por isso o orçamento é finito e o desfecho é sempre explícito.

import type { VariacaoSnapshot } from '../_shared/ml/migracao-pxv.ts';
import { casarNovosItens, type NovoItemML } from '../_shared/user-products/casar-migracao-pxv.ts';

/** Rodadas e espera. Longo enquanto o ML ainda cria os filhos; curto depois que eles existem, para
 *  encurtar a janela em que o clone já está no ar e o app ainda não o reconhece (é nessa janela que
 *  uma venda escaparia da baixa de estoque). */
export const DELAY_CRIANDO_S = 900;      // 15 min
export const DELAY_ATIVANDO_S = 60;      // 1 min, depois de `migration_completed`
export const MAX_TENTATIVAS = 24;        // ~6 h de orçamento total

export type ResultadoAcompanhamento =
  | { tipo: 'aguardando'; proximoDelayS: number }
  | { tipo: 'concluido'; skus: string[] }
  | { tipo: 'erro'; motivo: string }
  // Outra rodada já assumiu o episódio (claim perdido). Encerra em silêncio: agir aqui duplicaria
  // adoção e notificação.
  | { tipo: 'duplicado' };

export interface EstadoMigracao {
  mlItemIdAnterior: string;
  snapshot: VariacaoSnapshot[];
  status: string | null;
  tentativa: number;
}

export interface PortasAcompanhamento {
  /** Estado da raiz (partição 0) do pai. `null` = episódio não existe mais. */
  carregarEstado(): Promise<EstadoMigracao | null>;
  /** Claim atômico da rodada: `false` = outra cadeia já avançou. */
  assumirRodada(tentativaEsperada: number): Promise<boolean>;
  lerStatus(mlItemId: string): Promise<{
    encontrada: boolean; migracaoCompleta: string | null; ativacaoCompleta: string | null;
    novosItens: Array<{ itemId: string; variationId: string }>;
  }>;
  /** COLOR de cada anúncio novo (degrau b do casamento). */
  lerCores(itemIds: string[]): Promise<Map<string, string | null>>;
  /** Variações locais do pai: sku → ml_variation_id (desempate do snapshot sem SKU). */
  lerVariacoesLocais(): Promise<Array<{ codigo: string; mlVariationId: string | null }>>;
  /** Adoção do ADR-0104/0105 pelas portas de re-vínculo. Devolve mensagem quando não conclui. */
  adotar(itemPorSku: Map<string, string>): Promise<{ ok: boolean; mensagem?: string; retryavel?: boolean }>;
  /** Saldo local e vivo por SKU, para a trava anti-oversell. */
  lerSaldos(itemPorSku: Map<string, string>): Promise<Array<{ sku: string; local: number; vivo: number }>>;
  empurrarEstoque(skus: string[]): Promise<void>;
  /**
   * J9 — efeitos que a migração invalida.
   *
   * O vínculo de catálogo do anúncio antigo morre com ele (o listing de catálogo é um MLB próprio,
   * ADR-0021), então precisa ser refeito sobre os anúncios novos. E `atacado_status='aplicado'` só
   * continuaria verdadeiro se o ML copiasse o PxQ para os clones — o que não é documentado; deixar
   * "aplicado" faria o app afirmar que há preço de atacado no ar sem ninguém ter verificado.
   * Zerando, a próxima publicação reaplica.
   */
  reporEfeitosDaMigracao(): Promise<void>;
  reenfileirar(tentativa: number, delayS: number): Promise<void>;
  concluir(): Promise<void>;
  marcarErro(motivo: string): Promise<void>;
  notificar(texto: string): Promise<void>;
}

export async function acompanharMigracaoPxv(
  portas: PortasAcompanhamento,
  tentativa: number,
): Promise<ResultadoAcompanhamento> {
  const estado = await portas.carregarEstado();
  // Episódio encerrado por outra cadeia (ou pelo operador). Nada a fazer.
  if (!estado || estado.status == null || estado.status === 'erro') return { tipo: 'duplicado' };

  // Claim por rodada: sem ele, um 500 faz o QStash retentar enquanto a rodada anterior já se
  // re-enfileirou — duas cadeias chegam ao desfecho, adotam e notificam em dobro.
  if (!await portas.assumirRodada(tentativa)) return { tipo: 'duplicado' };

  const status = await portas.lerStatus(estado.mlItemIdAnterior);

  // Ainda não concluída: reagenda enquanto houver orçamento.
  if (!status.encontrada || status.ativacaoCompleta == null) {
    if (tentativa >= MAX_TENTATIVAS) {
      const motivo = status.encontrada
        ? 'A migração no Mercado Livre não terminou dentro do tempo esperado. O anúncio pode estar '
          + 'em transição — confira no painel do ML e publique uma atualização para o app reconciliar.'
        : 'O Mercado Livre não reconhece nenhuma migração para este anúncio. Se o pedido de migração '
          + 'falhou, nada foi alterado; se o anúncio já migrou, publique uma atualização para o app '
          + 'reconciliar.';
      await portas.marcarErro(motivo);
      await portas.notificar(motivo);
      return { tipo: 'erro', motivo };
    }
    // Depois de `migration_completed` os filhos já existem e só falta ativar — daí o passo curto.
    const delay = status.migracaoCompleta != null ? DELAY_ATIVANDO_S : DELAY_CRIANDO_S;
    await portas.reenfileirar(tentativa + 1, delay);
    return { tipo: 'aguardando', proximoDelayS: delay };
  }

  // ── Concluída no ML: casar e adotar ──────────────────────────────────────────────────────────
  const locais = await portas.lerVariacoesLocais();
  let casamento = casarNovosItens(estado.snapshot, status.novosItens, locais);

  // Degrau (b): só paga o GET das cores se o casamento por id não fechou.
  if (casamento.tipo === 'falha') {
    const cores = await portas.lerCores(status.novosItens.map((n) => n.itemId));
    const comCor: NovoItemML[] = status.novosItens.map((n) => ({
      ...n, cor: cores.get(n.itemId) ?? null,
    }));
    casamento = casarNovosItens(estado.snapshot, comCor, locais);
  }

  if (casamento.tipo === 'falha') {
    await portas.marcarErro(casamento.motivo);
    await portas.notificar(`Migração concluída no Mercado Livre, mas o app não conseguiu vincular os anúncios novos. ${casamento.motivo}`);
    return { tipo: 'erro', motivo: casamento.motivo };
  }

  const adocao = await portas.adotar(casamento.itemPorSku);
  if (!adocao.ok) {
    // `emMigracao` na adoção é transitório: a tag `_pending` do ML e `activation_completed` podem
    // não cair juntos. Retentar é o certo; marcar erro mandaria o operador agir à toa.
    if (adocao.retryavel && tentativa < MAX_TENTATIVAS) {
      await portas.reenfileirar(tentativa + 1, DELAY_ATIVANDO_S);
      return { tipo: 'aguardando', proximoDelayS: DELAY_ATIVANDO_S };
    }
    const motivo = adocao.mensagem ?? 'Não foi possível vincular os anúncios novos.';
    await portas.marcarErro(motivo);
    await portas.notificar(motivo);
    return { tipo: 'erro', motivo };
  }

  // ── Pós-adoção ───────────────────────────────────────────────────────────────────────────────
  // Estoque com trava anti-oversell. Empurrar o saldo local cegamente é perigoso: se houve venda no
  // clone antes de o app reconhecê-lo, o webhook chegou com um item que ainda não era "do PubliAI",
  // a baixa não aconteceu, e o saldo local ficou ALTO DEMAIS — o push restauraria unidades já
  // vendidas. Venda no anúncio ORIGINAL durante a migração é baixada normalmente, então
  // `local <= vivo` é o caso legítimo.
  const saldos = await portas.lerSaldos(casamento.itemPorSku);
  const seguros = saldos.filter((s) => s.local <= s.vivo).map((s) => s.sku);
  const suspeitos = saldos.filter((s) => s.local > s.vivo);
  if (seguros.length > 0) await portas.empurrarEstoque(seguros);

  // Catálogo e atacado do anúncio antigo não sobrevivem à migração (J9).
  await portas.reporEfeitosDaMigracao();

  await portas.concluir();

  const skus = [...casamento.itemPorSku.keys()];
  let texto = `Migração para preço por variação concluída: ${skus.length} cores agora são anúncios `
    + 'separados no Mercado Livre, cada uma com preço próprio.';
  if (suspeitos.length > 0) {
    texto += ` Atenção: o estoque de ${suspeitos.map((s) => s.sku).join(', ')} não foi enviado porque `
      + 'o saldo do app está maior que o do anúncio novo — pode haver venda ainda não registrada. '
      + 'Confira os pedidos antes de repor.';
  }
  await portas.notificar(texto);
  return { tipo: 'concluido', skus };
}
