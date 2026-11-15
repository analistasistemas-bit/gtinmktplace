import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePwaStore } from '@/stores/pwa-store';
import { jaAvisouHoje, marcarAvisadoHoje } from '@/lib/aviso-versao-dia';
import { cn } from '@/lib/utils';

// Selo de versão nova na Topbar (ADR-0153 D4, emenda 2026-11-15). Só aparece com o service
// worker novo esperando. O aviso aberto sai do selo na 1ª vez do dia; depois, só o selo.
// Halo: 3 pulsos quando a versão chega (sinalVersao), 1 pulso ao voltar para a aba. Nada contínuo.
export function AtualizacaoDisponivel({ className }: { className?: string }) {
  const needRefresh = usePwaStore((state) => state.needRefresh);
  const sinalVersao = usePwaStore((state) => state.sinalVersao);
  const updateSW = usePwaStore((state) => state.updateSW);
  const [aberto, setAberto] = useState(false);
  const [pulso, setPulso] = useState({ chave: 0, vezes: 3 });
  // Aberto sozinho não pega o foco (nem ao abrir, nem ao fechar); aberto pelo selo, pega.
  const abertoSozinho = useRef(false);
  const tituloId = useId();

  const abrirSeAindaNaoAvisouHoje = useCallback(() => {
    if (jaAvisouHoje()) return;
    marcarAvisadoHoje();
    abertoSozinho.current = true;
    setAberto(true);
  }, []);

  useEffect(() => {
    if (!needRefresh) return;
    setPulso((p) => ({ chave: p.chave + 1, vezes: 3 }));
    abrirSeAindaNaoAvisouHoje();
  }, [needRefresh, sinalVersao, abrirSeAindaNaoAvisouHoje]);

  useEffect(() => {
    if (!needRefresh) return;
    // Voltar para a aba: 1 pulso, e abre o aviso se o dia virou com o app aberto.
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      setPulso((p) => ({ chave: p.chave + 1, vezes: 1 }));
      abrirSeAindaNaoAvisouHoje();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [needRefresh, abrirSeAindaNaoAvisouHoje]);

  // Live region montada antes do texto, senão o leitor de tela não anuncia.
  const anuncio = (
    <span role="status" aria-live="polite" className="sr-only">
      {needRefresh ? 'Nova versão do PubliAI disponível.' : ''}
    </span>
  );
  if (!needRefresh) return anuncio;

  return (
    <>
      {anuncio}
      <Popover
        open={aberto}
        onOpenChange={(abrir) => {
          if (abrir) abertoSozinho.current = false;
          setAberto(abrir);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-xs font-medium text-primary transition-colors',
              'bg-[image:var(--brand-gradient-soft)] ring-1 ring-primary/20 hover:ring-primary/40',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          >
            <span className="relative flex size-2" aria-hidden="true">
              <span
                key={pulso.chave}
                className="halo-versao absolute inset-0 rounded-full bg-primary"
                style={{ animationIterationCount: pulso.vezes }}
              />
              <span className="relative size-2 rounded-full bg-primary" />
            </span>
            <span className="hidden sm:inline">Nova versão</span>
            <span className="sr-only sm:hidden">Nova versão</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 p-4 shadow-brand"
          aria-labelledby={tituloId}
          onOpenAutoFocus={(e) => abertoSozinho.current && e.preventDefault()}
          onCloseAutoFocus={(e) => abertoSozinho.current && e.preventDefault()}
        >
          <div className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[image:var(--brand-gradient-soft)] text-primary">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p id={tituloId} className="text-sm font-semibold">Nova versão do PubliAI pronta</p>
              <p className="text-sm text-muted-foreground">Leva poucos segundos e recarrega esta tela.</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Agora não
            </Button>
            <Button size="sm" onClick={() => void updateSW?.(true)}>
              Atualizar agora
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
