// ADR-0207 (emenda 23–24): o Estoque marca produto ou cor "fora de linha"; a Reposição só obedece.
// Marcar tira dos rascunhos os itens afetados e voltar à linha não os devolve: os dois pedem confirmação.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { foraDeLinhaDoProduto, useReposicao } from '@/hooks/useReposicao';
import { cn } from '@/lib/utils';

type Info = NonNullable<ReturnType<typeof foraDeLinhaDoProduto>>;
interface Alvo { tipo: 'marcar' | 'voltar'; escopo: 'familia' | 'cor'; cor?: string; marcaId?: string }

const BTN = 'h-11 md:h-8';

export function DialogForaDeLinha({ open, onOpenChange, codigoPai, nome, info }: {
  open: boolean; onOpenChange: (o: boolean) => void; codigoPai: string; nome: string; info: Info;
}) {
  const r = useReposicao({ enabled: false });
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const confirmacao = useRef<HTMLDivElement>(null);
  const inteiro = !!info.familiaId;

  // O Estoque guarda a reposição por 5 min: a contagem de unidades do rascunho precisa estar fresca ao abrir.
  const { refetch } = r;
  useEffect(() => { if (open) void Promise.resolve(refetch()).catch(() => undefined); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Confirmação aberta: o foco vai para o botão Confirmar.
  useEffect(() => { if (alvo) confirmacao.current?.querySelector<HTMLElement>('[data-confirmar]')?.focus(); }, [alvo]);

  const fechar = (o: boolean) => { if (!o) { setAlvo(null); setErro(null); } onOpenChange(o); };
  const pedir = (a: Alvo) => { setErro(null); setAlvo(a); };

  async function confirmar() {
    if (!alvo) return;
    const quem = alvo.cor ?? 'Produto';
    setErro(null);
    try {
      if (alvo.tipo === 'marcar') {
        await r.foraDeLinha({ escopo: alvo.escopo, codigoPai, ...(alvo.cor ? { cor: alvo.cor } : {}) });
        toast.success(`${quem} marcado como fora de linha`);
      } else {
        await r.removerNaoRepor(alvo.marcaId!);
        toast.success(`${quem} voltou à linha`);
      }
      setAlvo(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar agora.');
    }
  }

  const linha = (chave: string, rotulo: React.ReactNode, aria: string, marcaId: string | null, a: Omit<Alvo, 'tipo' | 'marcaId'>, desabilitada?: string) => (
    <li key={chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className={cn('flex min-w-0 flex-1 items-center gap-2 font-medium', desabilitada && 'text-muted-foreground')}>{rotulo}</span>
      {desabilitada ? <span className="text-caption">{desabilitada}</span> : marcaId ? (
        <>
          <StatusPill tone="neutral">Fora de linha</StatusPill>
          <Button variant="outline" className={BTN} disabled={r.pendente || !!alvo} aria-label={`Voltar ${aria} à linha`} onClick={() => pedir({ ...a, tipo: 'voltar', marcaId })}>
            Voltar à linha
          </Button>
        </>
      ) : (
        <Button variant="outline" className={BTN} disabled={r.pendente || !!alvo} aria-label={`Marcar ${aria} fora de linha`} onClick={() => pedir({ ...a, tipo: 'marcar' })}>
          Marcar fora de linha
        </Button>
      )}
    </li>
  );

  const quemAlvo = alvo?.cor ?? 'O produto inteiro';
  const rasc = alvo?.tipo === 'marcar' ? info.rascunho(alvo.escopo, alvo.cor) : null;

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-md" processando={r.pendente} rotuloProcessando="Salvando"
        onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-slot=dialog-title]')?.focus(); }}>
        <DialogHeader>
          <DialogTitle tabIndex={-1} className="outline-none">Fora de linha · {nome}</DialogTitle>
          <DialogDescription>Sai das sugestões de compra. O estoque que sobra continua à venda.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border">
          {linha('__produto', 'Produto inteiro', 'o produto inteiro', info.familiaId, { escopo: 'familia' })}
          {info.cores.map((c) => linha(
            c.cor,
            <>
              {c.corHex && <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-foreground/20" style={{ backgroundColor: c.corHex }} />}
              <span className="truncate">{c.cor}</span>
            </>,
            `a cor ${c.cor}`, c.marcaId, { escopo: 'cor', cor: c.cor },
            inteiro ? 'O produto inteiro já está fora de linha' : undefined,
          ))}
        </ul>
        {alvo && (
          <div ref={confirmacao} role="status" aria-live="polite" aria-label="Confirmar fora de linha"
            className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
            {alvo.tipo === 'marcar' && rasc ? (
              <p>
                {quemAlvo} sai das sugestões de compra{rasc.unidades > 0 ? `, e ${rasc.unidades} un. saem do rascunho de pedido` : ''}.
                {' '}O estoque que sobra continua à venda; o anúncio no Mercado Livre não muda.
                {alvo.escopo === 'cor' ? ' As quantidades das outras cores serão recalculadas.' : ''}
              </p>
            ) : (
              <p>
                {quemAlvo} volta às sugestões de compra. Os itens que saíram do rascunho de pedido não voltam para ele.
              </p>
            )}
            {r.pendente && <p className="text-caption">Salvando…</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className={BTN} disabled={r.pendente} onClick={() => { setAlvo(null); setErro(null); }}>Cancelar</Button>
              <Button data-confirmar className={BTN} disabled={r.pendente} aria-busy={r.pendente} onClick={confirmar}>
                {erro ? 'Tentar de novo' : 'Confirmar'}
              </Button>
            </div>
          </div>
        )}
        {erro && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{erro}</p>}
      </DialogContent>
    </Dialog>
  );
}
