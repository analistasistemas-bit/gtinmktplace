import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, MessagesSquare, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListaMensagens } from '@/hooks/useMensagens';
import { responderMensagem, sugerirRespostaMensagem, type Conversa } from '@/lib/mensagens';
import { fmtDataCurta, urlAnuncioML } from '@/lib/ml-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { toast } from 'sonner';

function CardConversa({ c }: { c: Conversa }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [sugerindo, setSugerindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const ultimaRecebida = [...c.mensagens].reverse().find((m) => m.direcao === 'recebida');
  const cancelada = c.order_status === 'cancelled';
  const cliente = c.comprador_nome?.trim() || c.comprador_nick?.trim() || 'Comprador';

  async function sugerir() {
    if (!ultimaRecebida) return;
    setSugerindo(true);
    try {
      const r = await sugerirRespostaMensagem(ultimaRecebida.texto, c.item_titulo);
      setTexto(r.sugestao.slice(0, 350));
    } catch (e) {
      toast.error(`Falha ao sugerir: ${(e as Error).message}`);
    } finally { setSugerindo(false); }
  }

  async function responder() {
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    try {
      await responderMensagem(c.pack_id, t);
      toast.success('Mensagem enviada.');
      setTexto('');
      await qc.invalidateQueries({ queryKey: ['mensagens'] });
      await qc.invalidateQueries({ queryKey: ['mensagensAguardando'] });
    } catch (e) {
      toast.error(`Falha ao enviar: ${(e as Error).message}`);
    } finally { setEnviando(false); }
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4', c.aguardando && 'border-warning/40')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <span className="truncate">{c.item_titulo ?? (c.order_id ? `Pedido ${c.order_id}` : c.pack_id)}</span>
            {c.item_id && (
              <a
                href={urlAnuncioML(c.item_id)}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir anúncio no Mercado Livre"
                className="ml-1 inline-block text-info hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <span> · {fmtDataCurta(c.ultima)}</span>
          </div>
        </div>
        {cancelada ? <StatusPill tone="danger">Pedido cancelado</StatusPill> : c.aguardando && <StatusPill tone="warning">Aguardando resposta</StatusPill>}
      </div>

      <div className="mb-3 space-y-2">
        {c.mensagens.map((m) => (
          <div key={m.id} className={cn('flex', m.direcao === 'enviada' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[80%] rounded-lg px-3 py-2 text-sm',
              m.direcao === 'enviada' ? 'bg-primary/10 text-foreground' : 'bg-muted/50 text-foreground',
            )}>
              <p className="whitespace-pre-wrap">{m.texto}</p>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {m.direcao === 'enviada' ? 'Você' : cliente} · {fmtDataCurta(m.data_ml)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva ao comprador ou use a sugestão da IA…"
          rows={2}
          maxLength={350}
          disabled={cancelada}
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={sugerir} disabled={cancelada || sugerindo || !ultimaRecebida}>
            <Sparkles className={cn('mr-1.5 h-4 w-4', sugerindo && 'animate-pulse')} />
            {sugerindo ? 'Gerando…' : 'Sugerir resposta (IA)'}
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{texto.length}/350</span>
            <Button size="sm" onClick={responder} disabled={cancelada || enviando || !texto.trim()}>
              <Send className="mr-1.5 h-4 w-4" />
              {enviando ? 'Enviando…' : 'Responder'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type FiltroStatusMensagem = 'aguardando' | 'todas';

const ABAS_STATUS: { valor: FiltroStatusMensagem; rotulo: string }[] = [
  { valor: 'aguardando', rotulo: 'Aguardando' },
  { valor: 'todas', rotulo: 'Todas' },
];

export function AbaMensagens() {
  const { data: conversas, isFetching } = useListaMensagens();
  const lista = conversas ?? [];

  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(20);
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatusMensagem>('aguardando');

  if (!isFetching && lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-6 w-6" />
        Nenhuma mensagem pós-venda. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.
      </div>
    );
  }

  // Paginado no cliente: conversa é um agrupamento por pack_id feito aqui, não uma linha de
  // tabela — paginar isso no banco exigiria uma view/RPC nova (fora de escopo, ver spec D-2).
  const filtradas = statusFiltro === 'aguardando' ? lista.filter((c) => c.aguardando) : lista;
  const total = filtradas.length;
  const inicio = total === 0 ? 0 : (pagina - 1) * tamanho + 1;
  const offset = (pagina - 1) * tamanho;
  const itens = filtradas.slice(offset, offset + tamanho);

  function mudarAba(v: string) {
    setStatusFiltro(v as FiltroStatusMensagem);
    setPagina(1);
  }

  return (
    <div className="space-y-3">
      <Tabs value={statusFiltro} onValueChange={mudarAba}>
        <TabsList>
          {ABAS_STATUS.map((a) => (
            <TabsTrigger key={a.valor} value={a.valor}>{a.rotulo}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isFetching && lista.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          <MessagesSquare className="h-6 w-6" />
          {statusFiltro === 'aguardando' ? 'Nenhuma conversa aguardando resposta.' : 'Nenhuma conversa nesta página.'}
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((c) => <CardConversa key={c.pack_id} c={c} />)}
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
          rotuloItem="conversa"
        />
      )}
    </div>
  );
}
