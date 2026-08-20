// Card de variação do cadastro. Substitui a linha de 9 inputs minúsculos numa tabela com scroll
// horizontal. Campos agrupados por natureza: identificação, comercial, logística, foto.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { parseNumeroPtBr } from '@/lib/formato';
import { cn } from '@/lib/utils';

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
export const parseNum = parseNumeroPtBr;

export function erroCampo(campo: keyof LinhaVariacao, valor: string): string | null {
  if (campo === 'nome' || campo === 'gtin') return null;
  const n = parseNum(valor);
  if (Number.isNaN(n)) return 'Valor inválido.';
  if (campo === 'preco' && (n == null || n <= 0)) return 'Preço mínimo (líquido) é obrigatório e deve ser maior que zero.';
  if (campo === 'estoqueInicial' && n != null && !Number.isInteger(n)) {
    return 'Estoque inicial deve ser um número inteiro.';
  }
  if (campo === 'estoqueInicial' && n != null && n < 0) {
    return 'Estoque inicial não pode ser negativo.';
  }
  if (campo === 'custo' && n != null && n <= 0) return 'Custo, quando informado, deve ser maior que zero.';
  return null;
}

const NUMERICOS = [
  // Rotulagem só (dono do produto): "Preço" confundia o operador — o motor de precificação
  // (ADR-0020/0055/0065) pode sugerir um preço de venda maior na Revisão, e o valor digitado
  // aqui continuava exibido lá, só que rotulado "mín. líquido" sem explicar a origem. Não
  // mexe em cálculo/fluxo de dado nenhum — só no texto.
  // "(líquido)" no rótulo é a ponte com a Revisão, que exibe este mesmo valor como
  // "mín. líquido" — sem isso o operador não reconhece o próprio número lá.
  { campo: 'preco', rotulo: 'Preço mínimo (líquido)', prefixo: 'R$' },
  { campo: 'custo', rotulo: 'Custo', prefixo: 'R$' },
  { campo: 'estoqueInicial', rotulo: 'Estoque inicial', prefixo: undefined },
] as const;

const LOGISTICA = [
  { campo: 'pesoGramas', rotulo: 'Peso', sufixo: 'g' },
  { campo: 'alturaCm', rotulo: 'Altura', sufixo: 'cm' },
  { campo: 'larguraCm', rotulo: 'Largura', sufixo: 'cm' },
  { campo: 'comprimentoCm', rotulo: 'Comprimento', sufixo: 'cm' },
] as const;

export function LinhaVariacaoForm({ linha, indice, podeRemover, tentouSalvar, fotoObrigatoria, onMudar, onRemover }: {
  linha: LinhaVariacao;
  indice: number;
  podeRemover: boolean;
  /** true depois do primeiro clique em "Cadastrar" — a partir daí, erro aparece em TODO campo
   *  inválido, tocado ou não (§5.4: senão o operador não descobre o que falta sem clicar em
   *  cada campo). */
  tentouSalvar: boolean;
  /** ADR-0128: dialog "Adicionar variação" não publica cor sem foto (D-4) — default `undefined`
   *  preserva o comportamento de hoje (foto opcional) byte a byte para o cadastro (ADR-0094). */
  fotoObrigatoria?: boolean;
  onMudar: (patch: Partial<LinhaVariacao>) => void;
  onRemover: () => void;
}) {
  const n = indice + 1;
  const id = (campo: string) => `var-${linha.clientId}-${campo}`;

  // Campo tocado (perdeu foco ao menos uma vez). Sem isto, `erroCampo` mostrava a mensagem no
  // formulário virgem, antes de qualquer interação — a spec (§5.4) só quer o erro depois do
  // primeiro blur do campo ou da primeira tentativa de salvar.
  const [tocados, setTocados] = useState<Set<string>>(new Set());

  const campoTexto = (
    campo: keyof LinhaVariacao,
    rotulo: string,
    unidade?: { prefixo?: string; sufixo?: string },
  ) => {
    const erro = erroCampo(campo, linha[campo] as string);
    const mostrarErro = !!erro && (tocados.has(campo) || tentouSalvar);
    return (
      <div key={campo} className="flex flex-col gap-1">
        <label htmlFor={id(campo)} className="text-xs text-muted-foreground">
          {rotulo}
          {campo === 'preco' && <span className="text-destructive"> *</span>}
        </label>
        <div className="relative">
          {unidade?.prefixo && (
            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
              {unidade.prefixo}
            </span>
          )}
          <Input
            id={id(campo)}
            // Regressão (achado via snapshot de acessibilidade): o sufixo visual ("g"/"cm") é
            // decorativo — quem usa leitor de tela não o percebe. A unidade de MEDIDA FÍSICA
            // (peso/dimensão) precisa voltar pro aria-label. R$ fica de fora de propósito:
            // "Preço mínimo"/"Custo" já são inequívocos em português, e preservar o texto exato
            // que os testes/scripts já buscam (`getByLabelText('Preço mínimo da variação 1')`)
            // é mais valioso aqui do que anexar "(R$)".
            aria-label={`${rotulo}${unidade?.sufixo ? ` (${unidade.sufixo})` : ''} da variação ${n}`}
            className={cn('h-8 text-sm', unidade?.prefixo && 'pl-8', unidade?.sufixo && 'pr-7')}
            value={linha[campo] as string}
            onChange={(e) => onMudar({ [campo]: e.target.value } as Partial<LinhaVariacao>)}
            onBlur={() => setTocados((prev) => (prev.has(campo) ? prev : new Set(prev).add(campo)))}
          />
          {unidade?.sufixo && (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
              {unidade.sufixo}
            </span>
          )}
        </div>
        {mostrarErro && <span className="text-xs text-destructive">{erro}</span>}
      </div>
    );
  };

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
        {NUMERICOS.map((c) => campoTexto(c.campo, c.rotulo, { prefixo: c.prefixo }))}
      </div>
      {/* Texto conferido contra `sugerir.ts:49` e `semaforo.ts:13`: o piso é comparado com o
          LÍQUIDO (após comissão, frete e imposto), não com o preço de venda, e o sistema NÃO
          bloqueia quem fica abaixo — sinaliza no semáforo ("Abaixo do mínimo"). Dizer "o
          anúncio nunca sai abaixo disso" seria promessa que o motor não cumpre. */}
      <span className="text-xs text-muted-foreground">
        É quanto você quer receber por venda, já descontados comissão, frete e imposto. A Revisão
        calcula o preço de venda a partir dele e avisa quando o líquido fica abaixo desse mínimo.
      </span>

      <div className="grid gap-2 sm:grid-cols-4">
        {LOGISTICA.map((c) => campoTexto(c.campo, c.rotulo, { sufixo: c.sufixo }))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Foto</span>
        <CampoFoto
          id={id('foto')}
          ariaLabel={`Foto da variação ${n}`}
          arquivo={linha.foto}
          opcional={!fotoObrigatoria}
          onEscolher={(f) => onMudar({ foto: f })}
        />
      </div>
    </div>
  );
}
