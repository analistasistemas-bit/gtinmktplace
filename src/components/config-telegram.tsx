import { useEffect, useState } from 'react';
import { ChevronRight, Send, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  useTelegramConfig, useSalvarTelegramConfig,
  useEnviarTesteTelegram, useVerificarModeradosAgora,
} from '@/hooks/useConfiguracoes';

export function ConfigTelegram() {
  const { data: cfg } = useTelegramConfig();
  const salvar = useSalvarTelegramConfig();
  const teste = useEnviarTesteTelegram();
  const verificar = useVerificarModeradosAgora();

  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    if (cfg) {
      setChatId(cfg.chatId);
      setAtivo(cfg.ativo);
    }
  }, [cfg]);

  // Salva o estado atual (token só vai quando o campo foi preenchido).
  const persistir = (patch: { chatId?: string; ativo?: boolean; botToken?: string }) => {
    salvar.mutate({
      chatId: patch.chatId ?? chatId,
      ativo: patch.ativo ?? ativo,
      botToken: patch.botToken,
    }, {
      onSuccess: () => { if (patch.botToken) setBotToken(''); },
      onError: (e) => toast.error('Falha ao salvar', { description: e instanceof Error ? e.message : String(e) }),
    });
  };

  const handleTeste = () =>
    teste.mutate(undefined, {
      onSuccess: (r) => r.ok
        ? toast.success('Mensagem de teste enviada — confira seu Telegram.')
        : toast.error('Não enviou', { description: r.erro }),
      onError: (e) => toast.error('Não enviou', { description: e instanceof Error ? e.message : String(e) }),
    });

  const handleVerificar = () =>
    verificar.mutate(undefined, {
      onSuccess: (r) => toast.success(
        r.novos ? `${r.novos} novo(s) moderado(s) detectado(s).` : 'Verificação concluída — nenhum novo moderado.',
      ),
      onError: (e) => toast.error('Falha ao verificar', { description: e instanceof Error ? e.message : String(e) }),
    });

  const tokenPlaceholder = cfg?.temToken ? '•••••••• (configurado — deixe vazio p/ manter)' : 'Cole o token do @BotFather';

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Alertas no Telegram</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{ativo ? 'Ativo' : 'Inativo'}</span>
          <Switch
            checked={ativo}
            onCheckedChange={(v) => { setAtivo(v); persistir({ ativo: v }); }}
            aria-label="Ativar alertas no Telegram"
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Receba um aviso no Telegram quando o Mercado Livre moderar um anúncio. A verificação roda
        automaticamente a cada 6h.
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Chat ID</label>
          <Input
            className="h-8 text-sm"
            value={chatId}
            placeholder="ex.: 123456789"
            onChange={(e) => setChatId(e.target.value)}
            onBlur={() => { if (chatId !== (cfg?.chatId ?? '')) persistir({ chatId }); }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Bot token</label>
          <Input
            type="password"
            className="h-8 text-sm"
            value={botToken}
            placeholder={tokenPlaceholder}
            onChange={(e) => setBotToken(e.target.value)}
            onBlur={() => { if (botToken.trim()) persistir({ botToken }); }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleTeste} disabled={teste.isPending}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {teste.isPending ? 'Enviando…' : 'Enviar teste'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleVerificar} disabled={verificar.isPending}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${verificar.isPending ? 'animate-spin' : ''}`} />
            {verificar.isPending ? 'Verificando…' : 'Verificar agora'}
          </Button>
          {salvar.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
          {salvar.isSuccess && !salvar.isPending && <span className="text-xs text-success">✓ Salvo</span>}
        </div>
      </div>

      <details className="group/details mt-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <summary className="-mx-1 flex cursor-pointer list-none items-center gap-1 px-1 text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/details:rotate-90" />
          Como obter o token e o chat ID
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>No Telegram, fale com <code>@BotFather</code> → <code>/newbot</code> → copie o token.</li>
          <li>Mande qualquer mensagem ao seu bot novo.</li>
          <li>Abra <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> e copie o <code>chat.id</code>.</li>
          <li>Cole aqui, ligue o alerta e clique em "Enviar teste".</li>
        </ol>
      </details>
    </Card>
  );
}
