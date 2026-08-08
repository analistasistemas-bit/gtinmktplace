import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Sparkles, Send, MessageCircleQuestion, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QK } from '@/lib/queries';
import {
  fetchPerguntasPagina, buscarPerguntas, pergCasaStatus, responderPergunta, sugerirResposta,
  type Pergunta, type FiltroStatusPergunta,
} from '@/lib/perguntas';
import { fmtDataCurta, URL_PERGUNTAS_ML } from '@/lib/ml-status';
import { nomeCurtoComprador } from '@/lib/pedidos-faturamento';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildPerguntasReport } from '@/lib/export/adapters';
import { toast } from 'sonner';

function CardPergunta({ p }: { p: Pergunta }) {
  const qc = useQueryClient();
  const respondida = p.status !== 'UNANSWERED';
  const [texto, setTexto] = useState('');
  const [sugerindo, setSugerindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function sugerir() {
    setSugerindo(true);
    try {
      const r = await sugerirResposta(p.texto, p.item_titulo);
      setTexto(r.sugestao);
    } catch (e) {
      toast.error(`Falha ao sugerir: ${(e as Error).message}`);
    } finally { setSugerindo(false); }
  }

  async function responder() {
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    try {
      await responderPergunta(p.question_id, t);
      toast.success('Resposta enviada.');
      await qc.invalidateQueries({ queryKey: ['perguntas'] });
      await qc.invalidateQueries({ queryKey: ['perguntasNaoRespondidas'] });
    } catch (e) {
      toast.error(`Falha ao responder: ${(e as Error).message}`);
    } finally { setEnviando(false); }
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4', !respondida && 'border-warning/40')}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{p.item_titulo ?? p.item_id ?? '—'}</span>
            <a href={URL_PERGUNTAS_ML} target="_blank" rel="noreferrer" aria-label="Abrir perguntas no Mercado Livre" className="text-info hover:underline"><ExternalLink className="h-3 w-3" /></a>
            <span title={p.comprador_nome ?? p.comprador_nick ?? undefined}>
              · {nomeCurtoComprador(p.comprador_nome) ?? (p.comprador_nick?.trim() || 'Comprador')}
            </span>
            <span>· {fmtDataCurta(p.criada_em)}</span>
          </div>
          <p className="text-sm font-medium">{p.texto}</p>
        </div>
        <StatusPill tone={respondida ? 'success' : 'warning'}>{respondida ? 'Respondida' : 'Pendente'}</StatusPill>
      </div>

      {respondida ? (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Sua resposta:</span> {p.resposta ?? '—'}
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escreva a resposta ou use a sugestão da IA…"
            rows={3}
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={sugerir} disabled={sugerindo}>
              <Sparkles className={cn('mr-1.5 h-4 w-4', sugerindo && 'animate-pulse')} />
              {sugerindo ? 'Gerando…' : 'Sugerir resposta (IA)'}
            </Button>
            <Button size="sm" onClick={responder} disabled={enviando || !texto.trim()}>
              <Send className="mr-1.5 h-4 w-4" />
              {enviando ? 'Enviando…' : 'Responder'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ABAS_STATUS: { valor: FiltroStatusPergunta; rotulo: string }[] = [
  { valor: 'pendentes', rotulo: 'Pendentes' },
  { valor: 'respondidas', rotulo: 'Respondidas' },
  { valor: 'todas', rotulo: 'Todas' },
];

export function AbaPerguntas() {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(20);
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatusPergunta>('pendentes');

  const { data, isFetching } = useQuery({
    queryKey: QK.perguntasPagina(pagina, tamanho, { status: statusFiltro }),
    queryFn: () => fetchPerguntasPagina(pagina, tamanho, { status: statusFiltro }),
    staleTime: 60_000,
    // Pergunta respondida direto no ML chega por webhook em segundos; sem polling a tela aberta
    // continuaria mostrando "Pendente" até o operador trocar de aba. Só roda com a aba em foco.
    refetchInterval: 60_000,
    // Mantém a página anterior enquanto a próxima carrega: sem isso a lista pisca em branco a
    // cada troca de aba/página.
    placeholderData: keepPreviousData,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const inicio = total === 0 ? 0 : (pagina - 1) * tamanho + 1;

  function mudarAba(v: string) {
    setStatusFiltro(v as FiltroStatusPergunta);
    setPagina(1);
  }

  // Exportar sempre lê a lista inteira, filtrada pela aba ativa — não só a página visível
  // (a tela mostra 20 por vez, o relatório é "os dados desta aba", não "esta tela").
  async function montarReport() {
    const todas = await buscarPerguntas();
    return buildPerguntasReport(todas.filter((p) => pergCasaStatus(p.status, statusFiltro)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={statusFiltro} onValueChange={mudarAba}>
          <TabsList>
            {ABAS_STATUS.map((a) => (
              <TabsTrigger key={a.valor} value={a.valor}>{a.rotulo}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {total > 0 && <BotaoExportar montarReport={montarReport} />}
      </div>

      {isFetching && itens.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          <MessageCircleQuestion className="h-6 w-6" />
          {statusFiltro === 'todas'
            ? 'Nenhuma pergunta. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.'
            : statusFiltro === 'pendentes' ? 'Nenhuma pergunta pendente.' : 'Nenhuma pergunta respondida.'}
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((p) => <CardPergunta key={p.id} p={p} />)}
        </div>
      )}

      {total > 0 && (
        <Pagination
          paginaAtual={pagina}
          totalPaginas={Math.max(1, Math.ceil(total / tamanho))}
          inicio={inicio}
          fim={inicio === 0 ? 0 : inicio + itens.length - 1}
          total={total}
          tamanho={tamanho}
          onIrPara={setPagina}
          onTamanho={(n) => { setTamanho(n); setPagina(1); }}
          rotuloItem="pergunta"
        />
      )}
    </div>
  );
}
