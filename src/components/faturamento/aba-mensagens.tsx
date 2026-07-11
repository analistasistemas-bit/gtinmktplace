import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListaMensagens } from '@/hooks/useMensagens';
import { responderMensagem, sugerirRespostaMensagem, marcarConversaLida, type Conversa } from '@/lib/mensagens';
import { fmtDataCurta } from '@/lib/ml-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from 'sonner';

function CardConversa({ c }: { c: Conversa }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [sugerindo, setSugerindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const ultimaRecebida = [...c.mensagens].reverse().find((m) => m.direcao === 'recebida');

  function marcarLida() {
    if (c.naoLidas === 0) return;
    marcarConversaLida(c.pack_id)
      .then(() => qc.invalidateQueries({ queryKey: ['mensagensNaoLidas'] }))
      .catch(() => { /* silencioso: marcar lida não é crítico */ });
  }

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
      await qc.invalidateQueries({ queryKey: ['mensagensNaoLidas'] });
    } catch (e) {
      toast.error(`Falha ao enviar: ${(e as Error).message}`);
    } finally { setEnviando(false); }
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4', c.naoLidas > 0 && 'border-warning/40')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <span className="truncate">{c.item_titulo ?? (c.order_id ? `Pedido ${c.order_id}` : c.pack_id)}</span>
            <span> · {fmtDataCurta(c.ultima)}</span>
          </div>
        </div>
        {c.naoLidas > 0 && <StatusPill tone="warning">{c.naoLidas} não lida{c.naoLidas > 1 ? 's' : ''}</StatusPill>}
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
                {m.direcao === 'enviada' ? 'Você' : 'Comprador'} · {fmtDataCurta(m.data_ml)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={marcarLida}
          placeholder="Escreva ao comprador ou use a sugestão da IA…"
          rows={2}
          maxLength={350}
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={sugerir} disabled={sugerindo || !ultimaRecebida}>
            <Sparkles className={cn('mr-1.5 h-4 w-4', sugerindo && 'animate-pulse')} />
            {sugerindo ? 'Gerando…' : 'Sugerir resposta (IA)'}
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{texto.length}/350</span>
            <Button size="sm" onClick={responder} disabled={enviando || !texto.trim()}>
              <Send className="mr-1.5 h-4 w-4" />
              {enviando ? 'Enviando…' : 'Responder'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AbaMensagens() {
  const { data: conversas, isFetching } = useListaMensagens();
  const lista = conversas ?? [];

  if (!isFetching && lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-6 w-6" />
        Nenhuma mensagem pós-venda. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isFetching && lista.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>}
      {lista.map((c) => <CardConversa key={c.pack_id} c={c} />)}
    </div>
  );
}
