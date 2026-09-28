// ADR-0174 — preview de "Aderir"/"Sair" no detalhe da campanha; reutilizado pelo Reverter.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL, fmtBRLSemSimbolo } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { cn } from '@/lib/utils';
import {
  montarPreview, parsePreco, precisaConfirmarRisco, semaforoNoPreco,
  type AcaoOperacao, type LinhaPreview,
} from '@/lib/operacoes';
import type { ItemPromocao } from '@/lib/promocoes';
import { ErroOperacao, useCriarOperacao, usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import { SEMAFORO_UI } from './contagem-semaforo';

interface LinhaEditavel extends LinhaPreview {
  precoTexto: string;
  motivoBloqueio?: string;
  motivoErro?: string;
}

const formatarInput = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ','));

function aplicarPreco(l: LinhaEditavel, texto: string, itens: ItemPromocao[]): LinhaEditavel {
  const preco = parsePreco(texto);
  const original = itens.find((i) => i.ml_item_id === l.ml_item_id);
  const semaforo = original ? semaforoNoPreco(original.projecao, preco) : l.semaforo;
  return { ...l, preco, precoTexto: texto, semaforo, motivoErro: undefined };
}

function construirLinhas(acao: AcaoOperacao, tipo: 'DEAL' | 'SMART', itens: ItemPromocao[], naoRevertiveis?: Map<string, string>): LinhaEditavel[] {
  return montarPreview(acao, tipo, itens).map((l) => {
    const motivoBloqueio = naoRevertiveis?.get(l.ml_item_id);
    return { ...l, marcado: motivoBloqueio ? false : l.marcado, motivoBloqueio, precoTexto: formatarInput(l.preco) };
  });
}

function textoRisco(vermelho: number, indisponivel: number): string {
  const partes: string[] = [];
  if (vermelho > 0) partes.push(`${vermelho} abaixo do custo`);
  if (indisponivel > 0) partes.push(`${indisponivel} sem líquido`);
  return partes.join(' e ');
}

export function PreviewOperacao({ acao, tipo, promocaoId, promocaoNome, itens, origemId, aberto, onClose, naoRevertiveis }: {
  acao: AcaoOperacao; tipo: 'DEAL' | 'SMART'; promocaoId: string; promocaoNome: string; itens: ItemPromocao[];
  origemId?: string | null; aberto: boolean; onClose: () => void; naoRevertiveis?: Map<string, string>;
}) {
  const podeExecutar = usePodeExecutarOperacao();
  const criar = useCriarOperacao();
  const navigate = useNavigate();
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [confirmadoRisco, setConfirmadoRisco] = useState(false);

  // Reabrir com preview novo (item mudou, ou trocou o grupo aderir/sair): recomeça do zero.
  useEffect(() => {
    if (!aberto) return;
    setLinhas(construirLinhas(acao, tipo, itens, naoRevertiveis));
    setConfirmadoRisco(false);
  }, [aberto, acao, tipo, itens, naoRevertiveis]);

  const podeEditarPreco = acao === 'aderir' && tipo === 'DEAL';
  const marcadas = linhas.filter((l) => l.marcado);
  const risco = precisaConfirmarRisco(linhas);
  const temRisco = risco.vermelho + risco.indisponivel > 0;
  const precoInvalido = (l: LinhaEditavel) => podeEditarPreco && (l.preco == null || (l.min != null && l.max != null && (l.preco < l.min || l.preco > l.max)));
  const podeEnviar = marcadas.length > 0 && !marcadas.some(precoInvalido) && (!temRisco || confirmadoRisco);

  function alternarMarcado(id: string) {
    setLinhas((prev) => prev.map((l) => (l.ml_item_id === id ? { ...l, marcado: !l.marcado } : l)));
  }
  function editarPreco(id: string, texto: string) {
    setLinhas((prev) => prev.map((l) => (l.ml_item_id === id ? aplicarPreco(l, texto, itens) : l)));
  }
  function usarAteQuanto(id: string) {
    setLinhas((prev) => prev.map((l) => (l.ml_item_id === id && l.ateQuanto != null ? aplicarPreco(l, formatarInput(l.ateQuanto), itens) : l)));
  }
  function usarAteQuantoTodos() {
    setLinhas((prev) => prev.map((l) => (l.ateQuanto != null ? aplicarPreco(l, formatarInput(l.ateQuanto), itens) : l)));
  }

  async function executar() {
    const pedido = marcadas.map((l) => ({
      ml_item_id: l.ml_item_id,
      preco: podeEditarPreco ? l.preco : null,
      confirmado_risco: confirmadoRisco && (l.semaforo === 'vermelho' || l.semaforo === 'indisponivel'),
    }));
    try {
      await criar.mutateAsync({ acao, promocao_id: promocaoId, origem_id: origemId ?? null, itens: pedido });
      toast.success(`Operação iniciada: ${pedido.length} anúncios`);
      onClose();
      navigate('/promocoes?aba=operacoes');
    } catch (e) {
      const erro = e as ErroOperacao;
      if (erro.itens?.length) {
        const porItem = new Map(erro.itens.map((it) => [it.ml_item_id, it]));
        setLinhas((prev) => prev.map((l) => {
          const r = porItem.get(l.ml_item_id);
          if (!r) return l;
          const semaforo = r.semaforo === 'verde' || r.semaforo === 'amarelo' || r.semaforo === 'vermelho' || r.semaforo === 'indisponivel' ? r.semaforo : l.semaforo;
          return { ...l, motivoErro: r.motivo, semaforo };
        }));
      } else {
        toast.error(erro.message ?? 'Não foi possível criar a operação.');
      }
    }
  }

  const titulo = acao === 'aderir' ? `Aderir à ${promocaoNome}` : `Sair de ${promocaoNome}`;

  return (
    <Sheet open={aberto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{marcadas.length} de {linhas.length} selecionados para enviar.</SheetDescription>
        </SheetHeader>
        {podeEditarPreco && linhas.some((l) => l.ateQuanto != null) && (
          <div className="px-4">
            <Button type="button" variant="outline" size="sm" onClick={usarAteQuantoTodos}>
              Usar &quot;Até quanto descer&quot; em todos
            </Button>
          </div>
        )}
        <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto px-4">
          {linhas.map((l) => {
            const ui = SEMAFORO_UI[l.semaforo];
            return (
              <li key={l.ml_item_id} className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-label={`Selecionar ${l.ml_item_id}`}
                    checked={l.marcado}
                    disabled={!!l.motivoBloqueio}
                    onCheckedChange={() => alternarMarcado(l.ml_item_id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{formatarNomeProduto(l.titulo) || l.ml_item_id}</p>
                    <p className="text-xs text-muted-foreground">{l.ml_item_id}</p>
                    {l.motivoBloqueio && <p className="text-xs text-muted-foreground">{l.motivoBloqueio}</p>}
                    {l.motivoErro && <p className="text-xs text-danger">{l.motivoErro}</p>}
                  </div>
                  <StatusPill tone={ui.tone} title={ui.label} className="shrink-0">
                    <ui.Icon className="size-3.5" aria-hidden />{ui.label}
                  </StatusPill>
                </div>
                {podeEditarPreco ? (
                  <div className="ml-7 flex flex-wrap items-center gap-2">
                    <Input
                      value={l.precoTexto}
                      onChange={(e) => editarPreco(l.ml_item_id, e.target.value)}
                      inputMode="decimal"
                      aria-label={`Preço de ${l.ml_item_id}`}
                      className={cn('w-24', precoInvalido(l) && 'border-danger')}
                    />
                    {l.min != null && l.max != null && (
                      <span className="text-xs text-muted-foreground">{fmtBRLSemSimbolo(l.min)} a {fmtBRLSemSimbolo(l.max)}</span>
                    )}
                    {l.ateQuanto != null && (
                      <Button type="button" variant="outline" size="xs" onClick={() => usarAteQuanto(l.ml_item_id)}>
                        Usar Até quanto descer
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="ml-7 text-sm tabular-nums">{l.preco != null ? fmtBRL(l.preco) : '—'}</p>
                )}
              </li>
            );
          })}
        </ul>
        <SheetFooter>
          {temRisco && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
              <p className="font-medium text-danger">{textoRisco(risco.vermelho, risco.indisponivel)}</p>
              <label htmlFor="risco-confirmado" className="mt-2 flex items-center gap-2">
                <Checkbox id="risco-confirmado" checked={confirmadoRisco} onCheckedChange={(v) => setConfirmadoRisco(!!v)} />
                Aderir mesmo assim
              </label>
            </div>
          )}
          {podeExecutar ? (
            <Button onClick={executar} disabled={!podeEnviar || criar.isPending}>Executar</Button>
          ) : (
            <p className="text-sm text-muted-foreground">Só administradores executam operações em massa.</p>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
