import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, MessagesSquare, ExternalLink, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListaMensagens, useResumoMensagens } from '@/hooks/useMensagens';
import {
  responderMensagem, sugerirRespostaMensagem, dispensarConversa, ehPedidoCancelado, marcarMensagensLidasML, type Conversa,
} from '@/lib/mensagens';
import { baldeDaConversa, rotuloVenda, type Balde, type ResumoMensagens } from '@/lib/mensagens-resumo';
import { tempoRelativo } from '@/lib/sonar-buscas-recentes';
import { urlVendaML } from '@/lib/ml-status';
import { linhasDoChat, nomeComprador } from '@/lib/mensagens-chat';
import { formatarNomeProduto } from '@/lib/texto';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { toast } from 'sonner';

const fmtHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

/** Até 2 iniciais do nome (só letras), para o avatar. */
const iniciais = (nome: string) =>
  nome.split(' ').filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

function CardConversa({ c, marcados, aberto, onAberto }: {
  c: Conversa; marcados: Map<string, string>; aberto: boolean; onAberto: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [sugerindo, setSugerindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [canceladaLocal, setCanceladaLocal] = useState(false);
  const [dispensando, setDispensando] = useState(false);
  const marcandoRef = useRef(false);

  const ultimaMsg = c.mensagens[c.mensagens.length - 1];
  const ultimaRecebida = [...c.mensagens].reverse().find((m) => m.direcao === 'recebida');
  const cancelada = c.order_status === 'cancelled' || canceladaLocal;
  const cliente = nomeComprador(c.comprador_nome, c.comprador_nick);
  const enviandoRef = useRef(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const alturaAnterior = useRef<number | null>(null);
  // Abre no fim da conversa e acompanha mensagem nova, como no WhatsApp, mas só se a pessoa já
  // estava no fim: quem rolou para ler o histórico não é puxado de volta.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) { alturaAnterior.current = null; return; } // recolhido: ao abrir, volta ao fim
    const antes = alturaAnterior.current;
    if (antes == null || el.scrollTop + el.clientHeight >= antes - 48) el.scrollTop = el.scrollHeight;
    alturaAnterior.current = el.scrollHeight;
  }, [c.mensagens.length, aberto]);

  async function alternar() {
    const abrindo = !aberto;
    onAberto(abrindo);
    if (!abrindo) return;
    // Só chama o ML quando há recebida não lida lá E o conjunto difere do último marcado COM SUCESSO
    // neste pack (mapa no AbaMensagens: sobrevive a paginar/filtrar, que desmontam o card).
    const chave = [...c.idsNaoLidosML].sort().join(',');
    if (!chave || chave === marcados.get(c.pack_id) || marcandoRef.current) return;
    marcandoRef.current = true;
    try {
      await marcarMensagensLidasML(c.pack_id);
      marcados.set(c.pack_id, chave);
      await qc.invalidateQueries({ queryKey: ['mensagens'] });
    } catch (e) {
      toast.error(`Não foi possível marcar como lida no Mercado Livre: ${(e as Error).message}`);
    } finally { marcandoRef.current = false; }
  }
  // Pelo pack: a rota aceita os dois ids e o pack abre o pacote inteiro. Em pedido solo o sync já
  // grava o próprio order_id como pack_id, então esta linha cobre os dois casos.
  const urlConversa = urlVendaML(c.pack_id);

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
    if (!t || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      await responderMensagem(c.pack_id, t);
      toast.success('Mensagem enviada.');
      setTexto('');
      await qc.invalidateQueries({ queryKey: ['mensagens'] });
      await qc.invalidateQueries({ queryKey: ['mensagensAguardando'] });
    } catch (e) {
      if (ehPedidoCancelado(e)) {
        setCanceladaLocal(true);
        toast.info('Este pedido foi cancelado no Mercado Livre. Mensagens desativadas.');
        await qc.invalidateQueries({ queryKey: ['mensagens'] });
        await qc.invalidateQueries({ queryKey: ['mensagensAguardando'] });
      } else {
        toast.error(`Falha ao enviar: ${(e as Error).message}`);
      }
    } finally { enviandoRef.current = false; setEnviando(false); }
  }

  async function dispensar() {
    setDispensando(true);
    try {
      // 0 linhas = nada recebido e não lido nesse pack (já dispensado/respondido por outro membro da
      // org). Sem isso o toast diria "dispensada" para um no-op.
      const n = await dispensarConversa(c.pack_id);
      if (n === 0) toast.info('Nenhuma mensagem para dispensar nesta conversa.');
      else toast.success('Conversa dispensada.');
      onAberto(false); // solta a conversa fixada: sai do filtro como antes
      await qc.invalidateQueries({ queryKey: ['mensagens'] });
      await qc.invalidateQueries({ queryKey: ['mensagensAguardando'] });
    } catch (e) {
      toast.error(`Falha ao dispensar: ${(e as Error).message}`);
    } finally { setDispensando(false); }
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', c.aguardando && 'border-warning/40')}>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5', aberto && 'border-b')}>
        <div aria-hidden className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {iniciais(cliente)}
          {c.idsNaoLidosML.length > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-info ring-2 ring-card" />}
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate text-xs text-muted-foreground">
            {rotuloVenda(c.shipping_status)}
            {ultimaMsg?.data_ml && ` · ${ultimaMsg.direcao === 'recebida' ? 'Mensagem recebida' : 'Mensagem enviada'} ${tempoRelativo(ultimaMsg.data_ml, new Date())}`}
            {c.idsNaoLidosML.length > 0 && <span className="sr-only"> (não lida)</span>}
          </div>
          <div className={cn('truncate text-sm', c.idsNaoLidosML.length > 0 ? 'font-semibold' : 'font-medium')}>{cliente}</div>
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{formatarNomeProduto(c.item_titulo) || `Pedido ${c.pack_id}`}</span>
            <a
              href={urlConversa}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir conversa no Mercado Livre"
              title="Abrir a conversa na página da venda no Mercado Livre"
              className="shrink-0 text-info hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          {c.aguardando && !cancelada && (
            <Button
              variant="ghost"
              size="sm"
              onClick={dispensar}
              disabled={dispensando}
              title="Tira a conversa de Aguardando; volta se o comprador escrever de novo."
            >
              <Check className="mr-1.5 h-4 w-4" />
              {dispensando ? 'Dispensando…' : 'Dispensar'}
            </Button>
          )}
          {cancelada ? <StatusPill tone="danger">Pedido cancelado</StatusPill> : c.aguardando && <StatusPill tone="warning">Aguardando resposta</StatusPill>}
          <Button variant={aberto ? 'ghost' : 'outline'} size="sm" onClick={alternar} aria-expanded={aberto}>
            {aberto ? 'Recolher' : 'Conferir mensagem'}
          </Button>
        </div>
      </div>

      {aberto && <>
      <div ref={rolagem} role="log" aria-label={`Conversa com ${cliente}`} className="wa-fundo max-h-[28rem] overflow-y-auto px-4 py-3 sm:px-[6%]">
        {linhasDoChat(c.mensagens).map((l) => l.tipo === 'dia' ? (
          <div key={`dia-${l.chave}`} className="my-3 flex justify-center first:mt-0">
            <span className="rounded-md bg-wa-recebida px-3 py-1 text-xs text-wa-meta shadow-sm">{l.rotulo}</span>
          </div>
        ) : (
          <div key={l.m.id} className={cn('flex', l.m.direcao === 'enviada' ? 'justify-end' : 'justify-start', l.cauda ? 'mt-2' : 'mt-0.5')}>
            <div className={cn(
              'relative max-w-[85%] rounded-lg px-2.5 pb-1.5 pt-1.5 text-sm text-wa-texto shadow-sm sm:max-w-[65%]',
              l.m.direcao === 'enviada' ? 'bg-wa-enviada' : 'bg-wa-recebida',
              l.cauda && (l.m.direcao === 'enviada' ? 'wa-cauda-enviada rounded-tr-none' : 'wa-cauda-recebida rounded-tl-none'),
            )}>
              <p className="whitespace-pre-wrap break-words">
                <span className="sr-only">{l.m.direcao === 'enviada' ? 'Você:' : `${cliente}:`} </span>
                {l.m.texto.trimEnd()}
                <span
                  className={cn('relative top-1.5 float-right ml-3 text-[11px] leading-none tabular-nums', l.m.direcao === 'enviada' ? 'text-wa-meta-enviada' : 'text-wa-meta')}
                  title={l.m.data_ml ? new Date(l.m.data_ml).toLocaleString('pt-BR') : undefined}
                >
                  {fmtHora(l.m.data_ml)}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 border-t px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full"
          onClick={sugerir}
          disabled={cancelada || sugerindo || !ultimaRecebida}
          aria-label="Sugerir resposta (IA)"
          title="Sugerir resposta (IA)"
        >
          <Sparkles className={cn('h-5 w-5', sugerindo && 'animate-pulse')} />
        </Button>
        <div className="relative min-w-0 flex-1">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia, Shift+Enter quebra linha, como no WhatsApp.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void responder(); }
            }}
            placeholder={sugerindo ? 'Gerando sugestão…' : 'Escreva ao comprador…'}
            aria-label="Mensagem ao comprador"
            rows={1}
            maxLength={350}
            disabled={cancelada}
            className={cn('max-h-32 min-h-10 resize-none rounded-3xl border-0 bg-muted px-4 py-2.5 dark:bg-muted', texto.length > 0 && 'pr-16')}
          />
          {texto.length > 0 && (
            <span className="pointer-events-none absolute bottom-2.5 right-4 text-[10px] tabular-nums text-muted-foreground">{texto.length}/350</span>
          )}
        </div>
        <Button
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full bg-wa-envio text-white hover:bg-wa-envio/90"
          onClick={responder}
          disabled={cancelada || enviando || !texto.trim()}
          aria-label="Responder"
          title={enviando ? 'Enviando…' : 'Responder (Enter)'}
        >
          <Send className={cn('h-4 w-4', enviando && 'animate-pulse')} />
        </Button>
      </div>
      </>}
    </div>
  );
}

type FiltroStatusMensagem = 'aguardando' | 'todas';

const ABAS_STATUS: { valor: FiltroStatusMensagem; rotulo: string }[] = [
  { valor: 'aguardando', rotulo: 'Aguardando' },
  { valor: 'todas', rotulo: 'Todas' },
];

function CardsResumo({ resumo, erro, ativo, onEscolher }: {
  resumo: ResumoMensagens | undefined; erro: boolean; ativo: Balde | null; onEscolher: (b: Balde | null) => void;
}) {
  const n = (v: number | undefined) => v ?? '—'; // carregando ou erro sem dado anterior
  const grupos: { titulo: string; total: number | null | undefined; itens: { balde: Balde; rotulo: string; n: number | undefined }[] }[] = [
    { titulo: 'Não lidas', total: resumo?.naoLidas.total, itens: [
      { balde: 'aPreparar', rotulo: 'A preparar', n: resumo?.naoLidas.aPreparar },
      { balde: 'aCaminho', rotulo: 'A caminho', n: resumo?.naoLidas.aCaminho },
      { balde: 'entregues', rotulo: 'Entregues', n: resumo?.naoLidas.entregues },
    ] },
    { titulo: 'Lidas', total: null, itens: [
      { balde: 'semResponder', rotulo: 'Sem responder', n: resumo?.lidas.semResponder },
      { balde: 'respondidas', rotulo: 'Respondidas', n: resumo?.lidas.respondidas },
    ] },
  ];
  return (
    <div className="space-y-2">
    {erro && (
      <p role="alert" className="text-xs text-destructive">
        {resumo ? 'Não foi possível atualizar os contadores; os números abaixo podem estar desatualizados.' : 'Não foi possível carregar os contadores.'}
      </p>
    )}
    <div className="grid gap-3 sm:grid-cols-2">
      {grupos.map((g) => (
        <section key={g.titulo} aria-label={g.titulo} className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-sm font-medium">{g.titulo}{g.total !== null && <span className="ml-1.5 text-muted-foreground tabular-nums">{n(g.total)}</span>}</h3>
          <div className="flex flex-wrap gap-2">
            {g.itens.map((i) => (
              <button
                key={i.balde}
                type="button"
                aria-pressed={ativo === i.balde}
                onClick={() => onEscolher(ativo === i.balde ? null : i.balde)}
                className={cn(
                  'flex items-baseline gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted',
                  ativo === i.balde && 'border-primary bg-muted',
                )}
              >
                <span className="font-semibold tabular-nums">{n(i.n)}</span>
                <span className="text-muted-foreground">{i.rotulo}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
    </div>
  );
}

export function AbaMensagens() {
  const { data: conversas, isFetching } = useListaMensagens();
  // Contadores só do banco (todas as mensagens): nunca a contagem do array limitado.
  const { data: resumo, isError: resumoErro } = useResumoMensagens();
  const lista = conversas ?? [];
  const marcados = useRef(new Map<string, string>());
  const [balde, setBalde] = useState<Balde | null>(null);
  // Conversas expandidas ficam fixadas na lista filtrada: marcar como lida (ou responder) reclassifica a
  // conversa no refetch, e ela sumiria enquanto a pessoa lê. Sai ao recolher ou ao trocar de filtro.
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const marcarAberto = (pack: string, v: boolean) => setAbertos((s) => {
    const n = new Set(s);
    if (v) n.add(pack); else n.delete(pack);
    return n;
  });

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
  // Card de resumo escolhido manda sobre a aba; sem ele vale a aba.
  const casa = (c: Conversa) => abertos.has(c.pack_id)
    || (balde ? baldeDaConversa(c) === balde : statusFiltro !== 'aguardando' || c.aguardando);
  const filtradas = lista.filter(casa);
  const total = filtradas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  // Responder a última conversa "aguardando" de uma página tira ela da lista filtrada e a
  // página pode deixar de existir — clampa contra o total (mesma lógica de aba-perguntas.tsx).
  const paginaEfetiva = Math.min(pagina, totalPaginas);
  const inicio = total === 0 ? 0 : (paginaEfetiva - 1) * tamanho + 1;
  const offset = (paginaEfetiva - 1) * tamanho;
  const itens = filtradas.slice(offset, offset + tamanho);

  function mudarAba(v: string) {
    setStatusFiltro(v as FiltroStatusMensagem);
    setBalde(null);
    setAbertos(new Set());
    setPagina(1);
  }

  function escolherBalde(b: Balde | null) {
    setBalde(b);
    setAbertos(new Set());
    setPagina(1);
  }

  return (
    <div className="space-y-3">
      <CardsResumo resumo={resumo} erro={resumoErro} ativo={balde} onEscolher={escolherBalde} />
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
          {balde ? 'Nenhuma conversa carregada neste filtro.' : statusFiltro === 'aguardando' ? 'Nenhuma conversa aguardando resposta.' : 'Nenhuma conversa nesta página.'}
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((c) => <CardConversa key={c.pack_id} c={c} marcados={marcados.current} aberto={abertos.has(c.pack_id)} onAberto={(v) => marcarAberto(c.pack_id, v)} />)}
        </div>
      )}

      {total > 0 && (
        <Pagination
          paginaAtual={paginaEfetiva}
          totalPaginas={totalPaginas}
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
