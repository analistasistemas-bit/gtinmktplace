import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useImageUrl } from '@/hooks/useImageUrl';
import { useDescontoPct } from '@/hooks/useConfiguracoes';
import { useUpdateExibirDesconto, useUpdateDescontoPctFamilia } from '@/hooks/useFamiliaMutations';
import { calcularPrecoDe, pctEfetivo } from '@/lib/desconto';
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

function DescontoControle({ familia }: { familia: Familia }) {
  const { data: globalPct } = useDescontoPct();
  const updExibir = useUpdateExibirDesconto(familia.loteId);
  const updPct = useUpdateDescontoPctFamilia(familia.loteId);
  const pct = pctEfetivo(familia.descontoPct, globalPct ?? 15);
  // Preço de venda real (mesma fonte do card "Você recebe", painel-analise): menor
  // preço de PUBLICAÇÃO das cores incluídas — não o preço da planilha. Reage à edição.
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const baseVariacoes = incluidas.length > 0 ? incluidas : familia.variacoes;
  const precoVenda = baseVariacoes.length > 0
    ? Math.min(...baseVariacoes.map((v) => v.precoPublicacao ?? v.preco))
    : 0;
  const de = calcularPrecoDe(precoVenda, pct);
  return (
    <div className="flex items-center gap-2 text-xs">
      <Checkbox
        checked={familia.exibirComDesconto}
        onCheckedChange={(v) => updExibir.mutate({ familiaId: familia.id, exibir: !!v })}
      />
      <span>Exibir com desconto</span>
      {familia.exibirComDesconto && (
        <>
          <input
            type="number"
            min={0}
            max={99}
            className="w-14 rounded border px-1"
            defaultValue={familia.descontoPct ?? globalPct ?? 15}
            onBlur={(e) => {
              const n = Number(e.target.value);
              updPct.mutate({ familiaId: familia.id, pct: Number.isFinite(n) ? n : null });
            }}
          />
          <span>%</span>
          {de != null && (
            <span className="text-muted-foreground">
              <s>R$ {formatarBRL(de)}</s> · R$ {formatarBRL(precoVenda)} · {pct}% OFF
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function FamiliaRow({ familia, selecionada, expandida, onSelecionar, onExpandir }: FamiliaRowProps) {
  const { data: capaUrl } = useImageUrl(familia.capaStoragePath ?? familia.fotoCapaPath);
  const pub = familiaPublicavel(familia);
  const publicado = familia.status === 'publicado';
  // Resumo do UPDATE na linha recolhida: quantas cores têm estoque alterado
  // (mesma regra do DiffEstoque). Dá o "o que será atualizado" sem precisar expandir.
  const coresComEstoqueAlterado =
    familia.operacao === 'UPDATE'
      ? familia.variacoes.filter(
          (v) => v.mlVariationId && !v.excluidaDaPublicacao && v.estoqueAnterior !== v.estoque,
        ).length
      : 0;
  return (
    <div
      className={cn(
        'border-b',
        familia.editadoPeloOperador && 'border-l-2 border-l-purple-500'
      )}
    >
    <div
      className="grid grid-cols-[24px_40px_1fr_80px_140px_40px] items-center gap-3 px-4 py-2 text-sm"
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
          {!publicado && familia.operacao === 'UPDATE' && (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              {coresComEstoqueAlterado > 0
                ? `estoque: ${coresComEstoqueAlterado} cor(es)`
                : 'sem mudança de estoque'}
            </span>
          )}
          {familia.variacoesSemCor > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
              ⚠ {familia.variacoesSemCor} sem cor
            </span>
          )}
          {!publicado && !pub.ok && (
            <span
              className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title={pub.motivos.join('\n')}
            >
              🔒 {pub.motivos[0]}{pub.motivos.length > 1 ? ` (+${pub.motivos.length - 1})` : ''}
            </span>
          )}
          {publicado && (
            familia.mlPermalink ? (
              <a
                href={familia.mlPermalink}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 hover:underline"
              >
                {familia.operacao === 'UPDATE' ? '✓ atualizado ↗' : '✓ publicado ↗'}
              </a>
            ) : (
              <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
                {familia.operacao === 'UPDATE' ? '✓ atualizado' : '✓ publicado'}
              </span>
            )
          )}
          {familia.mudancaEstrutural && (
            <span
              className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title={[
                familia.mudancaEstrutural.novas.length ? `${familia.mudancaEstrutural.novas.length} cor(es) nova(s)` : '',
                familia.mudancaEstrutural.removidas.length ? `${familia.mudancaEstrutural.removidas.length} cor(es) removida(s)` : '',
              ].filter(Boolean).join(' · ')}
            >
              ⚠ mudança estrutural
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
      <div className="px-4 pb-2 pl-[100px]">
        <DescontoControle familia={familia} />
      </div>
    </div>
  );
}
