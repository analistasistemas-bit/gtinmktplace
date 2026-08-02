// Card de variação do cadastro. Substitui a linha de 9 inputs minúsculos numa tabela com scroll
// horizontal. Campos agrupados por natureza: identificação, comercial, logística, foto.
import { useEffect, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface LinhaVariacao {
  /** Identidade estável da linha. `key` por índice + <input type="file"> (DOM não-controlável)
   *  faz o arquivo escolhido "andar" para outra variação quando uma linha é removida — e como o
   *  casamento com o id do banco é posicional, a foto acabaria gravada no SKU errado. */
  clientId: string;
  nome: string; gtin: string;
  preco: string; custo: string; estoqueInicial: string;
  pesoGramas: string; alturaCm: string; larguraCm: string; comprimentoCm: string;
  foto: File | null;
}

export function novaLinha(): LinhaVariacao {
  return {
    clientId: crypto.randomUUID(),
    nome: '', gtin: '', preco: '', custo: '', estoqueInicial: '',
    pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '', foto: null,
  };
}

/** `null` = campo vazio. `NaN` = texto inválido — que NÃO pode virar "vazio" em silêncio. */
export function parseNum(v: string): number | null | typeof NaN {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function erroCampo(campo: keyof LinhaVariacao, valor: string): string | null {
  if (campo === 'nome' || campo === 'gtin') return null;
  const n = parseNum(valor);
  if (Number.isNaN(n)) return 'Valor inválido.';
  if (campo === 'preco' && (n == null || n <= 0)) return 'Preço é obrigatório e deve ser maior que zero.';
  if (campo === 'estoqueInicial' && n != null && !Number.isInteger(n)) {
    return 'Estoque inicial deve ser um número inteiro.';
  }
  if (campo === 'custo' && n != null && n <= 0) return 'Custo, quando informado, deve ser maior que zero.';
  return null;
}

const NUMERICOS = [
  { campo: 'preco', rotulo: 'Preço' },
  { campo: 'custo', rotulo: 'Custo' },
  { campo: 'estoqueInicial', rotulo: 'Estoque inicial' },
] as const;

const LOGISTICA = [
  { campo: 'pesoGramas', rotulo: 'Peso (g)' },
  { campo: 'alturaCm', rotulo: 'Altura (cm)' },
  { campo: 'larguraCm', rotulo: 'Largura (cm)' },
  { campo: 'comprimentoCm', rotulo: 'Comprimento (cm)' },
] as const;

export function LinhaVariacaoForm({ linha, indice, podeRemover, onMudar, onRemover }: {
  linha: LinhaVariacao;
  indice: number;
  podeRemover: boolean;
  onMudar: (patch: Partial<LinhaVariacao>) => void;
  onRemover: () => void;
}) {
  const n = indice + 1;
  const id = (campo: string) => `var-${linha.clientId}-${campo}`;

  // useMemo: só cria uma blob URL nova quando o `File` muda — sem isto, qualquer tecla em
  // qualquer campo do card re-renderiza e cria (e vaza) uma URL nova pra mesma foto.
  const fotoUrl = useMemo(() => (linha.foto ? URL.createObjectURL(linha.foto) : null), [linha.foto]);
  useEffect(() => () => { if (fotoUrl) URL.revokeObjectURL(fotoUrl); }, [fotoUrl]);

  const campoTexto = (campo: keyof LinhaVariacao, rotulo: string) => (
    <div key={campo} className="flex flex-col gap-1">
      <label htmlFor={id(campo)} className="text-xs text-muted-foreground">
        {rotulo} da variação {n}
      </label>
      <Input
        id={id(campo)}
        className="h-8 text-sm"
        value={linha[campo] as string}
        onChange={(e) => onMudar({ [campo]: e.target.value } as Partial<LinhaVariacao>)}
      />
      {erroCampo(campo, linha[campo] as string) && (
        <span className="text-xs text-destructive">{erroCampo(campo, linha[campo] as string)}</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Variação {n}</span>
        <Button
          type="button" variant="ghost" size="sm"
          disabled={!podeRemover}
          aria-label={`Remover variação ${n}`}
          onClick={onRemover}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {campoTexto('nome', 'Cor / nome')}
        {campoTexto('gtin', 'GTIN')}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {NUMERICOS.map((c) => campoTexto(c.campo, c.rotulo))}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {LOGISTICA.map((c) => campoTexto(c.campo, c.rotulo))}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={id('foto')} className="text-xs text-muted-foreground">
            Foto da variação {n}
          </label>
          <Input
            id={id('foto')} type="file" accept="image/*"
            onChange={(e) => onMudar({ foto: e.target.files?.[0] ?? null })}
          />
        </div>
        {fotoUrl && (
          <img
            src={fotoUrl}
            alt={`Prévia da foto da variação ${n}`}
            className="h-16 w-16 shrink-0 rounded-md object-cover"
          />
        )}
      </div>
    </div>
  );
}
