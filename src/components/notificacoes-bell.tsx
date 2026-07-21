import { Bell, ExternalLink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useListaNotificacoes, useMarcarNotificacoesLidas, useNotificacoesNaoLidas } from '@/hooks/useNotificacoes';
import { CATEGORIA_LABEL } from '@/lib/notificacoes-categorias';

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const IS_URL = /^https?:\/\//;

/** Quebra o texto da notificação em partes, trocando URLs cruas (o texto já vem pronto do
 * Telegram — ver montarMensagem* em _shared/notificacoes/telegram.ts) por um link compacto —
 * mesmo padrão "Ver no Mercado Livre ↗" já usado em detalhe-pedido-itens.tsx/aba-devolucoes.tsx.
 * Evita que a URL, sem espaços para quebrar linha, estoure a largura do card. */
function linkify(texto: string) {
  return texto.split(URL_PATTERN).map((parte, i) =>
    IS_URL.test(parte) ? (
      <a
        key={i}
        href={parte}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-info hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        Ver no Mercado Livre <ExternalLink className="h-3 w-3" />
      </a>
    ) : (
      <span key={i}>{parte}</span>
    ),
  );
}

function formatarQuando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Sino de notificações in-app (ADR-0085) — espelha os mesmos alertas do Telegram. Abrir o
 * dropdown marca todas como lidas (mesma simplicidade do resto do menu: sem estado por item). */
export function NotificacoesBell() {
  const naoLidas = useNotificacoesNaoLidas();
  const { data: notificacoes } = useListaNotificacoes();
  const marcarLidas = useMarcarNotificacoesLidas();

  return (
    <DropdownMenu onOpenChange={(open) => { if (open && naoLidas > 0) void marcarLidas(); }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={naoLidas > 0 ? `Notificações (${naoLidas} não lidas)` : 'Notificações'}
        >
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {naoLidas > 9 ? '9+' : naoLidas}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notificações</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(!notificacoes || notificacoes.length === 0) ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">Nenhuma notificação</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notificacoes.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="w-full flex-col items-start gap-0.5 whitespace-normal py-2"
                onSelect={(e) => e.preventDefault()}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORIA_LABEL[n.categoria] ?? n.categoria}
                </span>
                <span className="w-full min-w-0 break-words text-sm leading-snug">{linkify(n.texto)}</span>
                <span className="text-[10px] text-muted-foreground">{formatarQuando(n.criada_em)}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
