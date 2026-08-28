import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Primitivos da tela de Configurações. Moram aqui, e não em components/ui/, porque hoje têm
// um consumidor só — promover para o design system (e para o StyleGuide) quando aparecer o
// segundo uso de verdade.

export function SettingsGroup({ titulo, descricao, aviso, children, className }: {
  titulo?: string; descricao?: string; aviso?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      {(titulo || descricao || aviso) && (
        <div className="border-b bg-muted/30 px-4 py-3">
          {titulo && <h3 className="text-sm font-semibold">{titulo}</h3>}
          {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
          {aviso}
        </div>
      )}
      <div className="divide-y">{children}</div>
    </Card>
  );
}

/**
 * Uma opção de configuração: rótulo e descrição à esquerda, controle à direita.
 * Abaixo de `sm:` colapsa para uma coluna — o controle vai para baixo do texto.
 */
export function SettingsRow({ titulo, descricao, htmlFor, children, estado, erro, className }: {
  titulo: string;
  descricao?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  estado?: ReactNode;
  erro?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('grid min-h-11 gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6', className)}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium leading-snug">{titulo}</label>
        {descricao && <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{descricao}</p>}
        {erro && (
          <p id={htmlFor ? `${htmlFor}-erro` : undefined} className="mt-1.5 text-xs text-destructive">
            {erro}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-2 sm:justify-end sm:pt-0.5">
        {children}
        {estado}
      </div>
    </div>
  );
}

/**
 * Indicador de salvamento de UMA linha. `aria-live` porque não existe botão Salvar:
 * sem isso o leitor de tela nunca fica sabendo que gravou.
 */
export function EstadoSalvo({ estado }: { estado?: EstadoCampo }) {
  return (
    <span role="status" aria-live="polite" className="min-w-14 pt-1.5 text-xs">
      {estado === 'salvando' && <span className="text-muted-foreground">Salvando…</span>}
      {estado === 'salvo' && <span className="text-success">✓ Salvo</span>}
      {estado === 'erro' && <span className="text-destructive">Não salvou</span>}
    </span>
  );
}

export function LinhasCarregando({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Estado de uma linha cujo controle tem mutation própria (nenhum campo divide a mutation). */
export function estadoDeMutation(m: { isPending: boolean; isError: boolean; isSuccess: boolean }): EstadoCampo | undefined {
  if (m.isPending) return 'salvando';
  if (m.isError) return 'erro';
  if (m.isSuccess) return 'salvo';
  return undefined;
}

/** Cabeçalho de bloco que o perfil atual não pode editar. */
export function AvisoLeitura({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

export type EstadoCampo = 'salvando' | 'salvo' | 'erro';

/**
 * Fila de gravação single-flight por tabela, com estado por campo.
 *
 * Três problemas concretos que isto resolve, e por que a solução óbvia não serve:
 *
 * 1. As mutations são COMPARTILHADAS por vários campos (`useSalvarAliquotas`,
 *    `useSalvarEmpresaFiscal`). Um `isSuccess` de mutation acende o "✓ Salvo" de todas as
 *    linhas, e `mutation.variables` não desempata — `upsertAliquotas` manda as quatro chaves
 *    em toda chamada. Daí o mapa por campo.
 * 2. Dois blurs no mesmo campo: sem o número de sequência, o `finally` do primeiro
 *    sobrescreveria o resultado do segundo.
 * 3. `upsertAliquotas` grava o snapshot inteiro. Duas gravações fora de ordem fariam a mais
 *    velha vencer no banco. Como só há uma chamada em voo por fila, isso deixa de ser
 *    possível — e o payload é montado na hora da execução, a partir do snapshot já atualizado.
 *
 * O snapshot NÃO vem do cache do react-query: `invalidateQueries` não é síncrono, então
 * remontar o patch de lá reenviaria valores velhos. Ele é semeado uma vez, do primeiro
 * resultado carregado, e a seção não aceita edição antes disso (`pronto`) — snapshot parcial
 * apagaria `ufEmpresa`/`internaPct` que o operador nunca tocou.
 */
export function useFilaDeSalvamento<T extends object>(carregado: T | undefined | null) {
  const [estados, setEstados] = useState<Record<string, EstadoCampo>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const snapshot = useRef<T | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef<Record<string, number>>({});
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (snapshot.current === null && carregado != null) {
      snapshot.current = { ...carregado };
      setPronto(true);
    }
  }, [carregado]);

  const salvar = (campo: string, patch: Partial<T>, executar: (snapshot: T) => Promise<unknown>) => {
    if (snapshot.current === null) return;
    Object.assign(snapshot.current, patch);

    const n = (seq.current[campo] ?? 0) + 1;
    seq.current[campo] = n;
    const atual = () => seq.current[campo] === n;

    setEstados((e) => ({ ...e, [campo]: 'salvando' }));
    setErros(({ [campo]: _descartado, ...resto }) => resto);

    fila.current = fila.current
      // Uma falha não pode descartar o que já está enfileirado atrás dela.
      .catch(() => undefined)
      .then(() => executar({ ...(snapshot.current as T) }))
      .then(
        () => { if (atual()) setEstados((e) => ({ ...e, [campo]: 'salvo' })); },
        (err: unknown) => {
          if (!atual()) return;
          setEstados((e) => ({ ...e, [campo]: 'erro' }));
          setErros((e) => ({ ...e, [campo]: err instanceof Error ? err.message : String(err) }));
        },
      );
  };

  return { estados, erros, salvar, pronto };
}
