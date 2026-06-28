import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, CheckCircle2, AlertTriangle, Loader2, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Dropzone } from '@/components/dropzone';
import { LoteCard } from '@/components/lote-card';
import { LotesEmAndamento } from '@/components/dashboard-lotes-andamento';
import { acumularImagens, filtrarImagens } from '@/lib/acumular-imagens';
import { colunasFaltando, lerCabecalhoXlsx, COLUNAS_OBRIGATORIAS_PLANILHA } from '@/lib/validar-planilha';
import { useUploadLote } from '@/hooks/useUploadLote';
import { useLotes } from '@/hooks/useLotes';
import { usePaginacao } from '@/hooks/usePaginacao';

type ValidacaoPlanilha =
  | { tipo: 'validando' }
  | { tipo: 'ok' }
  | { tipo: 'faltando'; colunas: string[] }
  | { tipo: 'ilegivel' };

export default function Lotes() {
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File[]>([]);
  const [validacao, setValidacao] = useState<ValidacaoPlanilha | null>(null);
  const [imagens, setImagens] = useState<File[]>([]);
  const pastaInputRef = useRef<HTMLInputElement>(null);
  const { status, progresso, erro, iniciar } = useUploadLote();

  const { data: lotes = [], isLoading, error } = useLotes();
  const pag = usePaginacao(lotes);
  const topoLista = useRef<HTMLDivElement>(null);
  const irPara = (p: number) => {
    pag.irPara(p);
    topoLista.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Pré-validação no cliente: confere as colunas obrigatórias antes de enviar
  // (o backend revalida — defesa em profundidade).
  async function handlePlanilha(files: File[]) {
    setPlanilha(files);
    if (files.length !== 1) {
      setValidacao(null);
      return;
    }
    setValidacao({ tipo: 'validando' });
    try {
      const faltando = colunasFaltando(await lerCabecalhoXlsx(files[0]));
      setValidacao(faltando.length === 0 ? { tipo: 'ok' } : { tipo: 'faltando', colunas: faltando });
    } catch {
      setValidacao({ tipo: 'ilegivel' });
    }
  }

  function adicionarImagens(novas: File[]) {
    setImagens((atuais) => acumularImagens(atuais, novas));
  }

  function handlePasta(e: React.ChangeEvent<HTMLInputElement>) {
    const selecionadas = filtrarImagens(Array.from(e.target.files ?? []));
    if (selecionadas.length > 0) adicionarImagens(selecionadas);
    e.target.value = '';
  }

  // Imagens são opcionais: reposição de estoque sobe só a planilha. Lotes novos /
  // cores novas pedem fotos, completáveis na Revisão (aviso + botão por cor).
  // Bloqueia só quando há coluna obrigatória ausente; "ilegível" segue (backend valida).
  const podeProcessar = planilha.length === 1 && validacao?.tipo !== 'faltando' && validacao?.tipo !== 'validando';
  const enviando = status !== 'idle' && status !== 'erro' && status !== 'concluido';

  async function handleProcessar() {
    if (!podeProcessar) return;
    try {
      const r = await iniciar(planilha[0], imagens);
      navigate(`/progresso/${r.loteId}`);
    } catch {
      // erro já exposto pelo hook
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Lotes"
        subtitle="Envie a planilha. As imagens são opcionais: numa reposição de estoque, suba só a planilha."
      />
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Dropzone
            label="Planilha (.xlsx)"
            accept={{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }}
            multiple={false}
            onFiles={handlePlanilha}
            files={planilha}
          />
          {validacao?.tipo === 'validando' && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando colunas…
            </p>
          )}
          {validacao?.tipo === 'ok' && (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Planilha válida — {COLUNAS_OBRIGATORIAS_PLANILHA.length} colunas obrigatórias presentes.
            </p>
          )}
          {validacao?.tipo === 'faltando' && (
            <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Faltam colunas obrigatórias: <strong>{validacao.colunas.join(', ')}</strong>. Corrija a planilha antes de enviar.</span>
            </p>
          )}
          {validacao?.tipo === 'ilegivel' && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Não consegui ler o cabeçalho — confira se é um .xlsx válido. O envio segue e o servidor faz a validação completa.</span>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Dropzone
            label="Imagens (.jpg, .jpeg, .png)"
            accept={{ 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] }}
            multiple={true}
            onFiles={adicionarImagens}
            files={imagens}
            hint="Opcional. Em reposição de estoque, pode deixar vazio. Cores novas e lotes novos pedem fotos — você completa na Revisão. As fotos acumulam."
          />
          <input
            ref={pastaInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error -- atributos não-padrão para selecionar uma pasta inteira
            webkitdirectory=""
            directory=""
            multiple
            onChange={handlePasta}
          />
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => pastaInputRef.current?.click()}
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              Selecionar pasta (inclui subpastas)
            </Button>
            {imagens.length > 0 && (
              <button
                type="button"
                onClick={() => setImagens([])}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Limpar imagens
              </button>
            )}
          </div>
        </div>

        {(enviando || status === 'concluido') && (
          <div className="flex flex-col gap-2">
            <Progress value={progresso} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {status === 'criando' && 'Criando lote...'}
              {status === 'enviando' && `Enviando arquivos... ${progresso}%`}
              {status === 'processando' && 'Processando planilha...'}
              {status === 'concluido' && 'Concluído!'}
            </p>
          </div>
        )}

        {erro && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{erro}</p>
        )}

        <Button onClick={handleProcessar} disabled={!podeProcessar || enviando} size="lg">
          {enviando ? 'Enviando...' : 'Processar'}
        </Button>
      </div>

      {/* ── Lotes: andamento + histórico (migrado do Dashboard) ── */}
      <div className="mt-10">
        <LotesEmAndamento lotes={lotes} />

        <h2 className="mb-2 mt-2 text-sm font-medium text-muted-foreground">Histórico de lotes</h2>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando lotes...</div>
        ) : error ? (
          <div className="text-sm text-destructive">Erro ao carregar lotes: {(error as Error).message}</div>
        ) : lotes.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="Nenhum lote ainda"
            description="Faça upload de uma planilha acima para começar."
          />
        ) : (
          <div ref={topoLista} className="flex flex-col gap-3 scroll-mt-6">
            {pag.itensPagina.map((lote) => (
              <LoteCard key={lote.id} lote={lote} />
            ))}
            <Pagination
              rotuloItem="lote"
              paginaAtual={pag.paginaAtual}
              totalPaginas={pag.totalPaginas}
              inicio={pag.inicio}
              fim={pag.fim}
              total={pag.total}
              tamanho={pag.tamanho}
              onIrPara={irPara}
              onTamanho={pag.setTamanho}
            />
          </div>
        )}
      </div>
    </div>
  );
}
