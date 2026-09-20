// Linha da grade (spec 2026-09-19 §2, passo 3). Layout próprio, NÃO uma variante de
// `LinhaVariacaoForm`: cor/tamanho são travados (editá-los desalinharia a chave da
// reconciliação), o modo é compacto por padrão e cada campo herdável tem seu próprio cadeado.
// Reaproveita o helper `erroCampo`, não o JSX.
import { useState } from 'react';
import { Lock, LockOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { erroCampo } from '@/components/estoque/linha-variacao-form';
import {
  CAMPOS_HERDAVEIS, type CampoHerdavel, type LinhaGrade, type LinhaResolvida,
} from '@/lib/cadastro-grade';
import { cn } from '@/lib/utils';

// Exportado: o cabeçalho do dialog de grade (Task 8) usa o MESMO rótulo, sem redigitá-lo. Gera
// warning de `react-refresh/only-export-components`, aceita — mesmo padrão de gerador-variacoes.tsx.
export const ROTULOS: Record<CampoHerdavel, { rotulo: string; prefixo?: string; sufixo?: string }> = {
  // Rótulo idêntico ao de `linha-variacao-form.tsx:58` — é a ponte com a Revisão, que exibe
  // este mesmo valor como "mín. líquido".
  preco: { rotulo: 'Preço mínimo (líquido)', prefixo: 'R$' },
  custo: { rotulo: 'Custo', prefixo: 'R$' },
  pesoGramas: { rotulo: 'Peso', sufixo: 'g' },
  alturaCm: { rotulo: 'Altura', sufixo: 'cm' },
  larguraCm: { rotulo: 'Largura', sufixo: 'cm' },
  comprimentoCm: { rotulo: 'Comprimento', sufixo: 'cm' },
};

export function LinhaGradeForm({
  linha, resolvida, tentouSalvar, desabilitado, podeRemover,
  onMudar, onMudarOverride, onDestravar, onVoltarAHerdar, onRemover,
}: {
  linha: LinhaGrade;
  /** Valor efetivo já calculado por `resolverLinha` — a linha NUNCA resolve herança sozinha. */
  resolvida: LinhaResolvida;
  tentouSalvar: boolean;
  /** true durante `salvando`: a lista tem que ficar congelada (casamento posicional). */
  desabilitado: boolean;
  podeRemover: boolean;
  onMudar: (patch: Partial<Pick<LinhaGrade, 'gtin' | 'estoqueInicial' | 'foto'>>) => void;
  /** Editar um campo herdável já destravado — patch de `overrides`, não da linha crua. */
  onMudarOverride: (campo: CampoHerdavel, valor: string) => void;
  /** Destravar semeia o override com o valor resolvido no dialog — não viola "nunca copiar o
   *  herdado": um campo deliberadamente destravado parou de seguir o cabeçalho. */
  onDestravar: (campo: CampoHerdavel) => void;
  onVoltarAHerdar: (campo: CampoHerdavel) => void;
  onRemover: () => void;
}) {
  const nome = `${linha.cor} · ${linha.tamanho}`;
  const temOverride = Object.keys(linha.overrides).length > 0;
  const [expandidoManual, setExpandidoManual] = useState(false);
  const expandido = expandidoManual || temOverride;
  const id = (campo: string) => `grade-${linha.clientId}-${campo}`;

  const campoSimples = (campo: 'gtin' | 'estoqueInicial', rotulo: string) => {
    const erro = erroCampo(campo, linha[campo]);
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id(campo)} className="text-xs text-muted-foreground">{rotulo}</label>
        <Input
          id={id(campo)}
          aria-label={`${rotulo} de ${nome}`}
          className="h-8 text-sm"
          value={linha[campo]}
          disabled={desabilitado}
          onChange={(e) => onMudar({ [campo]: e.target.value })}
        />
        {erro && tentouSalvar && <span className="text-xs text-destructive">{erro}</span>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        {/* Cor e tamanho são TEXTO, não campo: a chave da reconciliação depende deles. */}
        <span className="text-sm font-medium">{nome}</span>
        <Button
          type="button" variant="ghost" size="sm"
          disabled={desabilitado || !podeRemover}
          aria-label={`Remover ${nome}`}
          onClick={onRemover}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {campoSimples('estoqueInicial', 'Estoque inicial')}
        {campoSimples('gtin', 'GTIN')}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Foto</span>
          <CampoFoto
            id={id('foto')}
            ariaLabel={`Foto de ${nome}`}
            arquivo={resolvida.foto}
            disabled={desabilitado}
            opcional
            onEscolher={(f) => onMudar({ foto: f })}
          />
        </div>
      </div>

      {!expandido ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Preço, custo e dimensões herdados do produto ({ROTULOS.preco.prefixo} {resolvida.preco || '—'}).
          </span>
          <Button
            type="button" variant="ghost" size="sm"
            disabled={desabilitado}
            onClick={() => setExpandidoManual(true)}
          >
            Editar nesta linha
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {CAMPOS_HERDAVEIS.map((campo) => {
            const { rotulo, prefixo, sufixo } = ROTULOS[campo];
            const destravado = campo in linha.overrides;
            const erro = erroCampo(campo, resolvida[campo]);
            return (
              <div key={campo} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1">
                  <label htmlFor={id(campo)} className="text-xs text-muted-foreground">{rotulo}</label>
                  <Button
                    type="button" variant="ghost" size="sm" className="h-6 px-1"
                    disabled={desabilitado}
                    aria-label={`${destravado ? 'Voltar a herdar' : 'Destravar'} ${rotulo} de ${nome}`}
                    onClick={() => (destravado ? onVoltarAHerdar(campo) : onDestravar(campo))}
                  >
                    {destravado ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  </Button>
                </div>
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
                    disabled={desabilitado || !destravado}
                    onChange={(e) => onMudarOverride(campo, e.target.value)}
                  />
                  {sufixo && (
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                      {sufixo}
                    </span>
                  )}
                </div>
                {erro && tentouSalvar && destravado && (
                  <span className="text-xs text-destructive">{erro}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
