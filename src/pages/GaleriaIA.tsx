// ADR-0201 + plano 2026-11-11 (Fase C): Galeria IA em página própria, `/#/publicados/:mlItemId/galeria`.
// Identidade = `ml_item_id` da rota (linhas split dividem a família); a família vigente volta da edge e é ela que a tela
// reenvia. Guarda própria (link direto): módulo `imagem_ia`, anúncio da org; aprovar/aplicar só admin (os demais leem).
// Abertura sequencial: `montar` (pode chamar a visão paga e desatualizar o roteiro) → `ler` → `listar` (só leitura).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Images, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import { usePublicados } from '@/hooks/usePublicados';
import { fmtBRL } from '@/lib/formato';
import {
  ERROS_DE_RECARGA, lerRoteiro, listarImagens, mensagemErro, montarFicha,
  type Ficha, type Res, type RespostaListar, type RespostaRoteiro,
} from '@/lib/galeria/api';
import { caminhoDeVolta } from '@/lib/galeria/retorno';
import { cn } from '@/lib/utils';
import { PassoConferir } from '@/components/galeria/passo-conferir';
import { PassoEscolher } from '@/components/galeria/passo-escolher';
import { PassoGerar } from '@/components/galeria/passo-gerar';
import { PassoAplicar } from '@/components/galeria/passo-aplicar';
import { MioloPasso, Rodape } from '@/components/galeria/rodape';

type Falha = Extract<Res<unknown>, { ok: false }>;
type Passo = 1 | 2 | 3 | 4;
const PASSOS: Record<Passo, string> = { 1: 'Conferir dados', 2: 'Escolher imagens', 3: 'Gerar e aprovar', 4: 'Aplicar no anúncio' };
/** Recusas do `montar` que querem dizer "este anúncio não é seu / não existe / não tem galeria". */
const SEM_ACESSO = new Set(['anuncio_ambiguo', 'sem_familia_vigente', 'modulo_desligado', 'sem_anuncio']);

function TelaParada({ titulo, texto }: { titulo: string; texto: string }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
      <AlertTriangle aria-hidden className="size-6 text-warning" />
      <h1 className="text-xl font-semibold">{titulo}</h1>
      <p role="alert" className="text-sm text-muted-foreground">{texto}</p>
      <Button variant="outline" className="h-11 px-4" onClick={() => navigate(caminhoDeVolta())}><ArrowLeft aria-hidden />Voltar a Publicados</Button>
    </div>
  );
}

export default function GaleriaIA() {
  const { mlItemId = '' } = useParams();
  const navigate = useNavigate();
  const isAdmin = usePodeExecutarOperacao();
  const modulos = useModulosHabilitados({ retryOnMount: false });
  const semModulo = !!modulos.data && !modulos.data.includes('imagem_ia');
  // Revisão B+C (achado 6): só abre com a lista de módulos em mãos (a edge recusaria antes da visão de qualquer jeito).
  // Falha ao ler a lista não prende a tela: a edge é fail-closed e responde modulo_desligado.
  const modulosProntos = !!modulos.data || !!modulos.isError;
  const { data: publicados } = usePublicados();
  const anuncio = publicados?.find((p) => p.mlItemId === mlItemId);

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [resp, setResp] = useState<RespostaRoteiro | null>(null);
  const [moda, setModa] = useState<boolean | null>(null);
  const [passo, setPasso] = useState<Passo>(1);
  const [alcancado, setAlcancado] = useState<Passo>(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [parada, setParada] = useState<string | null>(null);
  // `ler` respondeu nesta abertura: só então o passo 2 sabe se há roteiro vigente e pode oferecer "Criar".
  const [roteiroLido, setRoteiroLido] = useState(false);
  // Algo para gerar/aplicar: roteiro aprovado do anúncio (mesmo com rascunho por cima) ou cena não exibida.
  const [temGaleria, setTemGaleria] = useState(false);
  const [lista, setLista] = useState<RespostaListar | null>(null);
  // Cabeçalho do anúncio no ML: só vem na abertura (`montar`); as outras ações da ficha não o trazem.
  const [cab, setCab] = useState<Pick<Ficha, 'capa_url' | 'titulo_anuncio' | 'preco_anuncio' | 'formato'>>({});
  const capa = cab.capa_url ?? null;
  const [capaQuebrou, setCapaQuebrou] = useState(false);
  const abertura = useRef(0);
  // Envio pendente do passo 2 (Fase B): sai antes de trocar de passo ou voltar a Publicados.
  const descarga = useRef<(() => Promise<boolean>) | null>(null);
  const registrarDescarga = useCallback((f: (() => Promise<boolean>) | null) => { descarga.current = f; }, []);

  const carregar = useCallback(async () => {
    const id = ++abertura.current;
    setCarregando(true); setRoteiroLido(false);
    const r = await montarFicha(mlItemId);
    if (id !== abertura.current) return;
    // Não limpa o erro: a mensagem que motivou a recarga (categoria_mudou etc.) sobrevive a ela.
    if (!r.ok) {
      if (SEM_ACESSO.has(r.erro)) setParada(r.erro); else setErro(mensagemErro(r.erro));
      setCarregando(false);
      return;
    }
    setCab({ capa_url: r.dados.capa_url, titulo_anuncio: r.dados.titulo_anuncio, preco_anuncio: r.dados.preco_anuncio, formato: r.dados.formato });
    setCapaQuebrou(false);
    const l = await lerRoteiro(mlItemId);
    if (id !== abertura.current) return;
    setFicha(r.dados);
    let aprovado = false;
    if (l.ok) {
      setModa(l.dados.moda);
      const rr = l.dados.roteiro ? (l.dados as RespostaRoteiro) : null;
      setResp(rr);
      aprovado = rr?.roteiro.status === 'aprovado';
      setRoteiroLido(true);
      if (l.dados.aviso) setErro(mensagemErro(l.dados.aviso));
    } else setErro(mensagemErro(l.erro));
    const g = await listarImagens(mlItemId);
    if (id !== abertura.current) return;
    const tem = g.ok && (!!g.dados.roteiro || g.dados.imagens.some((i) => i.origem === 'gerador' && !i.exibida));
    setTemGaleria(tem);
    if (g.ok) setLista(g.dados);
    setAlcancado((a) => (Math.max(a, tem || aprovado ? 4 : l.ok && l.dados.roteiro ? 2 : 1) as Passo));
    setCarregando(false);
  }, [mlItemId]);

  useEffect(() => {
    if (semModulo || !mlItemId || !modulosProntos) return;
    setFicha(null); setResp(null); setModa(null); setPasso(1); setAlcancado(1); setTemGaleria(false); setLista(null); setCab({});
    setErro(null); setParada(null);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { abertura.current++; };
  }, [mlItemId, semModulo, modulosProntos, carregar]);

  /** Falha de qualquer ação: mensagem clara; erros que invalidam o chão recarregam e descartam o roteiro em tela. */
  const falhou = useCallback((f: Falha) => {
    // Erro que o passo já mostra no lugar certo (campos, rodapé) não empilha banner geral (I6).
    if (f.erro !== 'roteiro_invalido' && f.erro !== 'ciencia_pendente') setErro(mensagemErro(f.erro));
    if (f.erro === 'roteiro_invalido') {
      setResp((r) => (r ? { ...r, erros: (f.corpo.erros as string[]) ?? r.erros, erros_por_missao: (f.corpo.erros_por_missao as Record<string, string[]>) ?? r.erros_por_missao } : r));
    } else if (f.erro === 'ciencia_pendente') {
      setResp((r) => (r ? { ...r, ciencia_pendente: (f.corpo.campos as string[]) ?? r.ciencia_pendente } : r));
    }
    if (ERROS_DE_RECARGA.has(f.erro)) { setResp(null); void carregar(); }
  }, [carregar]);

  const aoMudarFicha = useCallback((r: Res<Ficha>) => {
    if (r.ok) { setFicha(r.dados); setErro(null); } else falhou(r);
  }, [falhou]);

  const aoResposta = useCallback((r: RespostaRoteiro) => { setResp(r); setModa(r.roteiro.moda); setErro(null); }, []);

  async function irPara(p: Passo) {
    if (p === passo) return;
    if (descarga.current && !(await descarga.current())) {
      toast.error('Não foi possível salvar os textos. Tente de novo antes de sair do passo.');
      return;
    }
    setPasso(p);
    setAlcancado((a) => (Math.max(a, p) as Passo));
    document.querySelector('main')?.scrollTo({ top: 0 });
  }

  // Revisão B+C (achado 2): mesmo critério da troca de passo; com o salvar falhando, avisa e fica.
  async function voltar(e: React.MouseEvent) {
    e.preventDefault();
    if (descarga.current && !(await descarga.current())) {
      toast.error('Não foi possível salvar os textos. Tente de novo antes de sair da galeria.');
      return;
    }
    navigate(caminhoDeVolta());
  }

  if (semModulo) return <TelaParada titulo="Galeria IA indisponível" texto={mensagemErro('modulo_desligado')} />;
  if (parada) {
    return <TelaParada titulo="Anúncio não encontrado"
      texto={parada === 'modulo_desligado' ? mensagemErro(parada) : 'Este anúncio não existe ou não é desta organização.'} />;
  }

  const podeGerar = resp?.roteiro.status === 'aprovado' || temGaleria;
  // Link direto: o cabeçalho vem do `montar`; Publicados (cache) só completa o que o ML não respondeu.
  const titulo = cab.titulo_anuncio ?? anuncio?.titulo ?? (ficha ? `Produto ${ficha.codigo_pai}` : 'Galeria IA');
  const formato = cab.formato ? (cab.formato === 'user_products' ? 'User Products' : 'Legacy')
    : anuncio ? (anuncio.userProducts ? 'User Products' : 'Legacy') : null;
  const preco = cab.preco_anuncio ?? anuncio?.precoPublicacao ?? null;
  const aprovadasLista = (lista?.imagens ?? []).filter((i) => i.status === 'aprovada' && i.roteiro_id === lista?.roteiro?.id);
  const aprovadas = aprovadasLista.length;
  const gerandoImagens = (lista?.imagens ?? []).some((i) => ['pendente', 'submetendo', 'gerando'].includes(i.status)
    || (i.status === 'gerada' && i.origem === 'gerador' && i.alertas === null));
  const aprovadasPorCor = lista ? aprovadasLista.reduce<Record<string, number>>((m, i) => ({ ...m, [i.cor]: (m[i.cor] ?? 0) + 1 }), {}) : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
          <div className="flex items-center gap-3 py-1.5 sm:py-2.5">
            <Link to={caminhoDeVolta()} onClick={(e) => void voltar(e)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              <ArrowLeft aria-hidden className="size-4" /><span className="max-sm:sr-only">Publicados</span>
            </Link>
            {capa && !capaQuebrou ? (
              <img src={capa} alt="" data-testid="capa-anuncio" onError={() => setCapaQuebrou(true)}
                className="size-11 shrink-0 rounded-md border bg-muted object-cover" />
            ) : (
              <div aria-hidden data-testid="capa-icone" className="grid size-11 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                <Images className="size-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold sm:text-base" title={titulo}>{titulo}</p>
              <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{mlItemId}</span>
                {formato && <span>{formato}</span>}
                {preco !== null && <span className="tabular-nums">{fmtBRL(preco)}</span>}
                {ficha && ficha.cores.length > 0 && <span className="max-sm:hidden">Cores: {ficha.cores.join(' · ')}</span>}
              </p>
            </div>
          </div>
          <nav aria-label="Passos da galeria">
            <ol className="flex gap-1 pb-1.5 sm:pb-2.5">
              {([1, 2, 3, 4] as Passo[]).map((n) => {
                const atual = n === passo;
                const feito = n < passo || (n < alcancado && !atual);
                const bloqueado = n > alcancado || ((n === 3 || n === 4) && !podeGerar) || !ficha;
                return (
                  <li key={n} className={cn('min-w-0 flex-1', atual && 'max-md:flex-[4]')}>
                    <button type="button" disabled={bloqueado} aria-current={atual ? 'step' : undefined} onClick={() => void irPara(n)}
                      className={cn(
                        'relative flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-medium outline-none',
                        'after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-border',
                        'hover:enabled:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55 max-md:justify-center',
                        atual ? 'text-foreground after:bg-primary' : 'text-muted-foreground', feito && !atual && 'after:bg-success/55',
                      )}>
                      <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                        atual && 'border-primary bg-primary text-primary-foreground',
                        feito && !atual && 'border-success/35 bg-success/15 text-success')}>
                        {feito && !atual ? <Check aria-hidden className="size-3.5" /> : n}
                      </span>
                      <span className={cn('truncate', !atual && 'max-md:sr-only')}>{PASSOS[n]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </header>

      {erro && (
        <div className="mx-auto w-full max-w-[1240px] px-4 pt-4 sm:px-6">
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm ring-1 ring-destructive/25">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="flex-1">{erro}</span>
            <Button variant="ghost" size="icon" className="size-11 -my-3 -mr-2" aria-label="Fechar aviso" onClick={() => setErro(null)}><X aria-hidden /></Button>
          </div>
        </div>
      )}

      {!ficha ? (
        <div className="flex flex-1 items-center justify-center py-16">
          {carregando ? <CarregandoMarca rotulo="Carregando" mensagem="Abrindo a galeria…" /> : (
            <Button variant="outline" className="h-11 px-4" onClick={() => { setErro(null); void carregar(); }}>Tentar de novo</Button>
          )}
        </div>
      ) : passo === 1 ? (
        <PassoConferir mlItemId={mlItemId} ficha={ficha} moda={moda} aoMudar={aoMudarFicha} aoContinuar={() => void irPara(2)} />
      ) : passo === 2 ? (
        <PassoEscolher mlItemId={mlItemId} ficha={ficha} isAdmin={isAdmin} resp={resp} podeCriar={roteiroLido}
          aoResposta={aoResposta} aoFalhar={falhou} aoRegistrarDescarga={registrarDescarga}
          aoContinuar={async (aprovou) => {
            if (aprovou) await carregar();
            setPasso(3); setAlcancado(4);
          }} />
      ) : passo === 3 ? (
        <>
          <MioloPasso titulo="Gerar e aprovar" frase="Gere as imagens de uma cor e aprove as que vão para o anúncio.">
            <PassoGerar mlItemId={mlItemId} ficha={ficha} aoRecarregar={() => void carregar()} aoVoltarRoteiro={() => void irPara(2)} aoLista={setLista} />
          </MioloPasso>
          <Rodape ok={aprovadas > 0 && !gerandoImagens} rotulo="Continuar" aoClicar={() => void irPara(4)}
            texto={gerandoImagens ? 'Aguarde as imagens ficarem prontas' : aprovadas > 0 ? `${aprovadas} ${aprovadas === 1 ? 'imagem aprovada' : 'imagens aprovadas'} (${Object.entries(aprovadasPorCor ?? {}).map(([c, n]) => `${c}: ${n}`).join(' · ')})` : 'Aprove ao menos 1 imagem para continuar'} />
        </>
      ) : (
        <PassoAplicar mlItemId={mlItemId} ficha={ficha} isAdmin={isAdmin} moda={moda ?? false} aprovadasPorCor={aprovadasPorCor}
          formato={formato ?? 'Anúncio'}
          aoFamiliaMudou={(m) => { setErro(m); setResp(null); void carregar(); }}
          aoIrParaGerar={() => void irPara(3)} aoVoltar={() => navigate(caminhoDeVolta())} />
      )}
    </div>
  );
}
