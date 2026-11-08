// ADR-0197 (Task 13): Gerenciar kit, na linha do kit em Publicados. Saldo por combinação × tamanho; Montar mais (só
// aumenta anúncio existente), Desmontar (com reposição ligada, a desliga até o operador religar), "Vender só em kit",
// reposição automática e meta. Tudo pela edge `gerenciar-kit-variacao`, que só aceita admin.
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { QK_KITS_VARIACAO, useDetalheKitVariacao } from '@/hooks/useKitsVariacao';
import { QK } from '@/lib/queries';
import { AVISO_SELETOR_ML } from '@/lib/kit-variacao';
import { gerenciarKitEdge, type AcaoKit, type KitVariacaoResumo } from '@/lib/kit-variacao-edge';
import { cn } from '@/lib/utils';
import { ExplicacaoReposicao } from '@/components/kit-variacao/explicacao-reposicao';

const inteiro = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);
const TIPO: Record<string, string> = {
  montar: 'Montagem', desmontar: 'Desmontagem', repor: 'Reposição', cancelamento: 'Cancelamento', sair_sobra: 'Guardar peças', entrada: 'Entrada',
};
const STATUS: Record<string, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  publicado: { rotulo: 'Publicado', tom: 'success' },
  publicando: { rotulo: 'Montando', tom: 'warning' },
  erro: { rotulo: 'Com erro', tom: 'danger' },
};

type Confirmacao = null | 'montar' | 'desmontar' | 'ligar_so_em_kit' | 'desligar_so_em_kit';

export function DialogGerenciarKit({ kit, open, onOpenChange, isAdmin }: {
  kit: KitVariacaoResumo;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const detalhe = useDetalheKitVariacao(open ? kit.id : null);
  const skus = useMemo(() => detalhe.data?.skus ?? [], [detalhe.data]);
  const abertas = detalhe.data?.abertas ?? [];
  // Versão lida + as mudanças feitas aqui (a releitura chega depois). Versão velha a edge recusa.
  const [versao, setVersao] = useState(kit.versao);
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState(String(kit.meta));
  const [confirmar, setConfirmar] = useState<Confirmacao>(null);
  const [desligarJunto, setDesligarJunto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { setVersao(kit.versao); }, [kit.versao]);
  useEffect(() => { setMeta(String(kit.meta)); }, [kit.meta]);
  useEffect(() => { if (open) { setQtd({}); setConfirmar(null); setDesligarJunto(false); } }, [open]);

  const itens = skus.map((s) => ({ codigo: s.codigo, quantidade: inteiro(qtd[s.codigo]) })).filter((i) => i.quantidade > 0);
  const totalKits = itens.reduce((s, i) => s + i.quantidade, 0);
  const alemDoSaldo = itens.some((i) => i.quantidade > (skus.find((s) => s.codigo === i.codigo)?.saldo ?? 0));
  const ocupado = enviando || abertas.length > 0;

  async function acao(a: AcaoKit, extra: { meta?: number; itens?: typeof itens } = {}, v = versao): Promise<boolean> {
    const r = await gerenciarKitEdge({ kitId: kit.id, acao: a, versao: v, ...extra });
    if (!r.ok) {
      toast.error('Não foi possível concluir', { description: r.mensagem });
      return false;
    }
    return true;
  }

  async function executar(f: () => Promise<void>) {
    setEnviando(true);
    try { await f(); } finally {
      setEnviando(false);
      setConfirmar(null);
      qc.invalidateQueries({ queryKey: QK_KITS_VARIACAO });
      qc.invalidateQueries({ queryKey: QK.publicados });
    }
  }

  const montar = () => executar(async () => {
    if (await acao('montar', { itens })) {
      setQtd({});
      toast.success(`Montagem de ${totalKits} ${totalKits === 1 ? 'kit' : 'kits'} começou`, {
        description: 'Os anúncios das peças ficam pausados alguns minutos enquanto elas vão para o kit.',
      });
    }
  });

  const desmontar = () => executar(async () => {
    if (!(await acao('desmontar', { itens }))) return;
    let v = versao;
    if (kit.reposicaoAuto) { v += 1; setVersao(v); }
    setQtd({});
    toast.success(`Desmontagem de ${totalKits} ${totalKits === 1 ? 'kit' : 'kits'} começou`, {
      description: kit.reposicaoAuto ? 'A reposição automática foi desligada.' : undefined,
    });
    if (desligarJunto && kit.soEmKit && await acao('desligar_so_em_kit', {}, v)) {
      setVersao(v + 1);
      toast.success('"Vender só em kit" desligado. Os anúncios individuais voltam a vender.');
    }
  });

  const politica = (a: AcaoKit, sucesso: string, extra: { meta?: number } = {}) => executar(async () => {
    if (await acao(a, extra)) { setVersao((x) => x + 1); toast.success(sucesso); }
  });

  const status = STATUS[kit.status] ?? { rotulo: kit.status, tom: 'neutral' as const };
  const exemplo = skus[0];

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !enviando && onOpenChange(v)}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-[calc(100vw-2rem)] flex-col p-0 sm:max-w-3xl">
          <div className="min-h-0 space-y-4 overflow-y-auto p-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Gerenciar kit <span className="font-normal text-muted-foreground">{kit.codigoPaiKit}</span>
                <StatusPill tone={status.tom}>{status.rotulo}</StatusPill>
              </DialogTitle>
              <DialogDescription>
                Kit de {kit.pecasPorKit} peças. Montar e desmontar movem peças entre o kit e os anúncios individuais, sem criar anúncio novo.
              </DialogDescription>
            </DialogHeader>

            {kit.status === 'erro' && (
              <p className="flex gap-2 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A montagem deste kit travou. Algumas combinações podem não estar no Mercado Livre. O alerta da
                transferência abaixo diz o que conferir.
              </p>
            )}
            {kit.status === 'publicando' && (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{AVISO_SELETOR_ML}</p>
            )}

            {abertas.length > 0 && (
              <section aria-label="Transferências em andamento" className="grid gap-1.5">
                {abertas.map((t) => (
                  <div key={t.id} className={cn('rounded-md border px-3 py-2 text-xs', t.estado === 'travada' && 'border-danger/20 bg-danger/10')}>
                    <span className="font-medium">{TIPO[t.tipo] ?? t.tipo}</span>{' '}
                    <span className="text-muted-foreground">
                      {t.estado === 'travada' ? 'travada' : 'em andamento'} · etapa {t.passo}
                    </span>
                    {t.alerta && <p className={cn('mt-1', t.estado === 'travada' ? 'text-danger' : 'text-muted-foreground')}>{t.alerta}</p>}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Montar e desmontar ficam bloqueados até a transferência terminar (leva alguns minutos de quarentena).
                </p>
              </section>
            )}

            <section aria-label="Saldo do kit" className="overflow-x-auto rounded-md border">
              {detalhe.isLoading ? (
                <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando o saldo…</p>
              ) : detalhe.isError ? (
                <p className="p-3 text-sm text-danger">Não foi possível ler o saldo do kit. Feche e abra de novo.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Combinação</th>
                      <th className="px-3 py-2 font-medium">Tamanho</th>
                      <th className="px-3 py-2 text-right font-medium">Saldo</th>
                      {isAdmin && <th className="px-3 py-2 text-right font-medium">Kits a mover</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {skus.map((s) => (
                      <tr key={s.codigo} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{s.rotulo}</td>
                        <td className="px-3 py-1.5">{s.tamanho}</td>
                        <td aria-label={`Saldo do kit ${s.rotulo} ${s.tamanho}`} className="px-3 py-1.5 text-right tabular-nums">
                          {s.saldo ?? '—'}
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-1.5 text-right">
                            <Input
                              type="number" min={0} step={1} inputMode="numeric" placeholder="0"
                              aria-label={`Quantidade ${s.rotulo} ${s.tamanho}`}
                              className="ml-auto h-8 w-16 text-right tabular-nums"
                              value={qtd[s.codigo] ?? ''}
                              onChange={(e) => setQtd((p) => ({ ...p, [s.codigo]: e.target.value }))}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {isAdmin && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {alemDoSaldo && <span className="mr-auto text-xs text-danger">Desmontar além do saldo do kit não é possível.</span>}
                <Button variant="outline" disabled={ocupado || totalKits === 0 || alemDoSaldo} onClick={() => setConfirmar('desmontar')}>
                  Desmontar
                </Button>
                <Button disabled={ocupado || totalKits === 0} onClick={() => setConfirmar('montar')}>Montar mais</Button>
              </div>
            )}

            <section aria-label="Política do kit" className="grid gap-3 rounded-md border p-3">
              {isAdmin ? (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <label htmlFor="kv-so-em-kit">
                      <span className="font-medium">Vender só em kit</span>
                      <span className="block text-xs text-muted-foreground">As peças ficam guardadas, com o anúncio individual pausado.</span>
                    </label>
                    <Switch
                      id="kv-so-em-kit" aria-label="Vender só em kit" checked={kit.soEmKit} disabled={enviando}
                      onCheckedChange={(v) => setConfirmar(v ? 'ligar_so_em_kit' : 'desligar_so_em_kit')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <label htmlFor="kv-reposicao">
                      <span className="font-medium">Reposição automática</span>
                      <span className="block text-xs text-muted-foreground">
                        {kit.soEmKit ? 'Monta kits até a meta conforme vendem.' : 'Só existe com "Vender só em kit" ligado.'}
                      </span>
                    </label>
                    <Switch
                      id="kv-reposicao" aria-label="Reposição automática" checked={kit.reposicaoAuto} disabled={enviando || !kit.soEmKit}
                      onCheckedChange={(v) => politica(v ? 'ligar_reposicao' : 'desligar_reposicao',
                        v ? 'Reposição automática ligada' : 'Reposição automática desligada. O Telegram avisa quando uma combinação acabar.')}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="meta-kit" className="font-medium">Meta</label>
                    <Input
                      id="meta-kit" aria-label="Meta" type="number" min={0} step={1} inputMode="numeric"
                      className="h-8 w-20 text-right tabular-nums" value={meta} onChange={(e) => setMeta(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">kits por combinação e tamanho</span>
                    <Button
                      variant="outline" size="sm" className="ml-auto"
                      disabled={enviando || !/^\d+$/.test(meta) || Number(meta) === kit.meta}
                      onClick={() => politica('alterar_meta', `Meta alterada para ${meta}`, { meta: Number(meta) })}
                    >
                      Salvar meta
                    </Button>
                  </div>
                  {kit.soEmKit && exemplo && (
                    <ExplicacaoReposicao meta={inteiro(meta)} cores={exemplo.cores} tamanho={exemplo.tamanho} />
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Vender só em kit: {kit.soEmKit ? 'ligado' : 'desligado'} · Reposição automática: {kit.reposicaoAuto ? 'ligada' : 'desligada'} · Meta {kit.meta}.
                  Só administradores mudam o kit.
                </p>
              )}
            </section>

            <DialogFooter>
              <Button variant="outline" disabled={enviando} onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmar !== null} onOpenChange={(v) => !v && !enviando && setConfirmar(null)}>
        <AlertDialogContent processando={enviando} rotuloProcessando="Enviando">
          {confirmar === 'montar' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Montar {totalKits} {totalKits === 1 ? 'kit' : 'kits'}?</AlertDialogTitle>
                <AlertDialogDescription>
                  As peças saem dos anúncios individuais, que ficam pausados alguns minutos enquanto vão para o kit.
                  Nenhum anúncio novo é criado: só aumenta o saldo das combinações já publicadas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={enviando} onClick={(e) => { e.preventDefault(); void montar(); }}>Montar</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirmar === 'desmontar' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Desmontar {totalKits} {totalKits === 1 ? 'kit' : 'kits'}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="grid gap-2">
                    <p>As peças voltam aos anúncios individuais. O kit fica pausado alguns minutos durante a transferência.</p>
                    {kit.reposicaoAuto && (
                      <p className="text-warning">
                        A reposição automática fica desligada até você religar, para o sistema não montar os kits de novo.
                      </p>
                    )}
                    {kit.soEmKit && (
                      <>
                        <p>Com &quot;Vender só em kit&quot; ligado, as peças voltam como guardadas, sem oferta.</p>
                        <div className="flex items-center gap-2 text-foreground">
                          <Checkbox id="kv-desligar-junto" checked={desligarJunto} onCheckedChange={(v) => setDesligarJunto(v === true)} aria-label='Desligar também "Vender só em kit"' />
                          <label htmlFor="kv-desligar-junto" className="cursor-pointer">
                            Desligar também &quot;Vender só em kit&quot; (reativa os anúncios individuais)
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={enviando} onClick={(e) => { e.preventDefault(); void desmontar(); }}>Desmontar kits</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirmar === 'ligar_so_em_kit' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Ligar &quot;Vender só em kit&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  Os anúncios individuais das cores deste kit são pausados, e as peças ficam guardadas para a reposição
                  montar kits até a meta. A reposição automática liga junto.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={enviando} onClick={(e) => { e.preventDefault(); void politica('ligar_so_em_kit', '"Vender só em kit" ligado. Os anúncios individuais vão ser pausados.'); }}>
                  Ligar
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirmar === 'desligar_so_em_kit' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Desligar &quot;Vender só em kit&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso reativa os anúncios individuais que o kit pausou (os que nenhum outro kit ainda guarda). O kit
                  continua no ar com o saldo que tem, sem reposição automática.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={enviando} onClick={(e) => { e.preventDefault(); void politica('desligar_so_em_kit', '"Vender só em kit" desligado. Os anúncios individuais voltam a vender.'); }}>
                  Desligar
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
