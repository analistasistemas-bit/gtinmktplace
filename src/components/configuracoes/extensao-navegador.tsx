import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { enviarSessaoParaExtensao, type ResultadoPonte } from '@/lib/extensao-ponte';
import { useAuthStore } from '@/stores/auth-store';
import { SettingsGroup, SettingsRow } from './settings-row';

/** Seção "Extensão do navegador" (ADR-0189 D-4) — só aparece com o módulo `extensao`. */
export function ExtensaoNavegador() {
  const session = useAuthStore((s) => s.session);
  const id = import.meta.env.VITE_EXTENSAO_ID as string | undefined;
  const url = import.meta.env.VITE_EXTENSAO_URL as string | undefined;
  const [status, setStatus] = useState<ResultadoPonte | null>(null);
  const [enviando, setEnviando] = useState(false);

  const conectar = useCallback(async () => {
    setEnviando(true);
    setStatus(await enviarSessaoParaExtensao(session));
    setEnviando(false);
  }, [session]);

  // Ao abrir a seção, testa a conexão empurrando a sessão atual (idempotente na extensão).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem; o auth-store já reenvia a cada renovação
  useEffect(() => { if (id) void conectar(); }, [id]);

  if (!id && !url) {
    return (
      <SettingsGroup titulo="Extensão PubliAI para Chrome">
        <p className="px-4 py-3.5 text-sm text-muted-foreground">A extensão ainda não está disponível para instalação.</p>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup
      titulo="Extensão PubliAI para Chrome"
      descricao="Mostra a sua margem nas páginas do Mercado Livre. Conecta com a sua sessão do PubliAI — sem senha na extensão."
    >
      {/* Respondeu à conexão = está instalada neste Chrome: sem botão de instalar. */}
      {url && status === 'ok' && (
        <SettingsRow titulo="Instalação" descricao="Instalada neste Chrome." estado={<StatusPill tone="success">Instalada</StatusPill>}>
          {null}
        </SettingsRow>
      )}
      {url && status !== 'ok' && (
        <SettingsRow titulo="Instalação" descricao="Instale pela Chrome Web Store e volte aqui para conectar.">
          <Button asChild variant="outline" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">Instalar extensão</a>
          </Button>
        </SettingsRow>
      )}
      {id && (
        <SettingsRow
          titulo="Conexão"
          descricao="A conexão se renova sozinha enquanto o PubliAI estiver aberto. Só reconecte se a extensão pedir."
          estado={status && (
            <StatusPill tone={status === 'ok' ? 'success' : 'neutral'}>
              {status === 'ok' ? 'Conectada' : 'Não instalada'}
            </StatusPill>
          )}
        >
          {status === 'ok'
            ? <Button size="sm" variant="outline" disabled={enviando} onClick={() => void conectar()}>Reconectar</Button>
            : <Button size="sm" disabled={enviando} onClick={() => void conectar()}>Conectar extensão</Button>}
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
