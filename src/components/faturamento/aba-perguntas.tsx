import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, MessageCircleQuestion, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListaPerguntas } from '@/hooks/usePerguntas';
import { responderPergunta, sugerirResposta, type Pergunta } from '@/lib/perguntas';
import { fmtDataCurta } from '@/lib/ml-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
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

  const urlItem = p.item_id ? `https://www.mercadolivre.com.br/anuncios/${p.item_id}` : null;

  return (
    <div className={cn('rounded-lg border bg-card p-4', !respondida && 'border-warning/40')}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{p.item_titulo ?? p.item_id ?? '—'}</span>
            {urlItem && <a href={urlItem} target="_blank" rel="noreferrer" className="text-info hover:underline"><ExternalLink className="h-3 w-3" /></a>}
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

export function AbaPerguntas() {
  const { data: perguntas, isFetching } = useListaPerguntas();
  const lista = perguntas ?? [];

  if (!isFetching && lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        <MessageCircleQuestion className="h-6 w-6" />
        Nenhuma pergunta. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lista.length > 0 && (
        <div className="flex justify-end">
          <BotaoExportar montarReport={() => buildPerguntasReport(lista)} />
        </div>
      )}
      {isFetching && lista.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>}
      {lista.map((p) => <CardPergunta key={p.id} p={p} />)}
    </div>
  );
}
