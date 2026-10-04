// ADR-0174 — aba "Operações": lista de operações em massa da org, detalhe por item e Reverter
// (nova operação com a ação inversa, origem_id apontando a original).
import { useMemo, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { formatarNomeProduto } from '@/lib/texto';
import { useNomesUsuarios } from '@/hooks/useNomesUsuarios';
import { useItensOperacao, useOperacao, useOperacaoPorOrigem, useOperacoes, usePodeExecutarOperacao, type ItemOperacaoRow, type OperacaoRow } from '@/hooks/useOperacoes';
import { useItensPromocao } from '@/hooks/usePromocoes';
import { ROTULO_STATUS, inversa, itensRevertiveis, type AcaoOperacao, type AcaoPromocao, type StatusItemOperacao } from '@/lib/operacoes';
import type { ItemPromocao } from '@/lib/promocoes';
import { PreviewOperacao } from './preview-operacao';

const TONE_STATUS: Record<StatusItemOperacao, StatusTone> = {
  pendente: 'neutral', enviando: 'info', aplicado: 'success', ja_estava: 'success',
  mudou: 'warning', bloqueado: 'neutral', erro: 'danger', saida_solicitada: 'info',
};
// Ordem estável dos chips: a mesma do enum, não a ordem de inserção do array de itens.
const ORDEM_STATUS = Object.keys(ROTULO_STATUS) as StatusItemOperacao[];
const NAO_TERMINAL: StatusItemOperacao[] = ['pendente', 'enviando'];
const MOTIVO_NAO_REVERTIVEL = 'Não revertível: o anúncio não está mais convidado/participando';
// Revisão Grok (achado IMPORTANTE): status de item que prova que a reversão pegou pelo menos um
// anúncio; sem nenhum destes (tudo erro/mudou/bloqueado — `encerrarComErro`) não conta como revertida.
const ITENS_REVERSAO_OK: StatusItemOperacao[] = ['aplicado', 'ja_estava'];

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const tituloOperacao = (op: Pick<OperacaoRow, 'acao' | 'promocao_nome' | 'promocao_id'>) =>
  `${op.acao === 'aderir' ? 'Aderir à' : 'Sair de'} ${op.promocao_nome ?? op.promocao_id}`;

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
  const acaoNova = inversa(op.acao as AcaoPromocao); // Task 7 passa a listar só promoções aqui
  const ids = itensRevertiveis(op.acao as AcaoOperacao, paraRevertiveis(itensOp));
  const porCentral = new Map(itensCentral.map((i) => [i.ml_item_id, i]));
  const porLog = new Map(itensOp.map((i) => [i.ml_item_id, i]));
  const naoRevertiveis = new Map<string, string>();
  const itens = ids.map((id) => {
    const atual = itemAtualOuStub(id, porCentral, porLog.get(id)!);
    const ok = acaoNova === 'aderir' ? atual.status === 'candidate' : atual.status === 'started' || atual.status === 'pending';
    if (!ok) naoRevertiveis.set(id, MOTIVO_NAO_REVERTIVEL);
    return atual;
  });
  return { acaoNova, itens, naoRevertiveis };
}

function contarPorStatus(itens: { status: StatusItemOperacao }[]): Partial<Record<StatusItemOperacao, number>> {
  const c: Partial<Record<StatusItemOperacao, number>> = {};
  for (const i of itens) c[i.status] = (c[i.status] ?? 0) + 1;
  return c;
}

function CardOperacao({ op, quem, onAbrir }: { op: OperacaoRow; quem: string; onAbrir: () => void }) {
  const contagem = contarPorStatus(op.itens);
  const total = op.itens.length;
  const emAndamento = op.itens.filter((i) => NAO_TERMINAL.includes(i.status)).length;
  const feitos = total - emAndamento;
  const soAguardandoMl = op.status === 'executando' && emAndamento === 0 && (contagem.saida_solicitada ?? 0) > 0;

  return (
    <li className="rounded-xl border bg-card shadow-xs">
      <button type="button" onClick={onAbrir}
        className="w-full rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{tituloOperacao(op)}</p>
            <p className="text-xs text-muted-foreground">{dataHora(op.criado_em)} · {quem}</p>
          </div>
          <StatusPill tone={op.status === 'concluida' ? 'success' : 'info'} className="shrink-0">
            {op.status === 'concluida' ? 'Concluída' : 'Executando'}
          </StatusPill>
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
    </li>
  );
}

export function ListaOperacoes() {
  const operacoes = useOperacoes();
  const podeExecutar = usePodeExecutarOperacao();
  const { data: nomes } = useNomesUsuarios();
  const [abertaId, setAbertaId] = useState<string | null>(null);
  // Revisão UX (achado C): dados do preview de reversão num estado próprio, snapshot no momento
  // do clique — não pode depender de `opAberta`/`reversao`, que são zerados ao fechar o detalhe.
  const [reversaoAtiva, setReversaoAtiva] = useState<({ op: OperacaoRow } & ReturnType<typeof montarReversao>) | null>(null);

  const opAberta = operacoes.data?.find((o) => o.id === abertaId) ?? null;
  const itensOp = useItensOperacao(abertaId ?? '', opAberta?.status === 'executando');
  const central = useItensPromocao(opAberta?.promocao_id ?? '');
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

  const idsRevertiveis = opAberta && itensOp.data ? itensRevertiveis(opAberta.acao as AcaoOperacao, paraRevertiveis(itensOp.data)) : [];
  const podeReverter = podeExecutar && opAberta?.status === 'concluida' && idsRevertiveis.length > 0;
  // Fix round 2 (achado 1): `useMemo` — sem isso, `reversao.itens`/`.naoRevertiveis` nascem com
  // referência nova a cada render e o `useEffect` do preview (que depende deles) reseta preços,
  // marcas e o checkbox de risco a cada refetch em segundo plano (foco, intervalo de 5 s).
  const reversao = useMemo(
    () => (opAberta && itensOp.data ? montarReversao(opAberta, itensOp.data, central.data ?? []) : null),
    [opAberta, itensOp.data, central.data],
  );

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
    if (!opAberta || !reversao) return;
    setReversaoAtiva({ op: opAberta, ...reversao });
    setAbertaId(null);
  }
  function fecharPreviewReversao() {
    setReversaoAtiva(null);
  }

  if (operacoes.isLoading) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }
  if ((operacoes.data ?? []).length === 0) {
    return (
      <EmptyState icon={History} title="Nenhuma operação ainda."
        description="Selecione anúncios numa campanha para aderir ou sair." className="mt-4" />
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
                <SheetTitle className="pr-8">{tituloOperacao(opAberta)}</SheetTitle>
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
                        {it.mensagem && <p className="text-xs text-muted-foreground">{it.mensagem}</p>}
                      </div>
                      <StatusPill tone={TONE_STATUS[status]} className="shrink-0">{ROTULO_STATUS[status]}</StatusPill>
                    </li>
                  );
                })}
              </ul>
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

      {reversaoAtiva && (
        <PreviewOperacao
          acao={reversaoAtiva.acaoNova} tipo={reversaoAtiva.op.promocao_tipo === 'SMART' ? 'SMART' : 'DEAL'}
          promocaoId={reversaoAtiva.op.promocao_id ?? ''} promocaoNome={reversaoAtiva.op.promocao_nome ?? reversaoAtiva.op.promocao_id ?? ''}
          itens={reversaoAtiva.itens} origemId={reversaoAtiva.op.id} naoRevertiveis={reversaoAtiva.naoRevertiveis}
          aberto onClose={fecharPreviewReversao} onSucesso={fecharPreviewReversao}
        />
      )}
    </>
  );
}
