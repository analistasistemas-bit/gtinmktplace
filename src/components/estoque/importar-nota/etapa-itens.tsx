// ADR-0181 — etapa 2: um produto (e um fator) para cada item da nota.
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtBRL } from '@/lib/formato';
import { formatarNomeProduto, normalizarParaBusca } from '@/lib/texto';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';
import { custoAquisicaoUnit } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import { definirFator, definirProduto, type DecisaoItem, type EstadoImportacao } from './estado';

function selo(d: DecisaoItem): { texto: string; ok: boolean } {
  if (d.codigoPai && d.origemVinculo === 'vinculo') return { texto: 'Vinculado', ok: true };
  if (d.codigoPai && d.origemVinculo === 'gtin') return { texto: 'Casou pelo GTIN', ok: true };
  if (d.codigoPai) return { texto: 'Produto escolhido', ok: true };
  return { texto: d.candidatosGtin.length > 1 ? 'GTIN ambíguo — escolha' : 'Escolha o produto', ok: false };
}

function SeletorProduto({ produtos, candidatos, onEscolher }: {
  produtos: ProdutoEstoqueResumo[]; candidatos: string[]; onEscolher: (codigoPai: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const opcoes = useMemo(() => {
    const base = candidatos.length > 1 ? produtos.filter((p) => candidatos.includes(p.codigoPai)) : produtos;
    const t = normalizarParaBusca(busca);
    return base.filter((p) => !t || normalizarParaBusca(`${p.nomePai} ${p.codigoPai}`).includes(t)).slice(0, 8);
  }, [produtos, candidatos, busca]);
  return (
    <div className="space-y-1">
      <Input placeholder="Buscar produto por nome ou código" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
      <ul className="max-h-40 overflow-auto rounded-md border text-sm">
        {opcoes.length === 0 && <li className="p-2 text-muted-foreground">Nenhum produto encontrado.</li>}
        {opcoes.map((p) => (
          <li key={p.codigoPai}>
            <button type="button" className="w-full px-2 py-1.5 text-left hover:bg-muted" onClick={() => onEscolher(p.codigoPai)}>
              {formatarNomeProduto(p.nomePai)} <span className="text-muted-foreground">· {p.codigoPai}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EtapaItens({ e, setE, produtos, onCadastrarNovo, tiposProduto, carregandoTipos }: {
  e: EstadoImportacao;
  setE: (e: EstadoImportacao) => void;
  produtos: ProdutoEstoqueResumo[];
  onCadastrarNovo?: (nItem: number, modo: 'grade' | 'simples') => void;
  /** `undefined` = "não sei" (query em voo ou falhou) — nunca é "org sem tipo" (ADR-0166). */
  tiposProduto?: string[];
  carregandoTipos?: boolean;
}) {
  const [trocando, setTrocando] = useState<Set<number>>(new Set());
  // Grade só existe com tipo de produto habilitado: o diálogo de grade depende do tipo e a edge
  // recusa tamanho sem tipo.
  const [perguntando, setPerguntando] = useState<number | null>(null);
  const comGrade = !!tiposProduto && tiposProduto.length > 0;
  return (
    <div className="space-y-3">
      {e.decisoes.map((d) => {
        const item = e.itens.find((i) => i.nItem === d.nItem)!;
        const s = selo(d);
        const produto = produtos.find((p) => p.codigoPai === d.codigoPai);
        const mostrarFator = !['UN', 'PC'].includes(item.uCom.toUpperCase()) || d.fator > 1;
        const travado = d.distribuicao.some((l) => l.travada);
        const escolhendo = !d.codigoPai || trocando.has(d.nItem);
        return (
          <div key={d.nItem} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{item.nItem}. {item.xProd}</p>
                <p className="text-xs text-muted-foreground">
                  {item.qCom} {item.uCom} · custo de aquisição {fmtBRL(custoAquisicaoUnit(item, d.fator))} por unidade
                </p>
              </div>
              <Badge variant={s.ok ? 'secondary' : 'outline'}>{s.texto}</Badge>
            </div>

            {d.codigoPai && !escolhendo && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{formatarNomeProduto(produto?.nomePai) || d.codigoPai} <span className="text-muted-foreground">· {d.codigoPai}</span></span>
                {!travado && (
                  <Button size="sm" variant="ghost" onClick={() => setTrocando(new Set(trocando).add(d.nItem))}>Trocar</Button>
                )}
              </div>
            )}
            {escolhendo && (
              <SeletorProduto
                produtos={produtos}
                candidatos={d.candidatosGtin}
                onEscolher={(cp) => {
                  setE(definirProduto(e, d.nItem, cp));
                  const t = new Set(trocando); t.delete(d.nItem); setTrocando(t);
                }}
              />
            )}

            <div className="flex flex-wrap items-center gap-3">
              {mostrarFator && (
                <label className="flex items-center gap-2 text-sm">
                  Unidades por {item.uCom}
                  <Input
                    type="number" min={1} step={1} className="w-24" value={d.fator}
                    disabled={travado}
                    onChange={(ev) => setE(definirFator(e, d.nItem, Number(ev.target.value)))}
                  />
                </label>
              )}
              <Button
                size="sm" variant="outline" disabled={!onCadastrarNovo || carregandoTipos}
                onClick={() => (comGrade ? setPerguntando(d.nItem) : onCadastrarNovo?.(d.nItem, 'simples'))}
              >
                Cadastrar produto novo
              </Button>
            </div>
            {perguntando === d.nItem && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-sm">
                <span>Este produto tem tamanho/cor?</span>
                <Button size="sm" onClick={() => { setPerguntando(null); onCadastrarNovo?.(d.nItem, 'grade'); }}>Grade</Button>
                <Button size="sm" variant="outline" onClick={() => { setPerguntando(null); onCadastrarNovo?.(d.nItem, 'simples'); }}>Simples</Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
