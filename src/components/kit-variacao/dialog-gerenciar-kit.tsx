// ADR-0200 (Task 13): Gerenciar kit, na linha do kit em Publicados. Saldo por combinação × tamanho; Montar mais
// (combinação × tamanho publicado só aumenta; nunca publicado vira SKU novo no mesmo kit, com foto), Desmontar (com reposição ligada, a desliga até o operador religar), "Vender só em kit",
// reposição automática, meta e Encerrar kit (emenda de 08/11: fecha os anúncios do kit no ML; encerrado fica só leitura).
// Tudo pela edge `gerenciar-kit-variacao`, que só aceita admin.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
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
import { QK_KITS_VARIACAO, useDetalheKitVariacao, useGaleriaPecasKit, usePrecoAvulsoKit } from '@/hooks/useKitsVariacao';
import { GaleriaPecas } from '@/components/kit-variacao/galeria-pecas';
import { idsDaGaleria, type EscolhaGaleria } from '@/lib/kit-galeria';
import { useFamilia } from '@/hooks/useFamilia';
import { QK } from '@/lib/queries';
import { AVISO_SELETOR_ML, gerarCombinacoes, maximoPorCelula, rotuloCombinacao } from '@/lib/kit-variacao';
import {
  adicionarAoKitEdge, enviarFotoKit, gerenciarKitEdge, type AcaoKit, type KitVariacaoResumo,
} from '@/lib/kit-variacao-edge';
import { cn } from '@/lib/utils';
import { ExplicacaoReposicao } from '@/components/kit-variacao/explicacao-reposicao';
import { FotoCombinacao, type FotoKit } from '@/components/kit-variacao/foto-combinacao';
import { ComparacaoAvulso } from '@/components/kit-variacao/referencia-avulso';
import { compararKit, somaAvulsa } from '@/lib/kit-preco-avulso';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { AuraTransferencia, EtapaTransferencia } from '@/components/kit-variacao/transferencia-andamento';
import { useFocoKitStore } from '@/stores/foco-kit-store';

const inteiro = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);
/** Combinação = conjunto de cores: a ordem em que foram marcadas não cria outra. */
const conjunto = (cores: string[]) => [...cores].sort().join('|');
const STATUS: Record<string, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  publicado: { rotulo: 'Publicado', tom: 'success' },
  publicando: { rotulo: 'Montando', tom: 'warning' },
  erro: { rotulo: 'Com erro', tom: 'danger' },
  encerrando: { rotulo: 'Encerrando', tom: 'warning' },
  encerrado: { rotulo: 'Encerrado', tom: 'neutral' },
};

type Confirmacao = null | 'montar' | 'desmontar' | 'ligar_so_em_kit' | 'desligar_so_em_kit' | 'encerrar';

export function DialogGerenciarKit({ kit, open, onOpenChange, isAdmin: ehAdmin }: {
  kit: KitVariacaoResumo;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isAdmin: boolean;
}) {
  // Kit encerrando ou encerrado não muda mais: nenhuma ação, nem para admin.
  const fechado = kit.status === 'encerrando' || kit.status === 'encerrado';
  const isAdmin = ehAdmin && !fechado;
  const qc = useQueryClient();
  const detalhe = useDetalheKitVariacao(open ? kit.id : null, kit.codigoPaiBase);
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
  // Montar mais com combinação × tamanho nunca publicado (vira SKU novo no mesmo kit).
  const [novoAberto, setNovoAberto] = useState(false);
  // Galeria das peças da combinação nova (ADR-0200, adendo 12/11): o operador só remove ou liga "Só a foto do kit".
  // Tamanho novo de combinação publicada copia a galeria da irmã no servidor, sem prévia aqui.
  const [escolhaGaleria, setEscolhaGaleria] = useState<Record<string, EscolhaGaleria>>({});
  const [novaQtd, setNovaQtd] = useState<Record<string, string>>({});
  const [fotos, setFotos] = useState<Record<string, FotoKit>>({});
  const { data: modulos } = useModulosHabilitados();
  const temImagemIA = !!modulos?.includes('imagem_ia');
  // Chave estável por operação: o mesmo pedido repetido (resposta perdida, falha de rede) usa a mesma chave, e a RPC
  // devolve a transferência original. Pedido diferente = chave nova. Sai a cada sucesso e a cada abertura.
  const operacao = useRef<{ assinatura: string; chave: string } | null>(null);
  const chaveDe = (assinatura: string) => {
    if (operacao.current?.assinatura !== assinatura) operacao.current = { assinatura, chave: crypto.randomUUID() };
    return operacao.current.chave;
  };
  const enviadas = useRef(new Map<string, { file: File; path: string }>());

  // Preço avulso: leitura nova do ML a cada abertura.
  const [abertura, setAbertura] = useState<string | null>(null);
  // Chave nova já no render que abre (um effect deixaria a 1ª leitura sair com a chave da abertura anterior).
  const [abertoVisto, setAbertoVisto] = useState(false);
  if (open !== abertoVisto) { setAbertoVisto(open); setAbertura(open ? crypto.randomUUID() : null); }
  useEffect(() => {
    if (!open) return;
    setQtd({}); setConfirmar(null); setDesligarJunto(false); setNovaQtd({}); setFotos({}); setEscolhaGaleria({}); setNovoAberto(false);
    operacao.current = null;
    enviadas.current.clear();
  }, [open]);

  const itens = skus.map((s) => ({ codigo: s.codigo, quantidade: inteiro(qtd[s.codigo]) })).filter((i) => i.quantidade > 0);
  const alemDoSaldo = itens.some((i) => i.quantidade > (skus.find((s) => s.codigo === i.codigo)?.saldo ?? 0));
  // Desmontar só mexe nas combinações publicadas: a matriz nova participa apenas da montagem.
  const totalDesmontar = itens.reduce((s, i) => s + i.quantidade, 0);
  const ocupado = enviando || abertas.length > 0;
  // Encerrar exige saldo 0 em todas as combinações (a RPC confere de novo, travada).
  const comSaldo = skus.some((s) => s.saldo !== null && s.saldo !== 0);

  // Base canônica: cores, tamanhos e saldo das peças.
  const baseId = detalhe.data?.baseFamiliaId ?? '';
  const baseQ = useFamilia(baseId, open && !!baseId, false);
  const pecasBase = useMemo(() => (baseQ.data?.variacoes ?? []).filter((v) => !v.excluidaDaPublicacao), [baseQ.data]);
  const coresBase = useMemo(() => [...new Set(pecasBase.map((v) => v.cor))], [pecasBase]);
  const tamanhosBase = useMemo(() => [...new Set(pecasBase.map((v) => v.tamanho).filter((t): t is string => !!t))], [pecasBase]);
  const combinacoes = useMemo(() => gerarCombinacoes(coresBase, kit.pecasPorKit), [coresBase, kit.pecasPorKit]);
  const publicada = (cores: string[], tamanho?: string) =>
    skus.find((s) => conjunto(s.cores) === conjunto(cores) && (tamanho == null || s.tamanho === tamanho));
  // Tamanho novo de combinação publicada usa as cores e o rótulo gravados (mesmo COLOR) e a foto dela.
  const novos = combinacoes.flatMap((c) => tamanhosBase.map((t) => {
    const irma = publicada(c);
    return { cores: irma?.cores ?? c, rotulo: irma?.rotulo ?? rotuloCombinacao(c), tamanho: t, temFoto: !!irma,
      quantidade: publicada(c, t) ? 0 : inteiro(novaQtd[`${conjunto(c)}#${t}`]) };
  })).filter((n) => n.quantidade > 0);
  const semFoto = [...new Set(novos.filter((n) => !n.temFoto && !fotos[n.rotulo]).map((n) => n.rotulo))];
  const rotulosNovos = [...new Set(novos.filter((n) => !n.temFoto).map((n) => n.rotulo))];
  const totalKits = itens.reduce((s, i) => s + i.quantidade, 0) + novos.reduce((s, n) => s + n.quantidade, 0);
  // Tudo o que Montar mais pede, por cores × tamanho: base do máximo por célula e corpo de `adicionarAoKitEdge`.
  const pedidos = [
    ...itens.map((i) => {
      const s = skus.find((x) => x.codigo === i.codigo)!;
      return { cores: s.cores, tamanho: s.tamanho, quantidade: i.quantidade };
    }),
    ...novos.map((n) => ({ cores: n.cores, tamanho: n.tamanho, quantidade: n.quantidade })),
  ];
  const maximo = (cores: string[], tamanho: string) => maximoPorCelula(pecasBase, { cores, tamanho }, pedidos);
  const galeriaQ = useGaleriaPecasKit(
    open && novoAberto && baseId && rotulosNovos.length > 0 ? baseId : null, abertura,
    rotulosNovos.map((rotulo) => ({ rotulo, cores: novos.find((n) => n.rotulo === rotulo)!.cores })),
  );
  // Só o que o operador viu na prévia e manteve; o servidor recalcula a proposta e descarta o que não confere.
  const galeria: Record<string, string[]> = {};
  for (const rotulo of rotulosNovos) {
    const ids = idsDaGaleria(galeriaQ.data?.[rotulo], escolhaGaleria[rotulo]);
    if (ids.length > 0) galeria[rotulo] = ids;
  }
  // Combinação ou tamanho novo sai com o preço do kit: a mesma referência do avulso da criação (só informativa).
  const precosQ = usePrecoAvulsoKit(open && novoAberto && baseId ? baseId : null, abertura);
  const linhasAvulso = novos.map((n) => ({ rotulo: n.rotulo, tamanho: n.tamanho, soma: somaAvulsa(pecasBase, precosQ.isError ? undefined : precosQ.data, n.cores, n.tamanho) }));
  const comparacaoNovos = compararKit(kit.preco, linhasAvulso);

  // Conferência só de leitura das peças da base (a RPC continua validando): por código de peça, não por nome de cor.
  const precisa = new Map<string, number>();
  const somar = (codigo: string, n: number) => precisa.set(codigo, (precisa.get(codigo) ?? 0) + n);
  for (const i of itens) for (const c of skus.find((s) => s.codigo === i.codigo)?.componentes ?? []) somar(c.codigo, c.quantidade * i.quantidade);
  const semPeca: string[] = [];
  for (const n of novos) {
    for (const cor of n.cores) {
      const v = pecasBase.find((x) => x.cor === cor && x.tamanho === n.tamanho);
      if (v) somar(v.codigo, n.quantidade); else semPeca.push(`${cor} ${n.tamanho}`);
    }
  }
  const faltas = [
    ...semPeca.map((x) => `${x}: não existe na base`),
    ...[...precisa].flatMap(([codigo, n]) => {
      const v = pecasBase.find((x) => x.codigo === codigo);
      return v && n > v.estoque ? [`${v.cor} ${v.tamanho}: precisa ${n}, há ${v.estoque}`] : [];
    }),
  ];
  const conferiu = !!baseQ.data && !baseQ.isError;

  async function acao(
    a: AcaoKit, extra: { meta?: number; itens?: typeof itens; chave?: string; desligarSoEmKit?: boolean } = {},
  ): Promise<{ ok: boolean; reposicaoDesligada?: boolean; encerrado?: boolean }> {
    const r = await gerenciarKitEdge({ kitId: kit.id, acao: a, versao, ...extra });
    if (!r.ok) {
      toast.error('Não foi possível concluir', { description: r.mensagem });
      return { ok: false };
    }
    // A versão autoritativa vem da RPC (também na repetição idempotente); nunca é presumida aqui.
    if (typeof r.versao === 'number') setVersao(r.versao);
    operacao.current = null;
    return { ok: true, reposicaoDesligada: r.reposicaoDesligada, encerrado: r.encerrado };
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

  // Fecha e Publicados leva até a linha da base, onde o andamento aparece.
  const acompanharNaTabela = () => { onOpenChange(false); useFocoKitStore.getState().focar(kit.codigoPaiBase, kit.id); };

  const montar = () => executar(async () => {
    let ok: boolean;
    if (novos.length === 0) {
      ok = (await acao('montar', { itens, chave: chaveDe(JSON.stringify(['montar', itens])) })).ok;
    } else {
      const chave = chaveDe(JSON.stringify(['adicionar', itens, novos, rotulosNovos.map((r) => { const f = fotos[r]; return [r, f instanceof File ? [f.name, f.size] : f?.path]; }), galeria]));
      // Foto já enviada nesta abertura reaproveita o caminho: a repetição mantém o pedido (hash) da chave.
      const caminhos: Record<string, string> = {};
      for (const rotulo of rotulosNovos) {
        const file = fotos[rotulo];
        // Foto gerada por IA e aprovada já está no storage da org.
        if (!(file instanceof File)) { caminhos[rotulo] = file.path; continue; }
        const ja = enviadas.current.get(rotulo);
        if (ja?.file === file) { caminhos[rotulo] = ja.path; continue; }
        const path = await enviarFotoKit(`kit-variacao-${chave}`, rotulo, file);
        enviadas.current.set(rotulo, { file, path });
        caminhos[rotulo] = path;
      }
      const r = await adicionarAoKitEdge({
        kitId: kit.id, versao, chaveCadastro: chave, fotos: caminhos,
        quantidades: pedidos, ...(Object.keys(galeria).length > 0 ? { galeria } : {}),
      });
      ok = r.ok;
      if (!r.ok) toast.error('Não foi possível concluir', { description: r.mensagem });
      else {
        if (typeof r.versao === 'number') setVersao(r.versao);
        operacao.current = null; enviadas.current.clear();
      }
    }
    if (ok) {
      setQtd({}); setNovaQtd({}); setFotos({});
      toast.success(`Montagem de ${totalKits} ${totalKits === 1 ? 'kit' : 'kits'} começou`, {
        description: 'Os anúncios das peças ficam pausados alguns minutos enquanto elas vão para o kit.',
      });
      acompanharNaTabela();
    }
  });

  // Uma chamada: a RPC desliga a reposição (e, se pedido, "Vender só em kit") antes de criar a transferência.
  const desmontar = () => executar(async () => {
    const desligar = desligarJunto && kit.soEmKit;
    const r = await acao('desmontar', {
      itens, desligarSoEmKit: desligar, chave: chaveDe(JSON.stringify(['desmontar', itens, desligar])),
    });
    if (!r.ok) return;
    setQtd({});
    toast.success(`Desmontagem de ${totalDesmontar} ${totalDesmontar === 1 ? 'kit' : 'kits'} começou`, {
      description: [
        r.reposicaoDesligada ? 'A reposição automática foi desligada.' : '',
        desligar ? '"Vender só em kit" desligado: os anúncios individuais voltam a vender.' : '',
      ].filter(Boolean).join(' ') || undefined,
    });
    acompanharNaTabela();
  });

  // Desmontar tudo (caminho do "Desmonte antes"): todo o saldo de cada combinação, pela confirmação de sempre.
  const desmontarTudo = () => {
    setQtd(Object.fromEntries(skus.filter((s) => (s.saldo ?? 0) > 0).map((s) => [s.codigo, String(s.saldo)])));
    setConfirmar('desmontar');
  };

  const encerrar = () => executar(async () => {
    const r = await acao('encerrar');
    if (!r.ok) return;
    toast.success(r.encerrado ? 'Kit encerrado' : 'Encerramento do kit começou', {
      description: r.encerrado ? undefined
        : 'Os anúncios do kit são fechados no Mercado Livre em alguns minutos. Você recebe um aviso ao concluir.',
    });
  });

  const politica = (a: AcaoKit, sucesso: string, extra: { meta?: number } = {}) => executar(async () => {
    if ((await acao(a, extra)).ok) toast.success(sucesso);
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
                Kit de {kit.pecasPorKit} peças. Montar e desmontar movem peças entre o kit e os anúncios individuais. Combinação publicada só ganha saldo.
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
            {kit.status === 'encerrando' && (
              <p className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                Fechando os anúncios do kit no Mercado Livre. O andamento aparece abaixo.
              </p>
            )}
            {kit.status === 'encerrado' && (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Kit encerrado: os anúncios foram fechados no Mercado Livre e o kit saiu de Publicados. O histórico continua
                aqui; o kit não muda mais.
              </p>
            )}

            {abertas.length > 0 && (
              <section aria-label="Transferências em andamento" className="grid gap-1.5">
                {abertas.map((t) => (
                  <AuraTransferencia key={t.id} estado={t.estado} className={cn('px-3 py-2', t.estado === 'travada' && 'bg-danger/10')}>
                    <EtapaTransferencia t={t} />
                  </AuraTransferencia>
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
                            {/* ponytail: só dica. O campo serve também ao Desmontar (limite = saldo do kit): sem vermelho nem bloqueio aqui. */}
                            {conferiu && (
                              <span aria-label={`Máximo montar ${s.rotulo} ${s.tamanho}`} className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                                monta até {maximo(s.cores, s.tamanho).maximo}
                              </span>
                            )}
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
                <Button variant="outline" disabled={ocupado || totalDesmontar === 0 || alemDoSaldo} onClick={() => setConfirmar('desmontar')}>
                  Desmontar
                </Button>
                <Button
                  disabled={ocupado || totalKits === 0 || faltas.length > 0 || semFoto.length > 0 || galeriaQ.isFetching}
                  onClick={() => setConfirmar('montar')}
                >
                  Montar mais
                </Button>
              </div>
            )}

            {isAdmin && faltas.length > 0 && (
              <p className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
                Faltam peças na base para montar: {faltas.join('; ')}.
              </p>
            )}
            {isAdmin && !conferiu && totalKits > 0 && !baseQ.isLoading && (
              <p className="text-xs text-warning">Não foi possível conferir as peças da base agora. A montagem confere de novo antes de mover.</p>
            )}

            {isAdmin && (
              <section aria-label="Combinação ou tamanho novo" className="rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
                  aria-expanded={novoAberto}
                  onClick={() => setNovoAberto((v) => !v)}
                >
                  <span>
                    Combinação ou tamanho novo
                    <span className="block text-xs font-normal text-muted-foreground">
                      Vira anúncio novo dentro deste mesmo kit, com a foto da combinação.
                    </span>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 motion-safe:transition-transform', novoAberto && 'rotate-180')} />
                </button>
                {novoAberto && (
                  baseQ.isLoading ? (
                    <p className="flex items-center gap-2 border-t p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando a base…</p>
                  ) : !conferiu ? (
                    <p className="border-t p-3 text-sm text-danger">Não foi possível ler o produto-base. Feche e abra de novo.</p>
                  ) : (
                    <div className="grid gap-3 border-t p-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="py-2 pr-3 font-medium">Combinação</th>
                              {tamanhosBase.map((t) => <th key={t} className="px-2 py-2 text-right font-medium">{t}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {combinacoes.map((c) => {
                              const rotulo = publicada(c)?.rotulo ?? rotuloCombinacao(c);
                              return (
                                <tr key={conjunto(c)} className="border-b last:border-0">
                                  <td className="py-1.5 pr-3">{rotulo}</td>
                                  {tamanhosBase.map((t) => {
                                    if (publicada(c, t)) {
                                      return (
                                        <td key={t} className="px-2 py-1.5 text-right">
                                          <span className="text-xs text-muted-foreground" title="Já publicado: use a tabela acima">publicado</span>
                                        </td>
                                      );
                                    }
                                    const k = `${conjunto(c)}#${t}`;
                                    const m = maximo(c, t);
                                    const valor = inteiro(novaQtd[k]);
                                    // Com valor digitado a célula fica aberta, para o operador poder zerar.
                                    const bloqueada = m.maximo === 0 && valor === 0;
                                    const acima = valor > m.maximo;
                                    return (
                                      <td key={t} className="px-2 py-1.5 text-right" title={bloqueada ? `Sem peça livre de ${m.faltam.join(', ')} em ${t}` : undefined}>
                                        <Input
                                          type="number" min={0} step={1} inputMode="numeric" placeholder="0"
                                          aria-label={`Nova ${rotulo} ${t}`}
                                          aria-invalid={acima}
                                          disabled={bloqueada}
                                          className={cn('ml-auto h-8 w-16 text-right tabular-nums', acima && 'font-semibold text-danger')}
                                          value={novaQtd[k] ?? ''}
                                          onChange={(e) => setNovaQtd((p) => ({ ...p, [k]: e.target.value }))}
                                        />
                                        <span
                                          aria-label={`Máximo nova ${rotulo} ${t}`}
                                          className={cn('mt-0.5 block text-xs tabular-nums', acima ? 'text-danger' : 'text-muted-foreground')}
                                        >
                                          máx {m.maximo}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {rotulosNovos.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {rotulosNovos.map((rotulo) => (
                            <div key={rotulo} className="grid content-start gap-1.5">
                              <FotoCombinacao
                                rotulo={rotulo} titulo={`Foto de ${rotulo}`}
                                cores={novos.find((n) => n.rotulo === rotulo)!.cores} familiaBaseId={baseId}
                                temImagemIA={temImagemIA} valor={fotos[rotulo]}
                                onChange={(f) => setFotos((p) => ({ ...p, [rotulo]: f }))}
                              />
                              <GaleriaPecas
                                proposta={galeriaQ.data?.[rotulo]} carregando={galeriaQ.isPending && galeriaQ.fetchStatus !== 'idle'}
                                erro={galeriaQ.isError} escolha={escolhaGaleria[rotulo]} desabilitado={enviando}
                                onChange={(e) => setEscolhaGaleria((p) => ({ ...p, [rotulo]: e }))}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {semFoto.length > 0 && (
                        <p className="text-xs text-danger">Envie a foto de cada combinação nova ({semFoto.join(', ')}).</p>
                      )}
                      {novos.length > 0 && (
                        <ComparacaoAvulso
                          c={comparacaoNovos} preco={kit.preco} lendo={precosQ.isPending || precosQ.isFetching} erro={precosQ.isError}
                          pecas={kit.pecasPorKit} linhas={linhasAvulso}
                        />
                      )}
                    </div>
                  )
                )}
              </section>
            )}

            {isAdmin && (
              <section aria-label="Encerrar kit" className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                <div className="mr-auto">
                  <span className="font-medium">Encerrar kit</span>
                  <span className="block text-xs text-muted-foreground">
                    {comSaldo ? 'Desmonte antes: o kit ainda tem saldo.'
                      : abertas.length > 0 ? 'Espere a transferência em andamento terminar.'
                        : 'Fecha os anúncios do kit no Mercado Livre e tira o kit de Publicados.'}
                  </span>
                </div>
                {comSaldo && (
                  <Button variant="outline" size="sm" disabled={ocupado || detalhe.isLoading} onClick={desmontarTudo}>
                    Desmontar tudo
                  </Button>
                )}
                <Button
                  variant="outline" size="sm" className="text-danger"
                  disabled={ocupado || comSaldo || detalhe.isLoading || detalhe.isError}
                  onClick={() => setConfirmar('encerrar')}
                >
                  Encerrar kit
                </Button>
              </section>
            )}

            {!fechado && (
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
            )}

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
                  {(() => {
                    const n = new Set(novos.map((x) => `${x.rotulo}#${x.tamanho}`)).size;
                    return n === 0
                      ? ' Nenhum anúncio novo é criado: só aumenta o saldo das combinações já publicadas.'
                      : ` ${n} ${n === 1 ? 'anúncio novo (combinação ou tamanho) entra' : 'anúncios novos (combinação ou tamanho) entram'} neste mesmo kit. ${AVISO_SELETOR_ML}`;
                  })()}
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
                <AlertDialogTitle>Desmontar {totalDesmontar} {totalDesmontar === 1 ? 'kit' : 'kits'}?</AlertDialogTitle>
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
          {confirmar === 'encerrar' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Encerrar o kit {kit.codigoPaiKit}?</AlertDialogTitle>
                <AlertDialogDescription>Encerra os anúncios do kit no Mercado Livre. Não dá para desfazer.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={enviando} onClick={(e) => { e.preventDefault(); void encerrar(); }}>
                  Encerrar anúncios
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
