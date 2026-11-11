// ADR-0201 (Task 15) + Fase C2: passo "Aplicar no anúncio", fiel ao protótipo aprovado. Troca as fotos aprovadas de
// uma cor no Mercado Livre e desfaz. Só admin (ADR-0060). Fluxo: "Ver prévia" chama Preparar (nunca escreve no ML; a
// edge congela o manifesto e devolve, por MLB, as fotos da cor hoje × depois) → "Aplicar na cor X" no rodapé abre a
// confirmação → Confirmar (a saga roda no servidor). A tela só acompanha: lê o estado a cada 5 s enquanto houver
// aplicação andando e para ao sair do passo. Toda ação leva o `ml_item_id` da linha. Cor e modo ficam travados com
// Preparar em voo; trocar qualquer um descarta a prévia (ela vale só para o clique que a pediu).
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ImageOff, Images, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  APLICACAO_EM_ANDAMENTO, confirmarAplicacao, estadoAplicacoes, mensagemErro, prepararAplicacao,
  reverterAplicacao, type AplicacaoPreparada, type EstadoAplicacao, type Ficha, type ItemAplicacao, type ModoAplicar,
  type PreviaItem, type Res,
} from '@/lib/galeria/api';
import { nomeImagem } from '@/lib/galeria/rotulos';
import { cn } from '@/lib/utils';
import { MioloPasso, Rodape } from './rodape';

const POLLING_MS = 5000;
const SO_ADMIN = 'Somente administradores podem aplicar ou desfazer fotos';
const STATUS: Record<string, string> = {
  preparada: 'Preparada', em_andamento: 'Aplicando…', aplicada: 'Aplicada', abortando: 'Interrompendo…', falhou: 'Não aplicada',
  revertendo: 'Desfazendo…', revertida: 'Desfeita', reversao_incompleta: 'Desfazer incompleto',
};
/** Selo por MLB (o que o operador precisa saber: andando, feito, não feito). */
const SELO: Record<string, { rotulo: string; tom: StatusTone; gira?: boolean }> = {
  pendente: { rotulo: 'Aplicando', tom: 'info', gira: true }, subindo: { rotulo: 'Aplicando', tom: 'info', gira: true },
  aplicando: { rotulo: 'Aplicando', tom: 'info', gira: true }, aplicado: { rotulo: 'Aplicado', tom: 'success' },
  compensando: { rotulo: 'Desfazendo', tom: 'info', gira: true }, compensado: { rotulo: 'Desfeito', tom: 'neutral' },
  pulado: { rotulo: 'Não aplicado', tom: 'danger' }, falhou: { rotulo: 'Não aplicado', tom: 'danger' },
  reversao_incompleta: { rotulo: 'Desfazer incompleto', tom: 'danger' },
};
// Itens que pedem atenção do operador: vermelho, com o MLB.
const PROBLEMA = new Set(['reversao_incompleta', 'pulado', 'falhou']);
// Mensagens próprias deste passo (as de `api.ts` falam da aprovação de imagem).
const MENSAGENS: Record<string, string> = {
  desatualizada: 'O roteiro ou os fatos mudaram desde a prévia. Veja a prévia de novo.',
  mudou: 'As fotos do anúncio mudaram no Mercado Livre desde a prévia. Veja a prévia de novo.',
  nao_encontrada: 'Aplicação não encontrada neste anúncio.',
  sem_conexao_ml: 'Conecte a conta do Mercado Livre antes de aplicar as fotos.',
};
const FALHAS_PARA_AVISAR = 3;
const NOVA_PREPARACAO = new Set(['mudou', 'desatualizada']);

/** Motivo de um MLB que não foi aplicado (código da saga → frase). O código cru fica no `title`. */
function motivoItem(i: ItemAplicacao): string | null {
  const e = i.erro ?? '';
  if (i.status === 'reversao_incompleta') return 'Confira as fotos da cor no Mercado Livre.';
  if (!PROBLEMA.has(i.status)) return null;
  if (e === 'upload_incerto') return 'O envio da foto ficou sem resposta. As fotos da cor não mudaram.';
  if (e === 'put_incerto_sem_efeito') return 'O Mercado Livre não confirmou a troca. As fotos da cor não mudaram.';
  if (e === 'final_indisponivel' || e === 'sha_divergente') return 'O arquivo aprovado não confere. Aprove a imagem de novo.';
  if (e.startsWith('mudou')) return 'As fotos do anúncio mudaram no Mercado Livre. Veja a prévia de novo.';
  if (e.startsWith('limite')) return 'Passaria do limite de fotos da cor. Use Substituir.';
  if (/^(put|upload)_recusado/.test(e)) return 'O Mercado Livre recusou a troca. As fotos da cor não mudaram.';
  return i.status === 'pulado' ? 'A aplicação parou antes deste anúncio. As fotos da cor não mudaram.'
    : 'O Mercado Livre não aceitou a troca. As fotos da cor não mudaram.';
}

type Falha = Extract<Res<unknown>, { ok: false }>;
/** Pedido preparado com a cor e o modo do clique (a edge não os devolve). `confirmada` = a saga já foi disparada. */
type Preparada = AplicacaoPreparada & { cor: string; modo: ModoAplicar; confirmada: boolean };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const lista = (ids: string[]) => (ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} e ${ids.at(-1)}`);

function Mini({ url, rotulo, sai = false, nova = false }: { url: string | null; rotulo: string; sai?: boolean; nova?: boolean }) {
  return (
    <div role="img" aria-label={rotulo} title={rotulo} data-sai={sai || undefined} data-nova={nova || undefined}
      className={cn('relative size-18 shrink-0 overflow-hidden rounded-md border bg-muted',
        nova && 'outline-2 outline-offset-1 outline-primary',
        sai && 'opacity-40 after:absolute after:inset-0 after:bg-[linear-gradient(to_top_right,transparent_48%,var(--destructive)_49%,var(--destructive)_51%,transparent_52%)]')}>
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" />
        : <ImageOff aria-hidden className="m-auto mt-6 size-5 text-muted-foreground" />}
      {nova && <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">Nova</span>}
    </div>
  );
}

/** "Hoje no anúncio" × "Depois" de um MLB. */
function Comparacao({ p, moda }: { p: PreviaItem; moda: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground">Hoje no anúncio · <span className="tabular-nums">{plural(p.antes.length, 'foto', 'fotos')}</span></p>
        <div className="flex flex-wrap gap-2">
          {p.antes.length === 0 && <p className="text-xs text-muted-foreground">A cor ainda não tem fotos.</p>}
          {p.antes.map((f, i) => <Mini key={f.id} url={f.url} sai={f.sai} rotulo={`Foto atual ${i + 1}${f.sai ? ', será removida' : ''}`} />)}
        </div>
      </div>
      <ArrowRight aria-hidden className="size-4 text-muted-foreground max-sm:rotate-90 sm:mt-14" />
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground">Depois · <span className="tabular-nums">{plural(p.depois.length, 'foto', 'fotos')}</span></p>
        <div className="flex flex-wrap gap-2">
          {p.depois.map((f, i) => (
            <Mini key={f.id} url={f.url} nova={f.nova}
              rotulo={f.nova ? `Nova: ${nomeImagem(f.missao ?? 0, moda)}` : `Foto atual ${p.antes.findIndex((a) => a.id === f.id) + 1 || i + 1}, continua`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Linha de um MLB: id, formato e cor, selo e o motivo quando não foi aplicado. */
function LinhaMLB({ itemId, cor, formato, item }: { itemId: string; cor: string; formato: string; item?: ItemAplicacao }) {
  const selo = item ? SELO[item.status] ?? { rotulo: item.status, tom: 'neutral' as StatusTone } : { rotulo: 'Aguardando', tom: 'neutral' as StatusTone };
  const motivo = item ? motivoItem(item) : null;
  const ruim = !!item && PROBLEMA.has(item.status);
  return (
    <div className={cn('flex min-h-16 flex-wrap items-center gap-3', ruim && 'text-destructive')}>
      <div className="min-w-40 flex-1">
        <p className="font-semibold tabular-nums">{itemId}</p>
        <p className="text-xs text-muted-foreground">{formato} · cor {cor}</p>
        {motivo && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive" title={item?.erro ?? undefined}>
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />{motivo}
          </p>
        )}
      </div>
      <StatusPill tone={selo.tom}>
        {selo.gira ? <Loader2 aria-hidden className="size-3 animate-spin" /> : selo.tom === 'success' ? <Check aria-hidden className="size-3" /> : selo.tom === 'danger' ? <AlertTriangle aria-hidden className="size-3" /> : null}
        {selo.rotulo}
      </StatusPill>
    </div>
  );
}

export function PassoAplicar({ mlItemId, ficha, isAdmin, moda = false, formato = 'Anúncio', aprovadasPorCor, aoFamiliaMudou, aoIrParaGerar, aoVoltar }: {
  mlItemId: string; ficha: Ficha; isAdmin: boolean; moda?: boolean;
  /** "Legacy" ou "User Products" (linha de Publicados). */
  formato?: string;
  /** Aprovadas do roteiro aprovado, por cor; null = lista indisponível (a edge decide). */
  aprovadasPorCor: Record<string, number> | null;
  /** Família vigente mudou: a página mostra a mensagem, sobrevive à recarga e recarrega a ficha. */
  aoFamiliaMudou: (mensagem: string) => void;
  aoIrParaGerar: () => void;
  aoVoltar: () => void;
}) {
  const cores = aprovadasPorCor ? ficha.cores.filter((c) => (aprovadasPorCor[c] ?? 0) > 0) : ficha.cores;
  const [corEscolhida, setCor] = useState(cores[0] ?? '');
  // A lista de aprovadas pode chegar depois: a cor escolhida só vale se ainda tiver aprovada.
  const cor = cores.includes(corEscolhida) ? corEscolhida : cores[0] ?? '';
  const [modo, setModo] = useState<ModoAplicar>('substituir');
  const [atual, setAtual] = useState<Preparada | null>(null);
  const [aplicacoes, setAplicacoes] = useState<EstadoAplicacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [reverterEm, setReverterEm] = useState<EstadoAplicacao | null>(null);
  const [avisoLeitura, setAvisoLeitura] = useState(false);
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let falhas = 0;
    const rodar = async () => {
      const r = await estadoAplicacoes(mlItemId);
      if (!vivo) return;
      if (!r.ok) {
        // A saga segue sozinha no servidor: reagenda em qualquer falha (401, 409, 5xx, rede); só 403 (não admin) para.
        // Falhas seguidas avisam, sem apagar o último status.
        if (r.status === 403) return;
        falhas += 1;
        if (falhas >= FALHAS_PARA_AVISAR) setAvisoLeitura(true);
        timer = setTimeout(rodar, POLLING_MS);
        return;
      }
      falhas = 0; setAvisoLeitura(false);
      setAplicacoes(r.dados.aplicacoes);
      if (r.dados.aplicacoes.some((a) => APLICACAO_EM_ANDAMENTO.has(a.status))) timer = setTimeout(rodar, POLLING_MS);
    };
    void rodar();
    return () => { vivo = false; clearTimeout(timer); };
  }, [mlItemId, rodada]);

  const falhou = useCallback((f: Falha) => {
    const base = MENSAGENS[f.erro] ?? mensagemErro(f.erro);
    const onde = [f.corpo.item_id, f.corpo.detalhe].filter((x): x is string => typeof x === 'string').join(' · ');
    setErro(onde ? `${base} (${onde})` : base);
    if (NOVA_PREPARACAO.has(f.erro)) setAtual(null);
    if (f.erro === 'limite') setModo('substituir');
    if (f.erro === 'familia_nao_vigente') {
      setAtual(null);
      const vigente = typeof f.corpo.familia_id_vigente === 'string' ? ` (família vigente: ${f.corpo.familia_id_vigente})` : '';
      aoFamiliaMudou(`A família do anúncio mudou${vigente}. Recarregamos a ficha; confira e tente de novo.`);
    }
  }, [aoFamiliaMudou]);

  const rodarAcao = async <T,>(acao: () => Promise<Res<T>>, aoOk: (d: T) => void) => {
    setOcupado(true); setErro(null);
    const r = await acao();
    setOcupado(false);
    if (r.ok) aoOk(r.dados); else falhou(r);
  };

  const preparar = () => rodarAcao(() => prepararAplicacao(mlItemId, cor, modo), (d) => setAtual({ ...d, cor, modo, confirmada: false }));
  const confirmar = () => {
    setConfirmando(false);
    return rodarAcao(() => confirmarAplicacao(mlItemId, atual!.aplicacao_id), () => {
      toast.success('Aplicação iniciada'); setAtual((p) => (p ? { ...p, confirmada: true } : p)); setRodada((n) => n + 1);
    });
  };
  const reverter = (id: string) => rodarAcao(() => reverterAplicacao(mlItemId, id), () => {
    toast.success('Desfazer iniciado'); setReverterEm(null); setRodada((n) => n + 1);
  });
  const trocar = (f: () => void) => { f(); setAtual(null); setErro(null); };

  const bloqueio = isAdmin ? undefined : SO_ADMIN;
  const estadoAtual = atual?.confirmada ? aplicacoes.find((a) => a.id === atual.aplicacao_id) : undefined;
  const anteriores = aplicacoes.filter((a) => a.id !== estadoAtual?.id && a.status !== 'preparada');
  const nNovas = atual?.manifesto.length ?? 0;
  const nSaem = atual?.previa?.reduce((s, p) => s + p.antes.filter((f) => f.sai).length, 0);
  const anuncios = `${atual && atual.itens.length > 1 ? 'nos anúncios' : 'no anúncio'} ${lista(atual?.itens ?? [])}`;
  const andando = atual?.confirmada && (!estadoAtual || APLICACAO_EM_ANDAMENTO.has(estadoAtual.status));
  // Terminou sem ficar aplicada (falhou, desfeita, desfazer incompleto): pode ver a prévia de novo e tentar outra vez.
  const encerrada = !!estadoAtual && !andando && estadoAtual.status !== 'aplicada';
  const semAprovadas = cores.length === 0;

  const rodape = semAprovadas ? { texto: 'Aprove ao menos 1 imagem no passo 3', ok: false }
    : !isAdmin ? { texto: 'Somente administradores aplicam as fotos no anúncio.', ok: false }
    : andando ? { texto: estadoAtual?.status === 'revertendo' ? 'Desfazendo no Mercado Livre…' : 'Aplicando no Mercado Livre…', ok: false }
    : estadoAtual?.status === 'revertida' ? { texto: `Aplicação desfeita. As fotos anteriores da cor ${atual!.cor} voltaram.`, ok: false }
    : encerrada ? { texto: 'Não foi aplicado em todos os anúncios. Confira o motivo e tente de novo.', ok: false }
    : estadoAtual?.status === 'aplicada' ? { texto: `Fotos aplicadas na cor ${atual!.cor}. Você pode desfazer a qualquer momento.`, ok: true, concluido: true }
    : atual && !atual.confirmada ? { texto: `${atual.modo === 'substituir' ? 'Substitui as' : 'Adiciona às'} fotos da cor ${atual.cor} em ${plural(atual.itens.length, 'anúncio', 'anúncios')}`, ok: true }
    : { texto: 'Veja a prévia antes de aplicar', ok: false };

  return (
    <>
      <MioloPasso titulo="Aplicar no anúncio" frase={`Escolha como as imagens aprovadas entram nas fotos da cor${cor ? ` ${cor}` : ''}.`}>
        <div className="max-w-[760px] space-y-4">
          {erro && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm ring-1 ring-destructive/25">{erro}</p>}
          {avisoLeitura && (
            <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm ring-1 ring-warning/25">
              Não foi possível atualizar o andamento agora. Mostrando o último status; tentando de novo.
            </p>
          )}

          {semAprovadas ? (
            <EmptyState icon={Images} title="Aprove ao menos 1 imagem no passo 3"
              description="Só as imagens aprovadas entram nas fotos do anúncio. Gere as imagens de uma cor e aprove as que vão para o Mercado Livre."
              action={<Button variant="outline" className="h-11 px-4" onClick={aoIrParaGerar}>Ir para Gerar e aprovar</Button>} />
          ) : (
            <section aria-label="Prévia" className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5 text-sm">
              <div className="flex flex-wrap items-end gap-3 p-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Cor</p>
                  <Select value={cor} disabled={ocupado || andando} onValueChange={(v) => trocar(() => setCor(v))}>
                    <SelectTrigger aria-label="Cor" className="h-11 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {cores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Como aplicar</p>
                  <Select value={modo} disabled={ocupado || andando} onValueChange={(v) => trocar(() => setModo(v as ModoAplicar))}>
                    <SelectTrigger aria-label="Como aplicar" className="h-11 w-60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="substituir">Substituir as fotos da cor</SelectItem>
                      <SelectItem value="adicionar">Adicionar às fotos da cor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(!atual?.confirmada || encerrada) && (
                  <Button variant={atual ? 'outline' : 'default'} className="h-11 px-4" disabled={!isAdmin || ocupado || !cor}
                    title={bloqueio ?? 'Ver o que muda, sem alterar o anúncio'} onClick={() => void preparar()}>
                    {ocupado && <Loader2 aria-hidden className="animate-spin" />}{encerrada ? 'Tentar de novo' : atual ? 'Ver de novo' : 'Ver prévia'}
                  </Button>
                )}
              </div>

              {!atual && !ocupado && (
                <p className="border-t px-4 py-3 text-muted-foreground">
                  A prévia mostra as fotos da cor hoje e como ficam depois, em cada anúncio. Nada muda no Mercado Livre até você confirmar.
                </p>
              )}

              {atual && (
                <>
                  <ul aria-label="Anúncios afetados" className="divide-y border-t">
                    {atual.itens.map((id) => {
                      const p = atual.previa?.find((x) => x.item_id === id);
                      return (
                        <li key={id} className="space-y-3 px-4 py-3">
                          {p && <Comparacao p={p} moda={moda} />}
                          <LinhaMLB itemId={id} cor={atual.cor} formato={formato}
                            item={atual.confirmada ? estadoAtual?.itens.find((i) => i.item_id === id) ?? { item_id: id, status: 'pendente', erro: null } : undefined} />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        {atual.modo === 'substituir' ? 'Entram no lugar das fotos da cor' : 'Entram depois das fotos da cor'}, nesta ordem:
                      </p>
                      <ol aria-label="Imagens na ordem" className="flex flex-wrap gap-x-3 font-medium">
                        {atual.manifesto.map((m, i) => <li key={m.imagem_id}><span className="tabular-nums text-muted-foreground">{i + 1}.</span> {nomeImagem(m.missao, moda)}</li>)}
                      </ol>
                    </div>
                    {estadoAtual?.status === 'aplicada' && (
                      <Button variant="outline" className="h-11 px-4" disabled={!isAdmin || ocupado} title={bloqueio ?? 'Voltar as fotos anteriores'}
                        onClick={() => setReverterEm(estadoAtual)}><Undo2 aria-hidden />Desfazer aplicação</Button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {anteriores.length > 0 && (
            <section aria-labelledby="aplicacoes-h" className="space-y-2">
              <h2 id="aplicacoes-h" className="text-sm font-semibold">Aplicações neste anúncio</h2>
              <ul aria-label="Aplicações" aria-live="polite" className="space-y-2">
                {anteriores.map((a) => (
                  <li key={a.id} className="rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                      <p className={PROBLEMA.has(a.status) ? 'font-medium text-destructive' : 'font-medium'}>
                        Cor {a.cor} · {a.modo === 'substituir' ? 'Substituir' : 'Adicionar'} · {STATUS[a.status] ?? a.status}
                      </p>
                      {a.status === 'aplicada' && (
                        <Button variant="outline" className="h-11 px-4" disabled={!isAdmin || ocupado} title={bloqueio ?? 'Voltar as fotos anteriores'}
                          onClick={() => setReverterEm(a)}><Undo2 aria-hidden />Desfazer aplicação</Button>
                      )}
                    </div>
                    <ul className="divide-y px-4">
                      {a.itens.map((i) => (
                        <li key={i.item_id} className={PROBLEMA.has(i.status) ? 'text-destructive' : undefined}>
                          <LinhaMLB itemId={i.item_id} cor={a.cor} formato={formato} item={i} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {estadoAtual && <p aria-live="polite" className="sr-only">{STATUS[estadoAtual.status] ?? estadoAtual.status}</p>}
        </div>
      </MioloPasso>

      <Rodape {...rodape} seta={false} ocupado={ocupado && !!atual}
        variante={'concluido' in rodape ? 'outline' : 'default'}
        rotulo={'concluido' in rodape ? 'Voltar a Publicados' : (atual?.cor ?? cor) ? `Aplicar na cor ${atual?.cor ?? cor}` : 'Aplicar'}
        aoClicar={'concluido' in rodape ? aoVoltar : () => setConfirmando(true)} />

      <AlertDialog open={confirmando && !!atual} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar {plural(nNovas, 'imagem', 'imagens')} na cor {atual?.cor}?</AlertDialogTitle>
            <AlertDialogDescription>
              {atual?.modo === 'substituir'
                ? `Vai trocar ${nSaem === undefined ? 'as fotos' : plural(nSaem, 'foto', 'fotos')} da cor ${atual?.cor} ${anuncios} pelas ${plural(nNovas, 'imagem aprovada', 'imagens aprovadas')}.`
                : `Vai adicionar ${plural(nNovas, 'imagem aprovada', 'imagens aprovadas')} às fotos da cor ${atual?.cor} ${anuncios}.`}
              {' '}Isso é visível para compradores imediatamente. Você pode desfazer depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 px-4">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 px-4" onClick={() => void confirmar()}>Aplicar na cor {atual?.cor}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reverterEm} onOpenChange={(o) => { if (!o) setReverterEm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer a aplicação na cor {reverterEm?.cor}?</AlertDialogTitle>
            <AlertDialogDescription>
              Isto volta as fotos anteriores da cor {reverterEm?.cor} {reverterEm && reverterEm.itens.length > 1 ? 'nos anúncios' : 'no anúncio'}{' '}
              {lista(reverterEm?.itens.map((i) => i.item_id) ?? [])}. Isso é visível para compradores imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 px-4">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 px-4" disabled={!isAdmin || ocupado} onClick={() => reverterEm && void reverter(reverterEm.id)}>
              Confirmar e desfazer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
