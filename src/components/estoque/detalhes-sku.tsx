// Detalhes do SKU (spec 2026-09-19 "matriz"): segundo nível da matriz. É o bloco expandido que
// vivia em `linha-grade-form.tsx`, com uma troca deliberada — o cadeado virou um par de radios
// "Herdar do produto" / "Usar valor específico" (mockup do Diego). O estado de herança deixa de
// ser um ícone a decodificar.
//
// Sem estado próprio: a decisão de herdar é a PRESENÇA da chave em `linha.overrides`, exatamente
// como `resolverLinha` lê. Um `useState` de "destravado" aqui divergiria do dado na primeira
// aplicação em massa vinda de fora.
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import {
  CAMPOS_HERDAVEIS, type CampoHerdavel, type LinhaGrade, type LinhaResolvida,
} from '@/lib/cadastro-grade';
import { cn } from '@/lib/utils';

// Exportado daqui a partir da Task 5 (antes vivia em `linha-grade-form.tsx`, apagado nesta mesma
// task). Gera warning de `react-refresh/only-export-components`, aceito: o
// `allowConstantExport: true` (eslint.config.js:26-29) só isenta literal primitivo, e `ROTULOS`
// é um objeto — mesmo caso já documentado em `gerador-variacoes.tsx` para `CORES_POPULARES`.
export const ROTULOS: Record<CampoHerdavel, { rotulo: string; prefixo?: string; sufixo?: string }> = {
  // Rótulo idêntico ao de `linha-variacao-form.tsx` — é a ponte com a Revisão, que exibe este
  // mesmo valor como "mín. líquido".
  preco: { rotulo: 'Preço mínimo (líquido)', prefixo: 'R$' },
  custo: { rotulo: 'Custo', prefixo: 'R$' },
  pesoGramas: { rotulo: 'Peso', sufixo: 'g' },
  alturaCm: { rotulo: 'Altura', sufixo: 'cm' },
  larguraCm: { rotulo: 'Largura', sufixo: 'cm' },
  comprimentoCm: { rotulo: 'Comprimento', sufixo: 'cm' },
};

export function DetalhesSku({
  linha, resolvida, tentouSalvar, desabilitado,
  onFechar, onMudarOverride, onDestravar, onVoltarAHerdar,
}: {
  /** `null` = drawer fechado. A matriz guarda só o `clientId` aberto. */
  linha: LinhaGrade | null;
  resolvida: LinhaResolvida | null;
  tentouSalvar: boolean;
  desabilitado: boolean;
  onFechar: () => void;
  onMudarOverride: (campo: CampoHerdavel, valor: string) => void;
  /** Destravar semeia o override com o valor RESOLVIDO (decisão do dialog) — não viola "nunca
   *  copiar o herdado": um campo deliberadamente destravado parou de seguir o cabeçalho. */
  onDestravar: (campo: CampoHerdavel) => void;
  onVoltarAHerdar: (campo: CampoHerdavel) => void;
}) {
  if (!linha || !resolvida) return null;
  const nome = `${linha.cor} · ${linha.tamanho}`;
  const id = (campo: string) => `sku-${linha.clientId}-${campo}`;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{nome}</SheetTitle>
          <SheetDescription>
            Cada campo herda do produto por padrão. Marque &quot;Usar valor específico&quot; só no
            que for exceção deste SKU.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {CAMPOS_HERDAVEIS.map((campo) => {
            const { rotulo, prefixo, sufixo } = ROTULOS[campo];
            const especifico = campo in linha.overrides;
            const erro = erroCampo(campo, resolvida[campo]);
            return (
              <div key={campo} className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0">
                <label htmlFor={id(campo)} className="text-sm font-medium">{rotulo}</label>
                <RadioGroup
                  className="flex items-center gap-4"
                  value={especifico ? 'especifico' : 'herdado'}
                  disabled={desabilitado}
                  onValueChange={(v) => (v === 'especifico' ? onDestravar(campo) : onVoltarAHerdar(campo))}
                >
                  <span className="flex items-center gap-1.5 text-xs">
                    <RadioGroupItem
                      value="herdado"
                      id={`${id(campo)}-herdado`}
                      aria-label={`Herdar do produto — ${rotulo}`}
                      disabled={desabilitado}
                    />
                    Herdar do produto
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <RadioGroupItem
                      value="especifico"
                      id={`${id(campo)}-especifico`}
                      aria-label={`Usar valor específico — ${rotulo}`}
                      disabled={desabilitado}
                    />
                    Usar valor específico
                  </span>
                </RadioGroup>
                <div className="relative">
                  {prefixo && (
                    <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
                      {prefixo}
                    </span>
                  )}
                  <Input
                    id={id(campo)}
                    aria-label={`${rotulo}${sufixo ? ` (${sufixo})` : ''} de ${nome}`}
                    className={cn('h-8 text-sm', prefixo && 'pl-8', sufixo && 'pr-7')}
                    value={resolvida[campo]}
                    disabled={desabilitado || !especifico}
                    onChange={(e) => onMudarOverride(campo, e.target.value)}
                  />
                  {sufixo && (
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                      {sufixo}
                    </span>
                  )}
                </div>
                {erro && tentouSalvar && especifico && (
                  <span className="text-xs text-destructive">{erro}</span>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
