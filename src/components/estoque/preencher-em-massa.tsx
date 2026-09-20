// Preencher em massa (spec 2026-09-19 "matriz"). Uma instância POR GATILHO: `ui/popover.tsx` não
// exporta `PopoverAnchor`, então um popover único reposicionado exigiria editar o componente de
// UI. O `PopoverContent` do Radix só monta quando aberto — 15 cabeçalhos de linha custam ~zero.
//
// O gatilho PRÉ-SELECIONA o escopo; o operador ainda pode trocá-lo dentro do popover.
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ROTULOS } from '@/components/estoque/detalhes-sku';
import {
  CAMPOS_HERDAVEIS, type CampoMassa, type EscopoMassa, type OpcoesMassa,
} from '@/lib/cadastro-grade';

const CAMPOS: { valor: CampoMassa; rotulo: string }[] = [
  { valor: 'estoqueInicial', rotulo: 'Estoque inicial' },
  { valor: 'gtin', rotulo: 'GTIN' },
  ...CAMPOS_HERDAVEIS.map((c) => ({ valor: c as CampoMassa, rotulo: ROTULOS[c].rotulo })),
];

const CLASSE_SELECT =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export function PreencherEmMassa({
  escopoInicial, campoInicial, cores, tamanhos, desabilitado, gatilho, rotuloGatilho, onAplicar,
}: {
  escopoInicial: EscopoMassa;
  /** Aba ativa da matriz. Obrigatório: um default aqui dentro faria o popover discordar da tela. */
  campoInicial: CampoMassa;
  cores: readonly string[];
  tamanhos: readonly string[];
  desabilitado: boolean;
  gatilho: React.ReactNode;
  rotuloGatilho: string;
  onAplicar: (opts: OpcoesMassa) => void;
}) {
  // `useId`, não id fixo: a Task 8 renderiza uma instância por cabeçalho (até ~36 numa grade de
  // calçado). Hoje só não colide porque o `PopoverContent` do Radix desmonta fechado — depender
  // disso é depender de detalhe de implementação de terceiro para a associação label/input.
  const uid = useId();
  const [aberto, setAberto] = useState(false);
  const [escopo, setEscopo] = useState<EscopoMassa>(escopoInicial);
  const [campo, setCampo] = useState<CampoMassa>(campoInicial);
  const [valor, setValor] = useState('');
  const herdavel = (CAMPOS_HERDAVEIS as readonly string[]).includes(campo);

  function emitir(v: string | null) {
    onAplicar({ campo, escopo, valor: v });
    setAberto(false);
    setValor('');
  }

  function trocarTipo(tipo: EscopoMassa['tipo']) {
    if (tipo === 'todos') { setEscopo({ tipo: 'todos' }); return; }
    // Primeiro valor do eixo como default: um escopo sem valor não atingiria linha nenhuma e o
    // "Aplicar" viraria um no-op silencioso.
    setEscopo(tipo === 'cor'
      ? { tipo: 'cor', valor: cores[0] ?? '' }
      : { tipo: 'tamanho', valor: tamanhos[0] ?? '' });
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        // Reabrir sempre volta ao escopo do gatilho: o cabeçalho clicado é a intenção declarada.
        // Campo e valor entram na MESMA regra (achado da revisão final): sobrevivendo ao fechar,
        // reabrir o mesmo cabeçalho depois de um uso em GTIN gravava o estoque digitado como GTIN
        // de toda a cor/tamanho, em silêncio. O campo nasce da ABA ativa da matriz, que é o que o
        // operador está olhando.
        if (o) { setEscopo(escopoInicial); setCampo(campoInicial); setValor(''); }
        setAberto(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-auto px-1 py-0.5 font-medium"
          aria-label={rotuloGatilho}
          disabled={desabilitado}
        >
          {gatilho}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-escopo`} className="text-xs text-muted-foreground">Aplicar em</label>
          <select
            id={`${uid}-escopo`} className={CLASSE_SELECT}
            value={escopo.tipo}
            onChange={(e) => trocarTipo(e.target.value as EscopoMassa['tipo'])}
          >
            <option value="todos">Toda a grade</option>
            <option value="cor">Uma cor</option>
            <option value="tamanho">Um tamanho</option>
          </select>
        </div>

        {escopo.tipo !== 'todos' && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-eixo`} className="text-xs text-muted-foreground">
              {escopo.tipo === 'cor' ? 'Cor' : 'Tamanho'}
            </label>
            <select
              id={`${uid}-eixo`} className={CLASSE_SELECT}
              value={escopo.valor}
              onChange={(e) => setEscopo({ tipo: escopo.tipo, valor: e.target.value })}
            >
              {(escopo.tipo === 'cor' ? cores : tamanhos)
                .map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-campo`} className="text-xs text-muted-foreground">Campo</label>
          <select
            id={`${uid}-campo`} className={CLASSE_SELECT}
            value={campo}
            onChange={(e) => setCampo(e.target.value as CampoMassa)}
          >
            {CAMPOS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-valor`} className="text-xs text-muted-foreground">Valor</label>
          <Input
            id={`${uid}-valor`} className="h-8 text-sm"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); emitir(valor); } }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => emitir(valor)}>Aplicar</Button>
          {herdavel ? (
            // `null`, não `''`: string vazia é override vazio (o operador decidiu "sem valor"),
            // e só a AUSÊNCIA da chave devolve a herança.
            <Button type="button" size="sm" variant="outline" onClick={() => emitir(null)}>
              Voltar ao herdado
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => emitir(null)}>
              Limpar
            </Button>
          )}
        </div>
        {/* Não existe "gerar GTIN": cadastro nunca inventa código de barras. */}
      </PopoverContent>
    </Popover>
  );
}
