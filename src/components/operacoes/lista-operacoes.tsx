// ADR-0174 — aba "Operações": lista de operações em massa da org, detalhe por item e Reverter
// (nova operação com a ação inversa, origem_id apontando a original).
import { useMemo, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { BorderTrail } from '@/components/ui/border-trail';
// `glow-effect-sombra` mora no CSS do GlowEffect (mesma aura do diálogo "processando" do cadastro).
import '@/components/ui/glow-effect.css';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { formatarNomeProduto } from '@/lib/texto';
import { useNomesUsuarios } from '@/hooks/useNomesUsuarios';
import { useItensOperacao, useOperacao, useOperacaoPorOrigem, useOperacoes, usePodeExecutarOperacao, useRetomarOperacao, type ItemOperacaoRow, type OperacaoRow } from '@/hooks/useOperacoes';
import { useItensPromocao } from '@/hooks/usePromocoes';
import { ROTULO_STATUS, ehTipoOperavel, inversa, itensRevertiveis, ehAcaoStatus, precisaRetomar, tituloOperacao, totalDoTitulo, type AcaoOperacao, type AcaoStatus, type StatusItemOperacao } from '@/lib/operacoes';
import type { ItemPromocao } from '@/lib/promocoes';
import { PreviewOperacao } from '@/components/promocoes/preview-operacao';
import { PreviewStatus } from './preview-status';
import { PreviewReajuste } from './preview-reajuste';
import { fmtBRL } from '@/lib/formato';

const TONE_STATUS: Record<StatusItemOperacao, StatusTone> = {
  rascunho: 'neutral', pendente: 'neutral', enviando: 'info', conferindo: 'info', aplicado: 'success', ja_estava: 'success',
  mudou: 'warning', bloqueado: 'neutral', erro: 'danger', saida_solicitada: 'info',
};
// Ordem estável dos chips: a mesma do enum, não a ordem de inserção do array de itens.
const ORDEM_STATUS = Object.keys(ROTULO_STATUS) as StatusItemOperacao[];
const NAO_TERMINAL: StatusItemOperacao[] = ['pendente', 'enviando', 'conferindo'];
const MOTIVO_NAO_REVERTIVEL = 'Não revertível: o anúncio não está mais convidado/participando';
const MOTIVO_NAO_RETENTAVEL = 'Não dá para tentar de novo: o anúncio não está mais convidado/participando';
// Revisão Grok (achado IMPORTANTE): status de item que prova que a reversão pegou pelo menos um
// anúncio; sem nenhum destes (tudo erro/mudou/bloqueado — `encerrarComErro`) não conta como revertida.
const ITENS_REVERSAO_OK: StatusItemOperacao[] = ['aplicado', 'ja_estava'];

// Só `executando` é "Executando" (rascunho nem chega à lista; fica de fallback neutro).
const STATUS_OPERACAO: Record<string, { rotulo: string; tone: StatusTone }> = {
  executando: { rotulo: 'Executando', tone: 'info' }, concluida: { rotulo: 'Concluída', tone: 'success' },
};
const statusOperacao = (s: string) => STATUS_OPERACAO[s] ?? { rotulo: 'Rascunho', tone: 'neutral' as StatusTone };

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Item da Central para a linha do Reverter; quando o anúncio saiu do cache (ex.: saída SMART apaga
 *  a linha de `ml_promocao_itens`), usa um "stub" com os dados do próprio log da operação — o
 *  status vazio nunca bate com o exigido pela ação inversa, então a linha cai em `naoRevertiveis`. */
function itemAtualOuStub(id: string, doCentral: Map<string, ItemPromocao>, doLog: ItemOperacaoRow): ItemPromocao {
  return doCentral.get(id) ?? {
    ml_item_id: id, status: '', preco_original: null, preco_promo: doLog.preco, preco_min: null, preco_max: null,
    preco_sugerido: null, preco_avaliado: null, ml_pct: null, estoque_min: null,
    titulo: doLog.titulo, thumbnail: null, permalink: null, projecao: [], pior_semaforo: 'indisponivel',
  };
}

// `status` chega como `string` do Supabase; o check constraint da tabela garante que é um dos StatusItemOperacao.
const paraRevertiveis = (itens: ItemOperacaoRow[]) => itens.map((i) => ({ ml_item_id: i.ml_item_id, status: i.status as StatusItemOperacao }));

/** Reverter: itens elegíveis pelo log da operação (`itensRevertiveis`) confrontados com o estado
 *  atual da Central — quem não está mais no estado exigido pela ação inversa entra em `naoRevertiveis`. */
function montarReversao(op: OperacaoRow, itensOp: ItemOperacaoRow[], itensCentral: ItemPromocao[]) {
  // `acao` chega `string`; o CHECK do banco garante uma AcaoOperacao. Pausar/reativar não tem reversão
  // de promoção (o Reverter de status vai por `PreviewStatus`) — `null` impede abrir o preview de promoção com ação errada.
  const acao = op.acao as AcaoOperacao;
  if (ehAcaoStatus(acao) || acao === 'reajustar') return null; // reajuste reverte pelo próprio preview (I5)
  const acaoNova = inversa(acao);
  const porLog = new Map(itensOp.map((i) => [i.ml_item_id, i]));
  const { itens, bloqueados: naoRevertiveis } = itensDoLog(acaoNova, itensRevertiveis(acao, paraRevertiveis(itensOp)), itensCentral, porLog, MOTIVO_NAO_REVERTIVEL);
  // Alterar preço (emenda 2026-11-03): reverte com outra alteração, de volta ao preço que a origem leu no ML.
  const simulados = acao === 'alterar_preco' ? new Map<string, number>() : undefined;
  if (simulados) {
    for (const { ml_item_id: id } of itens) {
      const anterior = porLog.get(id)?.preco_anterior;
      if (anterior == null) naoRevertiveis.set(id, 'Sem preço anterior registrado para reverter');
      else simulados.set(id, Number(anterior));
    }
  }
  return { acaoNova, itens, naoRevertiveis, simulados };
}

/** Itens da Central (ou stub do log) para um preview montado a partir do log; bloqueia quem não está mais no estado
 *  que a ação exige (aderir: convidado; sair/alterar: participando). */
function itensDoLog(
  acao: AcaoOperacao, ids: string[], itensCentral: ItemPromocao[], porLog: Map<string, ItemOperacaoRow>, motivo: string,
) {
  const porCentral = new Map(itensCentral.map((i) => [i.ml_item_id, i]));
  const bloqueados = new Map<string, string>();
  const itens = ids.map((id) => {
    const atual = itemAtualOuStub(id, porCentral, porLog.get(id)!);
    // Relâmpago: participando com convite de outro horário também é aderível (emenda 2026-11-08 (2)).
    const ok = acao === 'aderir' ? atual.status === 'candidate' || !!atual.convite_aberto : atual.status === 'started' || atual.status === 'pending';
    if (!ok) bloqueados.set(id, motivo);
    return atual;
  });
  return { itens, bloqueados };
}

/** "Tentar novamente" (pedido do Diego, 03/11 — ML 500 em 2 de 17 adesões): a MESMA ação, só os itens com erro, no
 *  preço que o operador escolheu na operação. Operação nova sem origem: passa por toda a validação do servidor. */
function montarRetentativa(op: OperacaoRow, itensOp: ItemOperacaoRow[], itensCentral: ItemPromocao[]) {
  const acao = op.acao as AcaoOperacao;
  const porLog = new Map(itensOp.map((i) => [i.ml_item_id, i]));
  const ids = itensOp.filter((i) => i.status === 'erro').map((i) => i.ml_item_id);
  const { itens, bloqueados } = itensDoLog(acao, ids, itensCentral, porLog, MOTIVO_NAO_RETENTAVEL);
  // Preço do log só onde o operador o escolheu (DEAL/LIGHTNING aderir, alterar preço); SMART e as ofertas fixas
  // (SMART_LIGHTNING, PRICE_MATCHING) têm preço do ML: a retentativa usa o preço atual da Central; sair não tem preço.
  const comPreco = acao === 'alterar_preco' || (acao === 'aderir' && (op.promocao_tipo === 'DEAL' || op.promocao_tipo === 'LIGHTNING'));
  const simulados = comPreco ? new Map<string, number>() : undefined;
  for (const id of ids) {
    const preco = porLog.get(id)?.preco;
    if (simulados && preco != null) simulados.set(id, Number(preco));
  }
  return { acaoNova: acao, itens, naoRevertiveis: bloqueados, simulados };
}

const ACOES_RETENTAVEIS: AcaoOperacao[] = ['aderir', 'sair', 'alterar_preco'];

function contarPorStatus(itens: { status: StatusItemOperacao }[]): Partial<Record<StatusItemOperacao, number>> {
  const c: Partial<Record<StatusItemOperacao, number>> = {};
  for (const i of itens) c[i.status] = (c[i.status] ?? 0) + 1;
  return c;
}

function CardOperacao({ op, quem, onAbrir }: { op: OperacaoRow; quem: string; onAbrir: () => void }) {
  // Reajuste: chips e progresso sobre os incluídos (fora/sem alteração/desmarcado não são trabalho) — igual ao título.
  const doLote = op.acao === 'reajustar' ? op.itens.filter((i) => i.incluido !== false) : op.itens;
  const contagem = contarPorStatus(doLote);
  const total = doLote.length;
  const emAndamento = doLote.filter((i) => NAO_TERMINAL.includes(i.status)).length;
  const feitos = total - emAndamento;
  const soAguardandoMl = op.status === 'executando' && emAndamento === 0 && (contagem.saida_solicitada ?? 0) > 0;

  // Rodando: o mesmo sinal de espera do cadastro de produto (aura `glow-effect-sombra`) + raio contornando a
  // borda; os dois somem sozinhos quando a operação termina (pedido do Diego, 03/11).
  const rodando = op.status === 'executando';
  return (
    <li aria-busy={rodando}>
      <BorderTrail active={rodando} radius={12} className="rounded-xl">
      {/* Achado Codex: alcance da aura (~14px) menor que o padding lateral da página (16px no celular),
          senão o overflow-x-hidden do app-shell corta o halo. */}
      <div className={cn('rounded-xl border bg-card shadow-xs',
        rodando && 'glow-effect-sombra [--glow-sombra-halo:12px] [--glow-sombra-nucleo:8px] [--glow-sombra-spread:2px]')}>
      <button type="button" onClick={onAbrir}
        className="w-full rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{tituloOperacao(op, total)}</p>
            <p className="text-xs text-muted-foreground">{dataHora(op.criado_em)} · {quem}</p>
          </div>
          <StatusPill tone={statusOperacao(op.status).tone} className="shrink-0">{statusOperacao(op.status).rotulo}</StatusPill>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ORDEM_STATUS.filter((s) => (contagem[s] ?? 0) > 0).map((s) => (
            <StatusPill key={s} tone={TONE_STATUS[s]}>{ROTULO_STATUS[s]} {contagem[s]}</StatusPill>
          ))}
        </div>
        {op.status === 'executando' && (
          soAguardandoMl ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-info">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Aguardando confirmação do ML
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Progress value={total > 0 ? Math.round((feitos / total) * 100) : 0} className="h-1.5" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{feitos}/{total}</span>
            </div>
          )
        )}
      </button>
      </div>
      </BorderTrail>
    </li>
  );
}

export function ListaOperacoes({ filtro }: { filtro?: 'promocao' | 'publicados' } = {}) {
  const operacoes = useOperacoes(filtro);
  const podeExecutar = usePodeExecutarOperacao();
  const { data: nomes } = useNomesUsuarios();
  const [abertaId, setAbertaId] = useState<string | null>(null);
  // Revisão UX (achado C): dados do preview de reversão num estado próprio, snapshot no momento
  // do clique — não pode depender de `opAberta`/`reversao`, que são zerados ao fechar o detalhe.
  const [reversaoAtiva, setReversaoAtiva] = useState<({ op: OperacaoRow } & NonNullable<ReturnType<typeof montarReversao>>) | null>(null);

  const [reversaoReajuste, setReversaoReajuste] = useState<string | null>(null);
  // Mesmo snapshot do Reverter, sem origem (origem_id = Reverter no servidor).
  const [retentativa, setRetentativa] = useState<({ op: OperacaoRow } & ReturnType<typeof montarRetentativa>) | null>(null);
  const [reversaoStatus, setReversaoStatus] = useState<{ op: OperacaoRow; itens: { ml_item_id: string; titulo: string | null }[] } | null>(null);

  const opAberta = operacoes.data?.find((o) => o.id === abertaId) ?? null;
  const itensOp = useItensOperacao(abertaId ?? '', opAberta?.status === 'executando');
  // Operação de status não carrega a Central.
  const central = useItensPromocao(opAberta && !ehAcaoStatus(opAberta.acao) ? opAberta.promocao_id ?? '' : '');
  // Fix round 2 (achado 4): a original pode ter saído da página de 50 de `useOperacoes` — busca
  // por id só quando não estiver na lista já carregada.
  const originalNaLista = opAberta?.origem_id ? operacoes.data?.find((o) => o.id === opAberta.origem_id) ?? null : null;
  const originalBuscada = useOperacao(opAberta?.origem_id && !originalNaLista ? opAberta.origem_id : null);
  const original = originalNaLista ?? originalBuscada.data ?? null;
  // Revisão UX (achado B): já foi revertida? (existe outra operação com origem_id = a desta).
  const revertidaNaLista = opAberta ? operacoes.data?.find((o) => o.origem_id === opAberta.id) ?? null : null;
  const buscandoRevertida = !!opAberta && !revertidaNaLista;
  const revertidaBuscada = useOperacaoPorOrigem(buscandoRevertida ? opAberta!.id : null);
  const revertida = revertidaNaLista ?? revertidaBuscada.data ?? null;
  // Revisão Grok (achado IMPORTANTE): `executando` ainda não terminou de reverter; `concluida` só
  // conta como revertida se pegou ao menos um item (senão `encerrarComErro` fechou tudo em erro e
  // o operador precisa poder tentar de novo — botão Reverter volta).
  const revertidaAndamento = revertida?.status === 'executando';
  const revertidaOk = revertida != null && revertida.status === 'concluida'
    && revertida.itens.some((i) => ITENS_REVERSAO_OK.includes(i.status));
  // Achado MENOR: enquanto a busca da reversão fora da página (achado B) ainda não voltou, não
  // mostra o botão — evita reabrir uma reversão que só não chegou ainda.
  const carregandoRevertida = buscandoRevertida && revertidaBuscada.isLoading;

  const idsRevertiveis = opAberta && itensOp.data
    ? itensRevertiveis(opAberta.acao as AcaoOperacao, paraRevertiveis(itensOp.data)) : [];
  // Reajuste: os itens já `aplicado` revertem mesmo com a operação executando (os `conferindo` não impedem).
  const podeReverter = podeExecutar && idsRevertiveis.length > 0
    && (opAberta?.status === 'concluida' || opAberta?.acao === 'reajustar');
  // Fix round 2 (achado 1): `useMemo` — sem isso, `reversao.itens`/`.naoRevertiveis` nascem com
  // referência nova a cada render e o `useEffect` do preview (que depende deles) reseta preços,
  // marcas e o checkbox de risco a cada refetch em segundo plano (foco, intervalo de 5 s).
  const reversao = useMemo(
    () => (opAberta && itensOp.data ? montarReversao(opAberta, itensOp.data, central.data ?? []) : null),
    [opAberta, itensOp.data, central.data],
  );

  // Reverter (tem origem) fica fora: recriar sem origem perderia a proteção do preço esperado (achado Codex).
  const comErro = opAberta && itensOp.data ? itensOp.data.filter((i) => i.status === 'erro').length : 0;
  const podeRetentar = podeExecutar && !!opAberta && opAberta.status === 'concluida' && !opAberta.origem_id
    && ACOES_RETENTAVEIS.includes(opAberta.acao as AcaoOperacao) && comErro > 0;
  function iniciarRetentativa() {
    if (!opAberta || !itensOp.data || !central.isSuccess) return;
    setRetentativa({ op: opAberta, ...montarRetentativa(opAberta, itensOp.data, central.data ?? []) });
    setAbertaId(null);
  }

  // Edição do % de atacado que não chegou ao banco (`nao_aplicado`): o preço pode ter mudado e a família segue como estava.
  const atacadoNaoConfirmado = (Array.isArray(opAberta?.atacado_familias) ? opAberta.atacado_familias as { familia_id: string; status?: string; motivo?: string | null }[] : [])
    .filter((e) => e?.status === 'nao_aplicado');
  const retomar = useRetomarOperacao();
  const podeRetomar = podeExecutar && !!opAberta && precisaRetomar(opAberta, itensOp.data ?? [], Date.now());
  async function retomarOperacao() {
    if (!opAberta) return;
    try {
      await retomar.mutateAsync(opAberta.id);
      toast.success('Operação retomada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível retomar a operação.');
    }
  }

  function nomeDe(id: string | null) {
    return (id && nomes?.get(id)) || id || '—';
  }
  function fecharDetalhe() {
    setAbertaId(null);
  }
  // Revisão UX (achado C): fecha o detalhe e abre só o preview de reversão — os dois `Sheet`
  // (Radix `Dialog.Root`) montados ao mesmo tempo tornavam o 1º clique em Reverter não-determinístico
  // (o Dialog que acabou de montar podia disparar o dismiss do que já estava aberto). Com um só
  // Sheet por vez a transição fica determinística, e como fechar o detalhe zera `opAberta`/
  // `reversao`, o necessário pro preview vai num snapshot em estado próprio.
  function iniciarReversao() {
    if (!opAberta) return;
    if (opAberta.acao === 'reajustar') {
      setReversaoReajuste(opAberta.id); // o preview do servidor relê a origem (itens `aplicado`)
    } else if (ehAcaoStatus(opAberta.acao)) {
      // Pausar/reativar: o handler revalida no ML; não há Central para confrontar.
      const porLog = new Map((itensOp.data ?? []).map((i) => [i.ml_item_id, i]));
      setReversaoStatus({
        op: opAberta,
        itens: idsRevertiveis.map((id) => ({ ml_item_id: id, titulo: porLog.get(id)?.titulo ?? null })),
      });
    } else if (reversao) {
      setReversaoAtiva({ op: opAberta, ...reversao });
    } else return;
    setAbertaId(null);
  }
  function fecharPreviewReversao() {
    setReversaoAtiva(null);
    setReversaoStatus(null);
    setReversaoReajuste(null);
  }

  if (operacoes.isLoading) {
    return <CarregandoMarca className="mt-4" rotulo="Carregando" mensagem="Lendo as operações…" />;
  }
  if ((operacoes.data ?? []).length === 0) {
    return (
      <EmptyState icon={History} title="Nenhuma operação ainda."
        description={filtro === 'promocao' ? 'Selecione anúncios numa campanha para aderir ou sair.' : 'Selecione anúncios na aba Anúncios para pausar, reativar ou reajustar o preço.'}
        className="mt-4" />
    );
  }

  return (
    <>
      <ul className="mt-4 flex flex-col gap-3">
        {operacoes.data!.map((op) => (
          <CardOperacao key={op.id} op={op} quem={nomeDe(op.criado_por)} onAbrir={() => setAbertaId(op.id)} />
        ))}
      </ul>

      <Sheet open={abertaId != null} onOpenChange={(o) => { if (!o) fecharDetalhe(); }}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          {opAberta && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">{tituloOperacao(opAberta, totalDoTitulo(opAberta))}</SheetTitle>
                <SheetDescription>
                  {dataHora(opAberta.criado_em)} · {nomeDe(opAberta.criado_por)}
                  {original && <><br />Reverte a operação de {dataHora(original.criado_em)}</>}
                </SheetDescription>
              </SheetHeader>
              <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto px-4">
                {(itensOp.data ?? []).map((it) => {
                  const status = it.status as StatusItemOperacao;
                  return (
                    <li key={it.ml_item_id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{formatarNomeProduto(it.titulo) || it.ml_item_id}</p>
                        <p className="text-xs text-muted-foreground">{it.ml_item_id}</p>
                        {opAberta.acao === 'reajustar' && it.preco_anterior != null && it.preco != null && (
                          <p className="text-xs tabular-nums">{fmtBRL(it.preco_anterior)} → {fmtBRL(it.preco)}</p>
                        )}
                        {it.mensagem && <p className="text-xs text-muted-foreground">{it.mensagem}</p>}
                      </div>
                      <StatusPill tone={TONE_STATUS[status]} className="shrink-0">{ROTULO_STATUS[status]}</StatusPill>
                    </li>
                  );
                })}
              </ul>
              {atacadoNaoConfirmado.length > 0 && (
                <ul className="flex flex-col gap-1 border-t px-4 py-3 text-sm" aria-label="Atacado não confirmado">
                  {atacadoNaoConfirmado.map((e) => (
                    <li key={e.familia_id}>
                      <p className="font-medium">Atacado da família não confirmado</p>
                      {e.motivo && <p className="text-xs text-muted-foreground">{e.motivo}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {podeRetomar && (
                <div className="flex items-center justify-between gap-3 border-t p-4">
                  <p className="text-sm text-muted-foreground">A conferência parou de rodar.</p>
                  <Button variant="outline" onClick={retomarOperacao} disabled={retomar.isPending}>Retomar</Button>
                </div>
              )}
              {podeRetentar && (
                <div className="flex items-center justify-between gap-3 border-t p-4">
                  <p className="text-sm text-muted-foreground">O ML recusou ou falhou em parte dos anúncios.</p>
                  {/* Central carregando ≠ item ausente: sem ela, o snapshot congelaria tudo como bloqueado (achado Codex). */}
                  <Button variant="outline" onClick={iniciarRetentativa} disabled={!central.isSuccess}>
                    Tentar novamente {comErro} com erro
                  </Button>
                </div>
              )}
              {podeReverter && !carregandoRevertida && (
                <div className="border-t p-4">
                  {revertidaAndamento ? (
                    <p className="text-sm text-muted-foreground">Reversão em andamento</p>
                  ) : revertidaOk ? (
                    <p className="text-sm text-muted-foreground">Revertida em {dataHora(revertida!.criado_em)}</p>
                  ) : (
                    <Button onClick={iniciarReversao}>Reverter</Button>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {reversaoStatus && (
        <PreviewStatus
          acao={inversa(reversaoStatus.op.acao as AcaoStatus)} itens={reversaoStatus.itens} foraDoLote={[]}
          origemId={reversaoStatus.op.id} aberto onFechar={fecharPreviewReversao} onCriada={() => { toast.success('Operação iniciada'); fecharPreviewReversao(); }}
        />
      )}

      {reversaoReajuste && (
        <PreviewReajuste
          pedido={{ origem_id: reversaoReajuste }} onFechar={fecharPreviewReversao}
          onCriada={() => { toast.success('Reversão iniciada'); fecharPreviewReversao(); }}
        />
      )}

      {retentativa && (
        <PreviewOperacao
          acao={retentativa.acaoNova as 'aderir' | 'sair' | 'alterar_preco'} tipo={ehTipoOperavel(retentativa.op.promocao_tipo) ? retentativa.op.promocao_tipo : 'DEAL'}
          promocaoId={retentativa.op.promocao_id ?? ''} promocaoNome={retentativa.op.promocao_nome ?? retentativa.op.promocao_id ?? ''}
          itens={retentativa.itens} origemId={null} naoRevertiveis={retentativa.naoRevertiveis} simulados={retentativa.simulados}
          aberto onClose={() => setRetentativa(null)} onSucesso={() => setRetentativa(null)}
        />
      )}

      {reversaoAtiva && (
        <PreviewOperacao
          acao={reversaoAtiva.acaoNova} tipo={ehTipoOperavel(reversaoAtiva.op.promocao_tipo) ? reversaoAtiva.op.promocao_tipo : 'DEAL'}
          promocaoId={reversaoAtiva.op.promocao_id ?? ''} promocaoNome={reversaoAtiva.op.promocao_nome ?? reversaoAtiva.op.promocao_id ?? ''}
          itens={reversaoAtiva.itens} origemId={reversaoAtiva.op.id} naoRevertiveis={reversaoAtiva.naoRevertiveis}
          simulados={reversaoAtiva.simulados}
          aberto onClose={fecharPreviewReversao} onSucesso={fecharPreviewReversao}
        />
      )}
    </>
  );
}
