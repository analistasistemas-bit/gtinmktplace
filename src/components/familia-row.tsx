import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useImageUrl } from '@/hooks/useImageUrl';
import { cn } from '@/lib/utils';
import type { Familia } from '@/lib/tipos-dominio';
import { familiaPublicavel } from '@/lib/publicavel';

interface FamiliaRowProps {
  familia: Familia;
  selecionada: boolean;
  expandida: boolean;
  onSelecionar: (id: string, valor: boolean) => void;
  onExpandir: (id: string) => void;
}

function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FamiliaRow({ familia, selecionada, expandida, onSelecionar, onExpandir }: FamiliaRowProps) {
  const { data: capaUrl } = useImageUrl(familia.capaStoragePath ?? familia.fotoCapaPath);
  const pub = familiaPublicavel(familia);
  return (
    <div
      className={cn(
        'grid grid-cols-[24px_40px_1fr_80px_140px_40px] items-center gap-3 border-b px-4 py-2 text-sm',
        familia.editadoPeloOperador && 'border-l-2 border-l-purple-500'
      )}
    >
      <Checkbox
        checked={selecionada}
        disabled={!pub.ok}
        onCheckedChange={(v) => onSelecionar(familia.id, v === true)}
      />
      {capaUrl ? (
        <img
          src={capaUrl}
          alt={familia.titulo}
          className="h-8 w-8 rounded border object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="h-8 w-8 rounded bg-muted"
          style={
            familia.variacoes[0]
              ? { backgroundColor: familia.variacoes[0].corHex }
              : undefined
          }
        />
      )}
      <div>
        <div className="font-medium">{familia.titulo}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>PAI {familia.codigoPai} · {familia.variacoes.length} cores</span>
          {familia.variacoesSemCor > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
              ⚠ {familia.variacoesSemCor} sem cor
            </span>
          )}
          {!pub.ok && (
            <span
              className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title={pub.motivos.join('\n')}
            >
              🔒 {pub.motivos[0]}{pub.motivos.length > 1 ? ` (+${pub.motivos.length - 1})` : ''}
            </span>
          )}
        </div>
      </div>
      <Badge variant={familia.operacao === 'CREATE' ? 'default' : 'secondary'}>
        {familia.operacao}
      </Badge>
      <div className="flex items-center gap-1">
        <span>
          R$ {formatarBRL(familia.precoMin)}
          {familia.precoMin !== familia.precoMax && `-${formatarBRL(familia.precoMax)}`}
        </span>
        {familia.precoAbaixo20pc && (
          <AlertTriangle
            className="h-4 w-4 text-destructive"
            aria-label="Preço abaixo de 20% do seu preço da planilha"
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onExpandir(familia.id)}
        className="text-muted-foreground hover:text-foreground"
        aria-label={expandida ? 'Recolher' : 'Expandir'}
      >
        {expandida ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
