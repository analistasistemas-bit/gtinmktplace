// ADR-0200 (Task 13): Criar kit com variação, a partir de Publicados. Rascunho aprovado em 06/11: cores e peças por
// kit → combinações geradas → quantidade por combinação × tamanho (só > 0 vira anúncio) com o saldo de peças ao lado
// → preço, texto por IA e foto por combinação → simulador → confirmar. Nada vai ao ML sem passar por esta revisão.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useFamilia } from '@/hooks/useFamilia';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { QK_KITS_VARIACAO } from '@/hooks/useKitsVariacao';
import { QK } from '@/lib/queries';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import {
  AVISO_SELETOR_ML, gerarCombinacoes, rotuloCombinacao, saldoDePecas,
} from '@/lib/kit-variacao';
import { criarKitVariacaoEdge, enviarFotoKit, gerarTextoKitEdge } from '@/lib/kit-variacao-edge';
import { SimuladorKit } from '@/components/kit-variacao/simulador-kit';
import { ExplicacaoReposicao } from '@/components/kit-variacao/explicacao-reposicao';
import { FotoCombinacao, type FotoKit } from '@/components/kit-variacao/foto-combinacao';

const PECAS = [2, 3, 4, 5, 6];
const TITULO_MAX = 60;

const MENSAGEM_POR_MOTIVO: Record<string, string> = {
  pedido_diferente: 'Este pedido mudou depois de uma tentativa anterior. Feche e abra a tela para criar de novo.',
  peca_insuficiente: 'Faltam peças na base para as quantidades pedidas. Confira o saldo e tente de novo.',
  base_full: 'Produto no Full não pode virar kit: o estoque de lá é separado.',
  base_legacy: 'Este anúncio não é User Products. Kit com variação só sai de anúncio User Products.',
  base_em_kit: 'Estas peças já estão em Kit Virtual ou kit vinculado.',
  foto_moderada: 'Uma das fotos é de anúncio moderado no Mercado Livre. Use outra foto.',
  base_desatualizada: 'Existe uma versão mais nova deste produto. Abra o kit a partir dela.',
};

type Etapa = 'montagem' | 'anuncio' | 'conferir';
const chaveQtd = (rotulo: string, tamanho: string) => `${rotulo}|${tamanho}`;
const inteiro = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);

export function DialogCriarKitVariacao({ familiaBaseId, open, onOpenChange, isAdmin }: {
  familiaBaseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** "Vender só em kit" pausa anúncios (ADR-0060): só admin vê a opção. */
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const familiaQ = useFamilia(familiaBaseId, open, false);
  const { data: modulos } = useModulosHabilitados();
  const temImagemIA = !!modulos?.includes('imagem_ia');

  const [etapa, setEtapa] = useState<Etapa>('montagem');
  const [cores, setCores] = useState<string[]>([]);
  const [pecas, setPecas] = useState(2);
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [preco, setPreco] = useState('');
  const [tipo, setTipo] = useState<'gold_special' | 'gold_pro'>('gold_special');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [previaId, setPreviaId] = useState<string | undefined>();
  const [fotos, setFotos] = useState<Record<string, FotoKit>>({});
  const [soEmKit, setSoEmKit] = useState(false);
  const [meta, setMeta] = useState('3');
  const [podeSeguir, setPodeSeguir] = useState(false);
  const chave = useRef('');
  // Foto já enviada nesta abertura: a repetição usa o mesmo caminho (o pedido da chave não muda).
  const enviadas = useRef(new Map<string, { file: File; path: string }>());

  useEffect(() => {
    if (!open) return;
    chave.current = crypto.randomUUID();
    enviadas.current.clear();
    setEtapa('montagem'); setCores([]); setPecas(2); setQtd({}); setPreco(''); setTipo('gold_special');
    setTitulo(''); setDescricao(''); setPreviaId(undefined); setFotos({}); setSoEmKit(false); setMeta('3');
  }, [open]);

  const variacoes = useMemo(
    () => (familiaQ.data?.variacoes ?? []).filter((v) => !v.excluidaDaPublicacao),
    [familiaQ.data],
  );
  const coresBase = useMemo(() => [...new Set(variacoes.map((v) => v.cor))], [variacoes]);
  const tamanhos = useMemo(
    () => [...new Set(variacoes.map((v) => v.tamanho).filter((t): t is string => !!t))],
    [variacoes],
  );
  const marcadas = useMemo(() => coresBase.filter((c) => cores.includes(c)), [coresBase, cores]);
  const combinacoes = useMemo(() => gerarCombinacoes(marcadas, pecas), [marcadas, pecas]);
  const quantidades = useMemo(() => combinacoes.flatMap((c) => tamanhos.map((t) => ({
    cores: c, tamanho: t, quantidade: inteiro(qtd[chaveQtd(rotuloCombinacao(c), t)]),
  }))).filter((q) => q.quantidade > 0), [combinacoes, tamanhos, qtd]);
  const saldo = useMemo(() => saldoDePecas(variacoes, marcadas, tamanhos, quantidades), [variacoes, marcadas, tamanhos, quantidades]);
  const excesso = saldo.some((s) => s.precisa > s.tem);
  const totalKits = quantidades.reduce((s, q) => s + q.quantidade, 0);
  const combinacoesPublicadas = useMemo(
    () => combinacoes.filter((c) => quantidades.some((q) => q.cores === c)),
    [combinacoes, quantidades],
  );

  // Texto e prévia são de uma combinação de cores e peças: mudar uma delas descarta (senão: previa_divergente).
  const mudarMontagem = (f: () => void) => { f(); setTitulo(''); setDescricao(''); setPreviaId(undefined); };

  const precoNum = Number(preco.replace(',', '.'));
  const metaNum = inteiro(meta);
  const semFoto = combinacoesPublicadas.filter((c) => !fotos[rotuloCombinacao(c)]);
  const tituloOk = titulo.trim().length > 0 && titulo.length <= TITULO_MAX;
  const podeMontagem = marcadas.length >= pecas && totalKits > 0 && !excesso;
  const podeAnuncio = precoNum > 0 && tituloOk && descricao.trim().length > 0 && semFoto.length === 0;

  function irParaAnuncio() {
    if (!preco) {
      // Sugestão: soma dos preços unitários da combinação mais cara (spec, "Publicação no ML").
      const sugerido = Math.max(...quantidades.map((q) => q.cores.reduce((s, cor) => {
        const v = variacoes.find((x) => x.cor === cor && x.tamanho === q.tamanho);
        return s + (v?.precoPublicacao ?? v?.preco ?? 0);
      }, 0)));
      if (sugerido > 0) setPreco(sugerido.toFixed(2));
    }
    setEtapa('anuncio');
  }

  const texto = useMutation({
    mutationFn: () => gerarTextoKitEdge({ familiaBaseId, pecasPorKit: pecas, cores: marcadas }),
    onSuccess: (r) => {
      if (!r.ok) { toast.error('Não foi possível gerar o texto', { description: r.mensagem }); return; }
      setTitulo(r.titulo); setDescricao(r.descricao); setPreviaId(r.previa_id);
    },
    onError: (e) => toast.error('Não foi possível gerar o texto', { description: (e as Error).message }),
  });

  const criar = useMutation({
    mutationFn: async () => {
      const caminhos: Record<string, string> = {};
      for (const c of combinacoesPublicadas) {
        const rotulo = rotuloCombinacao(c);
        const file = fotos[rotulo];
        // Foto gerada por IA e aprovada já está no storage da org.
        if (!(file instanceof File)) { caminhos[rotulo] = file.path; continue; }
        const ja = enviadas.current.get(rotulo);
        if (ja?.file === file) { caminhos[rotulo] = ja.path; continue; }
        const path = await enviarFotoKit(`kit-variacao-${chave.current}`, rotulo, file);
        enviadas.current.set(rotulo, { file, path });
        caminhos[rotulo] = path;
      }
      return criarKitVariacaoEdge({
        familiaBaseId, cores: marcadas, pecasPorKit: pecas, preco: precoNum, quantidades, titulo, descricao,
        fotos: caminhos, soEmKit: isAdmin && soEmKit, meta: soEmKit ? metaNum : 0, chaveCadastro: chave.current,
        listingTypeId: tipo, previaId,
      });
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error('Falha ao criar o kit', { description: (r.motivo && MENSAGEM_POR_MOTIVO[r.motivo]) ?? r.mensagem });
        return;
      }
      toast.success('Kit criado. A montagem começou.', {
        description: `Os anúncios individuais ficam pausados alguns minutos enquanto as peças vão para o kit. ${AVISO_SELETOR_ML}`,
        duration: 12_000,
      });
      qc.invalidateQueries({ queryKey: QK_KITS_VARIACAO });
      qc.invalidateQueries({ queryKey: QK.publicados });
      onOpenChange(false);
    },
    onError: (e) => toast.error('Falha ao criar o kit', { description: (e as Error).message }),
  });

  const exemplo = quantidades[0];

  return (
    <Dialog open={open} onOpenChange={(v) => !criar.isPending && onOpenChange(v)}>
      <DialogContent
        processando={criar.isPending}
        rotuloProcessando="Criando o kit"
        className="flex max-h-[85vh] w-full max-w-[calc(100vw-2rem)] flex-col p-0 sm:max-w-4xl"
      >
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>Criar kit com variação</DialogTitle>
            <DialogDescription>
              {etapa === 'montagem' && 'Escolha as cores e quantos kits montar em cada combinação e tamanho. Só vira anúncio o que tiver quantidade.'}
              {etapa === 'anuncio' && 'Preço, texto e foto de cada combinação. É a revisão do anúncio: nada vai ao Mercado Livre sem passar por aqui.'}
              {etapa === 'conferir' && 'Confira o lucro antes de criar.'}
            </DialogDescription>
          </DialogHeader>

          <ol className="flex gap-2 text-xs" aria-label="Etapas">
            {(['montagem', 'anuncio', 'conferir'] as Etapa[]).map((e, i) => (
              <li
                key={e}
                aria-current={etapa === e ? 'step' : undefined}
                className={cn('rounded-full border px-2 py-0.5', etapa === e ? 'border-primary/30 bg-primary/10 text-primary' : 'text-muted-foreground')}
              >
                {i + 1}. {e === 'montagem' ? 'Montagem' : e === 'anuncio' ? 'Anúncio' : 'Conferir'}
              </li>
            ))}
          </ol>

          {familiaQ.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando o produto…</p>
          ) : familiaQ.isError || !familiaQ.data ? (
            <p className="text-sm text-danger">Não foi possível carregar o produto. Feche e tente de novo.</p>
          ) : etapa === 'montagem' ? (
            <div className="grid gap-4">
              <section className="grid gap-2" aria-label="Cores e peças">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm font-medium">Cores</span>
                  {coresBase.map((c) => (
                    <label key={c} className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <Checkbox
                        aria-label={`Cor ${c}`}
                        checked={cores.includes(c)}
                        onCheckedChange={(v) => mudarMontagem(() => setCores((p) => (v === true ? [...p, c] : p.filter((x) => x !== c))))}
                      />
                      {c}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Peças por kit</span>
                  <Select value={String(pecas)} onValueChange={(v) => mudarMontagem(() => setPecas(Number(v)))}>
                    <SelectTrigger className="h-8 w-20" aria-label="Peças por kit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PECAS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {marcadas.length < pecas && (
                    <span className="text-xs text-muted-foreground">Marque pelo menos {pecas} cores.</span>
                  )}
                </div>
              </section>

              {combinacoes.length > 0 && (
                <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <caption className="px-3 pt-2 text-left text-xs text-muted-foreground">
                        Kits a montar · {combinacoes.length} {combinacoes.length === 1 ? 'combinação' : 'combinações'}
                      </caption>
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Combinação</th>
                          {tamanhos.map((t) => <th key={t} className="px-2 py-2 text-right font-medium">{t}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {combinacoes.map((c) => {
                          const rotulo = rotuloCombinacao(c);
                          return (
                            <tr key={rotulo} aria-label={`Combinação ${rotulo}`} className="border-b last:border-0">
                              <td className="px-3 py-1.5">{rotulo}</td>
                              {tamanhos.map((t) => (
                                <td key={t} className="px-2 py-1.5 text-right">
                                  <Input
                                    type="number" min={0} step={1} inputMode="numeric"
                                    aria-label={`Quantidade ${rotulo} ${t}`}
                                    className="ml-auto h-8 w-16 text-right tabular-nums"
                                    value={qtd[chaveQtd(rotulo, t)] ?? ''}
                                    placeholder="0"
                                    onChange={(e) => setQtd((p) => ({ ...p, [chaveQtd(rotulo, t)]: e.target.value }))}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <caption className="px-3 pt-2 text-left text-xs text-muted-foreground">Saldo de peças (usa / tem)</caption>
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Cor</th>
                          {tamanhos.map((t) => <th key={t} className="px-2 py-2 text-right font-medium">{t}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {marcadas.map((cor) => (
                          <tr key={cor} className="border-b last:border-0">
                            <td className="px-3 py-1.5">{cor}</td>
                            {tamanhos.map((t) => {
                              const s = saldo.find((x) => x.cor === cor && x.tamanho === t)!;
                              const falta = s.precisa > s.tem;
                              return (
                                <td
                                  key={t}
                                  aria-label={`Saldo ${cor} ${t}`}
                                  data-excesso={falta ? 'true' : 'false'}
                                  className={cn('px-2 py-1.5 text-right tabular-nums', falta ? 'font-semibold text-danger' : s.precisa > 0 ? '' : 'text-muted-foreground')}
                                >
                                  {s.existe ? `${s.precisa} de ${s.tem}` : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {excesso && (
                <p className="text-sm text-danger">Faltam peças: diminua a quantidade nas células em vermelho.</p>
              )}
              {totalKits > 0 && !excesso && (
                <p className="text-xs text-muted-foreground">
                  {quantidades.length} {quantidades.length === 1 ? 'anúncio' : 'anúncios'} · {totalKits} {totalKits === 1 ? 'kit' : 'kits'} no total.
                </p>
              )}
            </div>
          ) : etapa === 'anuncio' ? (
            <div className="grid gap-4">
              <section className="grid gap-3 sm:grid-cols-2" aria-label="Preço">
                <div className="grid gap-1 text-sm">
                  <label htmlFor="kv-preco" className="font-medium">Preço do kit</label>
                  <Input id="kv-preco" aria-label="Preço do kit" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} className="h-9 tabular-nums" />
                  <span className="text-xs text-muted-foreground">Um preço para todas as combinações e tamanhos.</span>
                </div>
                <div className="grid gap-1 text-sm">
                  <span className="font-medium">Tipo de anúncio</span>
                  <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
                    <SelectTrigger className="h-9" aria-label="Tipo de anúncio"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gold_special">Clássico</SelectItem>
                      <SelectItem value="gold_pro">Premium</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {isAdmin && (
                <section className="grid gap-2" aria-label="Vender só em kit">
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox id="kv-so-em-kit" aria-label="Vender só em kit" checked={soEmKit} onCheckedChange={(v) => setSoEmKit(v === true)} />
                    <label htmlFor="kv-so-em-kit" className="cursor-pointer font-medium">Vender só em kit</label>
                    <span className="text-xs text-muted-foreground">pausa os anúncios individuais destas cores</span>
                  </div>
                  {soEmKit && (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        <label htmlFor="kv-meta">Meta por combinação e tamanho</label>
                        <Input
                          id="kv-meta" aria-label="Meta por combinação e tamanho" type="number" min={0} step={1} inputMode="numeric"
                          className="h-8 w-20 text-right tabular-nums" value={meta} onChange={(e) => setMeta(e.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">kits no ar</span>
                      </div>
                      {exemplo && <ExplicacaoReposicao meta={metaNum} cores={exemplo.cores} tamanho={exemplo.tamanho} />}
                    </>
                  )}
                </section>
              )}

              <section className="grid gap-2" aria-label="Texto do anúncio">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Título e descrição</span>
                  <Button type="button" variant="outline" size="sm" disabled={texto.isPending} onClick={() => texto.mutate()}>
                    {texto.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    {titulo ? 'Gerar de novo' : 'Gerar título e descrição'}
                  </Button>
                </div>
                <Input aria-label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Gere por IA ou escreva" />
                <span className={cn('text-xs', titulo.length > TITULO_MAX ? 'text-danger' : 'text-muted-foreground')}>
                  {titulo.length}/{TITULO_MAX} caracteres
                </span>
                <Textarea aria-label="Descrição" rows={5} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </section>

              <section className="grid gap-2" aria-label="Fotos">
                <span className="text-sm font-medium">Foto de cada combinação</span>
                <p className="text-xs text-muted-foreground">
                  No Mercado Livre a cor define a foto: cada combinação precisa da sua.
                  {temImagemIA && ' Gere por IA a partir das fotos das cores ou envie a sua. A foto gerada só vale depois de aprovada.'}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {combinacoesPublicadas.map((c) => {
                    const rotulo = rotuloCombinacao(c);
                    return (
                      <FotoCombinacao
                        key={rotulo} rotulo={rotulo} cores={c} familiaBaseId={familiaBaseId} temImagemIA={temImagemIA}
                        valor={fotos[rotulo]} onChange={(f) => setFotos((p) => ({ ...p, [rotulo]: f }))}
                      />
                    );
                  })}
                </div>
                {semFoto.length > 0 && (
                  <p className="text-xs text-danger">Envie a foto de cada combinação ({semFoto.length} faltando).</p>
                )}
              </section>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <p><span className="font-medium">{titulo}</span></p>
                <p className="text-muted-foreground">
                  {precoNum > 0 && `${fmtBRL(precoNum)} · `}{quantidades.length} {quantidades.length === 1 ? 'anúncio' : 'anúncios'} · {totalKits} kits
                  {soEmKit && ` · Vender só em kit, meta ${metaNum}`}
                </p>
              </div>
              {/* Mesmo estado `preco` da etapa 2: editar aqui é editar lá, e o simulador recota (ADR-0200). */}
              <div className="grid gap-1 text-sm sm:max-w-xs">
                <label htmlFor="kv-preco" className="font-medium">Preço do kit</label>
                <Input
                  id="kv-preco" aria-label="Preço do kit" inputMode="decimal" value={preco} disabled={criar.isPending}
                  onChange={(e) => setPreco(e.target.value)} className="h-9 tabular-nums"
                />
              </div>
              <SimuladorKit
                familiaBaseId={familiaBaseId} cores={marcadas} pecas={pecas} quantidades={quantidades}
                preco={precoNum} tipo={tipo} onPodeSeguir={setPodeSeguir}
              />
              <p className="text-xs text-muted-foreground">
                Ao criar, os anúncios individuais destas peças ficam pausados alguns minutos enquanto as peças vão para o kit.
              </p>
            </div>
          )}

          <DialogFooter>
            {etapa === 'montagem' ? (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button disabled={!podeMontagem} onClick={irParaAnuncio}>Próximo</Button>
              </>
            ) : etapa === 'anuncio' ? (
              <>
                <Button variant="outline" onClick={() => setEtapa('montagem')}>Voltar</Button>
                <Button disabled={!podeAnuncio} onClick={() => setEtapa('conferir')}>Próximo</Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={criar.isPending} onClick={() => setEtapa('anuncio')}>Voltar</Button>
                <Button disabled={!(precoNum > 0) || !podeSeguir || criar.isPending} onClick={() => criar.mutate()}>
                  {criar.isPending ? 'Criando…' : 'Criar kit'}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
