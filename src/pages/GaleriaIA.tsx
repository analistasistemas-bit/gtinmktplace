// ADR-0203: Galeria IA em tela única, `/#/publicados/:mlItemId/galeria`. Sem passos: escolhe a cor (ou todas), gera as
// 7 imagens uma a uma ou todas, aprova e coloca no anúncio.
// Identidade = `ml_item_id` da rota (linhas split dividem a família). Guarda própria (link direto): módulo `imagem_ia`;
// anúncio da org (a edge recusa o resto). Aprovar: qualquer membro com o módulo; aplicar no anúncio: só admin.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ExternalLink, Images, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import { usePublicados } from '@/hooks/usePublicados';
import { fmtBRL } from '@/lib/formato';
import { mensagemErro, type RespostaListar } from '@/lib/galeria/api';
import { caminhoDeVolta } from '@/lib/galeria/retorno';
import { PainelImagens } from '@/components/galeria/painel-imagens';
import { PassoAplicar } from '@/components/galeria/passo-aplicar';

/** Recusas do `listar` que querem dizer "este anúncio não é seu / não existe / não tem galeria". */
const SEM_ACESSO = new Set(['anuncio_ambiguo', 'sem_familia_vigente', 'modulo_desligado', 'sem_anuncio']);
const TODAS = '__todas__';

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
  // Só abre com a lista de módulos em mãos (a edge recusaria antes de qualquer geração de qualquer jeito).
  // Falha ao ler a lista não prende a tela: a edge é fail-closed e responde modulo_desligado.
  const modulosProntos = !!modulos.data || !!modulos.isError;
  const { data: publicados } = usePublicados();
  const anuncio = publicados?.find((p) => p.mlItemId === mlItemId);

  const [lista, setLista] = useState<RespostaListar | null>(null);
  const [escolha, setEscolha] = useState<string | null>(null);
  const [parada, setParada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Muda quando o painel precisa recomeçar do zero (cadastro do anúncio mudou durante a aplicação).
  const [recarga, setRecarga] = useState(0);

  useEffect(() => { setLista(null); setEscolha(null); setParada(null); setErro(null); }, [mlItemId]);

  const aoFalha = useCallback((e: string) => { if (SEM_ACESSO.has(e)) setParada(e); }, []);

  if (semModulo) return <TelaParada titulo="Galeria IA indisponível" texto={mensagemErro('modulo_desligado')} />;
  if (parada) {
    return <TelaParada titulo="Anúncio não encontrado"
      texto={parada === 'modulo_desligado' ? mensagemErro(parada) : 'Este anúncio não existe ou não é desta organização.'} />;
  }

  const cores = lista?.cores ?? [];
  // Padrão: a primeira cor (todas as cores de uma vez é escolha do operador, pelo custo e pelo tamanho da tela).
  const cor: string | null = escolha === TODAS ? null : escolha && cores.includes(escolha) ? escolha : cores[0] ?? null;
  const titulo = lista?.titulo ?? anuncio?.titulo ?? 'Fotos com IA';
  const formato = anuncio ? (anuncio.userProducts ? 'User Products' : 'Legacy') : 'Anúncio';
  const aprovadas = lista && cor ? lista.imagens.filter((i) => i.status === 'aprovada' && i.cor === cor && i.roteiro_id === lista.plano_id).length : 0;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 sm:py-2.5">
          <Link to={caminhoDeVolta()}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <ArrowLeft aria-hidden className="size-4" /><span className="max-sm:sr-only">Publicados</span>
          </Link>
          <div aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
            <Images className="size-5" />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-sm font-semibold sm:text-base" title={titulo}>{titulo}</p>
            <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{mlItemId}</span>
              <span>{formato}</span>
              {anuncio?.mlPermalink && (
                <a href={anuncio.mlPermalink} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                  <ExternalLink aria-hidden className="size-3" />Ver no ML
                </a>
              )}
              {lista && <span className="tabular-nums">{fmtBRL(lista.unit_cents / 100)} por imagem</span>}
            </p>
          </div>
          {cores.length > 0 && (
            <Select value={escolha === TODAS ? TODAS : cor ?? ''} onValueChange={setEscolha}>
              <SelectTrigger aria-label="Cor das imagens" className="h-10 w-full sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {cores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                <SelectItem value={TODAS}>Todas as cores</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1240px] space-y-4 px-4 pb-8 pt-4 sm:px-6">
        {erro && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm ring-1 ring-destructive/25">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="flex-1">{erro}</span>
            <Button variant="ghost" size="icon" className="size-10 -my-2 -mr-2" aria-label="Fechar aviso" onClick={() => setErro(null)}><X aria-hidden /></Button>
          </div>
        )}
        {modulosProntos
          ? <PainelImagens key={`${mlItemId}:${recarga}`} mlItemId={mlItemId} cor={cor} aoLista={setLista} aoFalha={aoFalha} />
          : <div className="flex justify-center py-16"><CarregandoMarca rotulo="Carregando" mensagem="Abrindo a galeria…" /></div>}
      </div>

      {lista && cor && aprovadas > 0 && (
        <PassoAplicar key={cor} mlItemId={mlItemId} cores={[cor]} isAdmin={isAdmin} nomes={Object.fromEntries(lista.posicoes.map((x) => [x.posicao, x.nome]))}
          aprovadasPorCor={{ [cor]: aprovadas }} corFixa={cor} formato={formato}
          aoFamiliaMudou={(m) => { setErro(m); setLista(null); setRecarga((n) => n + 1); }}
          aoIrParaGerar={() => document.querySelector('main')?.scrollTo({ top: 0 })} aoVoltar={() => navigate(caminhoDeVolta())} />
      )}
    </div>
  );
}
