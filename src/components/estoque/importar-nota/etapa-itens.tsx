// ADR-0181 — etapa 2: um produto (e um fator) para cada item da nota.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { useImageUrl } from '@/hooks/useImageUrl';
import { fmtBRL } from '@/lib/formato';
import { formatarNomeProduto, normalizarParaBusca } from '@/lib/texto';
import { urlFotoMl, type ProdutoEstoqueResumo } from '@/lib/produtos-saldo';
import { custoAquisicaoUnit, quantidadeEmEstoque } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import { contarProntos, definirFator, definirProduto, itemPronto, type DecisaoItem, type EstadoImportacao } from './estado';

function selo(d: DecisaoItem): { texto: string; ok: boolean } {
  if (d.codigoPai && d.origemVinculo === 'nota') return { texto: 'Cadastrado desta nota', ok: true };
  if (d.codigoPai && d.origemVinculo === 'vinculo') return { texto: 'Vinculado', ok: true };
  if (d.codigoPai && d.origemVinculo === 'gtin') return { texto: 'Casou pelo GTIN', ok: true };
  if (d.codigoPai) return { texto: 'Produto escolhido', ok: true };
  if (d.candidatosNota.length > 1) return { texto: 'Cadastrado mais de uma vez — escolha', ok: false };
  return { texto: d.candidatosGtin.length > 1 ? 'GTIN ambíguo — escolha' : 'Sem produto', ok: false };
}

// Mesma resolução de capa do card da tela Estoque (Storage assinado, senão foto do ML).
function Capa({ produto }: { produto?: ProdutoEstoqueResumo }) {
  const { data: url } = useImageUrl(produto?.capaStoragePath);
  return <FotoCapaFamilia capaUrl={url ?? urlFotoMl(produto?.capaMlPictureId)} tamanho="small" />;
}

function SeletorProduto({ produtos, candidatos, carregando, erro, foco, onEscolher, onCancelar }: {
  produtos: ProdutoEstoqueResumo[]; candidatos: string[]; carregando?: boolean; erro?: boolean; foco: boolean;
  onEscolher: (codigoPai: string) => void; onCancelar?: () => void;
}) {
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (foco) ref.current?.focus(); }, [foco]);
  const t = normalizarParaBusca(busca);
  const opcoes = useMemo(() => {
    // Sem texto: só os candidatos (nunca o catálogo inteiro). Com texto: busca em todos os produtos.
    const base = t ? produtos : produtos.filter((p) => candidatos.includes(p.codigoPai));
    return base.filter((p) => !t || normalizarParaBusca(`${p.nomePai} ${p.codigoPai}`).includes(t)).slice(0, 8);
  }, [produtos, candidatos, t]);
  const aviso = carregando ? 'Carregando produtos…'
    : erro ? 'Não foi possível carregar os produtos. Feche e abra a importação para tentar de novo.'
    : produtos.length === 0 ? 'Nenhum produto cadastrado.'
    : opcoes.length > 0 ? null
    : t ? 'Nenhum produto encontrado.' : 'Digite para buscar';
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input ref={ref} aria-label="Buscar produto" placeholder="Buscar produto por nome ou código"
          value={busca} onChange={(ev) => setBusca(ev.target.value)} />
        {onCancelar && <Button size="sm" variant="ghost" onClick={onCancelar}>Cancelar</Button>}
      </div>
      <ul className="max-h-40 overflow-auto rounded-md border text-sm">
        {aviso && <li className="p-2 text-muted-foreground">{aviso}</li>}
        {!carregando && !erro && opcoes.map((p) => (
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

export function EtapaItens({ e, setE, produtos, onCadastrarNovo, tiposProduto, carregandoTipos,
  conferirFalhou, onTentarNovamente, carregandoProdutos, erroProdutos }: {
  e: EstadoImportacao;
  setE: (e: EstadoImportacao) => void;
  produtos: ProdutoEstoqueResumo[];
  onCadastrarNovo?: (nItem: number, modo: 'grade' | 'simples') => void;
  /** `undefined` = "não sei" (query em voo ou falhou) — nunca é "org sem tipo" (ADR-0166). */
  tiposProduto?: string[];
  carregandoTipos?: boolean;
  /** A conferência de produtos já cadastrados desta nota falhou: aviso + retry. */
  conferirFalhou?: boolean;
  onTentarNovamente?: () => void;
  /** Carga/erro da lista de produtos — distintos de catálogo vazio. */
  carregandoProdutos?: boolean;
  erroProdutos?: boolean;
}) {
  // `buscando`: seletor aberto por clique ("Trocar" ou "Escolher existente…").
  const [buscando, setBuscando] = useState<Set<number>>(new Set());
  // Grade só existe com tipo de produto habilitado: o diálogo de grade depende do tipo e a edge
  // recusa tamanho sem tipo.
  const [perguntando, setPerguntando] = useState<number | null>(null);
  const comGrade = !!tiposProduto && tiposProduto.length > 0;
  const { prontos, total } = contarProntos(e);
  const abrir = (n: number) => setBuscando(new Set(buscando).add(n));
  const fechar = (n: number) => { const t = new Set(buscando); t.delete(n); setBuscando(t); };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-muted-foreground">{e.nota.emitenteNome}</span>
        <span className="shrink-0 font-medium">{prontos} de {total} itens prontos</span>
      </div>
      {conferirFalhou && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
          <span>Não foi possível conferir produtos já cadastrados desta nota</span>
          <Button size="sm" variant="outline" onClick={onTentarNovamente}>Tentar novamente</Button>
        </div>
      )}
      {e.decisoes.map((d) => {
        const item = e.itens.find((i) => i.nItem === d.nItem)!;
        const s = selo(d);
        const produto = produtos.find((p) => p.codigoPai === d.codigoPai);
        const mostrarFator = !['UN', 'PC'].includes(item.uCom.toUpperCase()) || d.fator > 1;
        const travado = d.distribuicao.some((l) => l.travada);
        const aberto = buscando.has(d.nItem);
        const escolhendo = aberto || (!d.codigoPai && d.candidatosNota.length > 1);
        const q = quantidadeEmEstoque(item.qCom, d.fator);
        const distribuidas = d.distribuicao.reduce((a, l) => a + l.quantidade, 0);
        const pct = q.ok ? Math.min(100, Math.round((distribuidas / q.quantidade) * 100)) : 0;
        // Sem produto + conferência falhou: escolher um existente é o caminho seguro (não duplica cadastro).
        const primarioEscolher = !!conferirFalhou && !d.codigoPai;
        return (
          <div key={d.nItem} className="space-y-2 rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words text-xs text-muted-foreground">
                Item {item.nItem} · na nota: &quot;{item.xProd}&quot; · {item.qCom} {item.uCom}
                {q.ok && d.fator > 1 && <> × {d.fator} = {q.quantidade} unidades</>}
                {' '}· {fmtBRL(custoAquisicaoUnit(item, d.fator))}/unidade
              </p>
              <Badge className="shrink-0" variant={s.ok ? 'secondary' : 'outline'}>{s.texto}</Badge>
            </div>

            {d.codigoPai && (
              <div className="flex items-center gap-3">
                <Capa produto={produto} />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{formatarNomeProduto(produto?.nomePai) || d.codigoPai}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.codigoPai}{produto && <> · {produto.qtdSkus} {produto.qtdSkus === 1 ? 'SKU' : 'SKUs'}</>}
                  </p>
                </div>
                {!travado && !aberto && <Button size="sm" variant="ghost" onClick={() => abrir(d.nItem)}>Trocar</Button>}
              </div>
            )}

            {escolhendo && (
              <SeletorProduto
                produtos={produtos}
                candidatos={d.candidatosNota.length > 0 ? d.candidatosNota : d.candidatosGtin}
                carregando={carregandoProdutos} erro={erroProdutos} foco={aberto}
                onCancelar={aberto ? () => fechar(d.nItem) : undefined}
                onEscolher={(cp) => { setE(definirProduto(e, d.nItem, cp)); fechar(d.nItem); }}
              />
            )}

            {d.codigoPai && (q.ok ? (
              <div className="space-y-1">
                <p className="text-xs tabular-nums text-muted-foreground">
                  Distribuídas: {distribuidas} de {q.quantidade} · faltam {Math.max(0, q.quantidade - distribuidas)}
                </p>
                <Progress value={pct} aria-valuenow={pct} aria-label={`Distribuição do item ${item.nItem}`} />
              </div>
            ) : !itemPronto(e, d) && <p className="text-xs text-destructive">{q.erro}</p>)}

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
              {(!d.codigoPai || aberto) && (
                <>
                  {!d.codigoPai && !aberto && (
                    <Button size="sm" variant={primarioEscolher ? 'default' : 'outline'} onClick={() => abrir(d.nItem)}>
                      Escolher existente…
                    </Button>
                  )}
                  <Button
                    size="sm" variant={primarioEscolher || d.codigoPai ? 'outline' : 'default'}
                    disabled={!onCadastrarNovo || carregandoTipos}
                    onClick={() => (comGrade ? setPerguntando(d.nItem) : onCadastrarNovo?.(d.nItem, 'simples'))}
                  >
                    Cadastrar produto novo
                  </Button>
                </>
              )}
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
