// ADR-0181 — etapa 3: distribuição das unidades de cada item pelos SKUs do produto.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QK } from '@/lib/queries';
import { fetchProdutosEstoqueResumo, fetchSkusEstoqueOrg, fetchVariacoesProduto } from '@/lib/produtos-saldo';
import { useProfile } from '@/hooks/useProfile';
import { DialogAdicionarVariacaoRoteador } from '@/components/estoque/dialog-adicionar-variacao-roteador';
import { filtrarOpcoesSku, montarOpcoesSku } from '@/lib/dialog-entrada-busca';
import { primeiraEntradaComprovada } from '@/lib/notas-compra';
import { fmtBRLSemSimbolo } from '@/lib/formato';
import { custoAquisicaoUnit, quantidadeEmEstoque } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import {
  acaoVariacaoFaltante, custoPadraoSku, definirDistribuicao, semearDistribuicao, travarLinhaNova,
  type DecisaoItem, type EstadoImportacao, type LinhaEstado,
} from './estado';

type Atualizar = (f: (s: EstadoImportacao) => EstadoImportacao) => void;
interface Rotulo { cor: string | null; tamanho: string | null; estoque: number }

const MSG_FALTANTE = {
  'pedir-admin': 'Peça a um administrador para adicionar o tamanho/cor e volte.',
  'recusar-nao-publicado': 'Este produto ainda não foi publicado e não aceita tamanho novo nesta versão. Cadastre a grade completa ou publique antes.',
} as const;

function ItemDistribuicao({ e, atualizar, d }: { e: EstadoImportacao; atualizar: Atualizar; d: DecisaoItem }) {
  const qc = useQueryClient();
  const item = e.itens.find((i) => i.nItem === d.nItem)!;
  const q = quantidadeEmEstoque(item.qCom, d.fator);
  const custoDef = Math.round(custoAquisicaoUnit(item, d.fator) * 100) / 100;
  const { data: skus, isLoading, isError: erroSkus, error: erroSkusMsg } = useQuery({
    queryKey: QK.variacoesEstoque(d.codigoPai!),
    queryFn: () => fetchVariacoesProduto(d.codigoPai!),
    staleTime: 30_000,
  });
  // D-9 (emenda 2026-10-17): prova de 1ª entrada. Sem cache (staleTime/gcTime 0): um `true` antigo
  // aplicaria o custo do cadastro a uma recompra logo depois de confirmar. Falha concluída = false.
  const { data: provaOk, status: statusProva } = useQuery({
    queryKey: ['primeira-entrada', d.codigoPai],
    queryFn: () => primeiraEntradaComprovada(d.codigoPai!),
    staleTime: 0, gcTime: 0, retry: false,
  });
  const prova = provaOk === true;
  const [linhas, setLinhas] = useState<LinhaEstado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');
  // Também carrega quando há SKU de outro produto já salvo: é de lá que vêm cor/tamanho/saldo dele.
  const temExtras = d.distribuicao.some((l) => l.codigoPai);
  const { data: skusOrg = [], isError: erroOrg, error: erroOrgMsg } = useQuery({
    queryKey: ['skus-estoque-org'], queryFn: fetchSkusEstoqueOrg, enabled: buscando || temExtras, staleTime: 30_000,
  });
  // D-8 "Falta um tamanho/cor?": mesma consulta (cache) do assistente; publicado = tem anúncio no ML.
  const { isAdmin } = useProfile();
  const { data: resumo } = useQuery({
    queryKey: QK.produtosEstoqueResumo, queryFn: fetchProdutosEstoqueResumo, staleTime: 180_000,
  });
  const produto = resumo?.produtos.find((p) => p.codigoPai === d.codigoPai) ?? null;
  const [faltante, setFaltante] = useState<ReturnType<typeof acaoVariacaoFaltante> | null>(null);
  const [qtdNova, setQtdNova] = useState('');
  const [qtdNoDialog, setQtdNoDialog] = useState<number | null>(null);

  // Monta o buffer local uma vez, semeado com o que já está salvo (voltar/Corrigir não regrava nada).
  // Só depois das DUAS leituras (SKUs e prova): pendente ≠ falha; resposta tardia nunca re-semeia.
  useEffect(() => {
    if (linhas || isLoading || !skus || statusProva === 'pending') return;
    setLinhas(semearDistribuicao(skus, d.distribuicao, q.ok ? q.quantidade : 0, custoDef, prova));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, isLoading, statusProva]);

  // Estado inicial já com as linhas preenchidas (1 SKU) — sem isso o Resumo acusaria pendência sem o operador tocar.
  useEffect(() => {
    if (linhas) atualizar((s) => definirDistribuicao(s, d.nItem, linhas.filter((l) => l.quantidade > 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas]);

  const opcoes = useMemo(
    () => filtrarOpcoesSku(montarOpcoesSku(skusOrg).filter((o) => !linhas?.some((l) => l.codigo === o.codigo)), busca, 8),
    [skusOrg, busca, linhas],
  );

  if (erroSkus) {
    return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      Não foi possível carregar os SKUs do item {item.nItem}: {erroSkusMsg instanceof Error ? erroSkusMsg.message : 'erro desconhecido'}
    </p>;
  }
  if (!linhas) return <p className="text-sm text-muted-foreground">Carregando SKUs…</p>;

  const rotuloDe = (codigo: string): Rotulo | undefined => {
    const doProduto = skus?.find((x) => x.codigo === codigo);
    if (doProduto) return { cor: doProduto.cor, tamanho: doProduto.tamanho, estoque: doProduto.estoque };
    const o = skusOrg.find((x) => x.codigo === codigo);
    return o ? { cor: o.cor, tamanho: o.tamanho, estoque: o.estoque } : undefined;
  };

  // Selo enquanto o valor da linha é o custo cadastrado que veio como padrão (editou → some).
  const doCadastro = (l: LinhaEstado) => {
    const s = skus?.find((x) => x.codigo === l.codigo);
    if (!s || l.travada) return false;
    const padrao = custoPadraoSku({ custo: s.custo, saldo: s.estoque }, prova, custoDef);
    return padrao !== custoDef && l.custoPrecificacao === padrao;
  };
  const alterar = (codigo: string, parte: Partial<LinhaEstado>) =>
    setLinhas(linhas.map((l) => (l.codigo === codigo ? { ...l, ...parte } : l)));
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const soma = linhas.reduce((s, l) => s + (l.quantidade || 0), 0);
  const restante = (q.ok ? q.quantidade : 0) - soma;
  const qtdValida = /^\d+$/.test(qtdNova) && Number(qtdNova) >= 1 && Number(qtdNova) <= restante;

  // O SKU nasceu com a ref da nota (já no ledger): entra travado no estado E no buffer local, que só
  // é semeado uma vez. Código vindo da edge (8 dígitos) — é o que está na ref do ledger.
  const aoCriarVariacao = (codigos: string[], qtd: number) => {
    const codigo = codigos[0];
    if (!codigo) {
      toast.error('Variação criada, mas não foi possível incluí-la na distribuição. Feche e reabra a importação desta nota.');
      return;
    }
    atualizar((s) => travarLinhaNova(s, d.nItem, codigo, qtd, custoDef));
    setLinhas((prev) => [...(prev ?? []).filter((l) => l.codigo !== codigo),
      { codigo, quantidade: qtd, custoPrecificacao: custoDef, travada: true }]);
    qc.invalidateQueries({ queryKey: QK.variacoesEstoque(d.codigoPai!) });
    setFaltante(null); setQtdNova('');
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      {d.avisoSugestao && (
        <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{d.avisoSugestao}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{item.nItem}. {item.xProd}</p>
        <p className={`text-sm ${q.ok && soma === q.quantidade ? 'text-success' : 'text-muted-foreground'}`}>
          {soma} de {q.ok ? q.quantidade : '?'} unidades
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead><TableHead>Cor</TableHead><TableHead>Tamanho</TableHead>
            <TableHead className="text-right">Saldo</TableHead><TableHead>Quantidade</TableHead><TableHead>Custo (R$)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => {
            const r = rotuloDe(l.codigo);
            return (
              <TableRow key={l.codigo}>
                <TableCell>{l.codigo}</TableCell>
                <TableCell>{r?.cor ?? '—'}</TableCell>
                <TableCell>{r?.tamanho ?? '—'}</TableCell>
                <TableCell className="text-right">{r?.estoque ?? '—'}</TableCell>
                <TableCell>
                  <Input
                    type="number" min={0} step={1} className="w-24" aria-label={`Quantidade ${l.codigo}`}
                    value={l.quantidade} disabled={l.travada}
                    onChange={(ev) => alterar(l.codigo, { quantidade: Math.round(num(ev.target.value)) })}
                  />
                </TableCell>
                <TableCell>
                  <CampoCusto
                    valor={l.custoPrecificacao} aria-label={`Custo ${l.codigo}`}
                    onChange={(v) => alterar(l.codigo, { custoPrecificacao: v })}
                  />
                  {/* D-9: aquisição ao lado do custo de precificação; o selo nunca deixa o custo do cadastro silencioso. */}
                  <p className="mt-1 text-xs text-muted-foreground">Aquisição R$ {fmtBRLSemSimbolo(custoDef)}/un</p>
                  {doCadastro(l) && <Badge variant="secondary" className="mt-1">Custo do cadastro (1ª entrada)</Badge>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setBuscando(!buscando)}>+ SKU de outro produto</Button>
        <Button
          size="sm" variant="outline"
          onClick={() => setLinhas(linhas.map((l) => ({ ...l, custoPrecificacao: linhas[0]?.custoPrecificacao ?? custoDef })))}
        >
          Repetir custo em todos
        </Button>
        <Button
          size="sm" variant="link" disabled={!produto}
          onClick={() => setFaltante(acaoVariacaoFaltante({ publicado: produto?.mlItemId != null }, isAdmin))}
        >
          Falta um tamanho/cor?
        </Button>
      </div>
      {faltante && faltante !== 'adicionar-publicado' && (
        <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{MSG_FALTANTE[faltante]}</p>
      )}
      {faltante === 'adicionar-publicado' && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          {restante <= 0 ? (
            <p role="status">Todas as unidades deste item já estão distribuídas. Reduza a quantidade de um SKU para liberar peças para o tamanho/cor novo.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span>Peças da nota para o tamanho/cor novo (até {restante})</span>
                <Input
                  type="number" min={1} max={restante} step={1} className="w-28" aria-label="Peças do tamanho/cor novo"
                  value={qtdNova} onChange={(ev) => setQtdNova(ev.target.value)}
                />
              </label>
              <Button size="sm" disabled={!qtdValida} onClick={() => setQtdNoDialog(Number(qtdNova))}>Continuar</Button>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => { setFaltante(null); setQtdNova(''); }}>Cancelar</Button>
        </div>
      )}
      {qtdNoDialog != null && (
        <DialogAdicionarVariacaoRoteador
          produto={produto} onFechar={() => setQtdNoDialog(null)}
          refNota={`nfe:${e.nota.chave}:${d.nItem}`} estoqueFixo={qtdNoDialog}
          onConcluido={({ codigos }) => aoCriarVariacao(codigos, qtdNoDialog)}
        />
      )}
      {buscando && (
        <div className="space-y-1">
          <Input placeholder="Buscar SKU em qualquer produto" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
          <ul className="max-h-40 overflow-auto rounded-md border text-sm">
            {erroOrg && <li role="alert" className="p-2 text-destructive">
              Não foi possível carregar os SKUs: {erroOrgMsg instanceof Error ? erroOrgMsg.message : 'erro desconhecido'}
            </li>}
            {!erroOrg && opcoes.length === 0 && <li className="p-2 text-muted-foreground">Nenhum SKU encontrado.</li>}
            {opcoes.map((o) => (
              <li key={o.codigo}>
                <button
                  type="button" className="w-full px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => {
                    setLinhas([...linhas, { codigo: o.codigo, quantidade: 0, custoPrecificacao: custoDef, codigoPai: o.codigoPai }]);
                    setBuscando(false); setBusca('');
                  }}
                >
                  {o.rotulo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Custo com 2 casas ao semear ("14.50"); enquanto o operador digita, o texto dele não é reformatado. */
function CampoCusto({ valor, onChange, ...rest }: { valor: number; onChange: (v: number) => void; 'aria-label': string }) {
  const [txt, setTxt] = useState(valor.toFixed(2));
  const atual = Number.isFinite(Number(txt)) ? Number(txt) : 0;
  if (atual !== valor) setTxt(valor.toFixed(2)); // mudança externa (semeadura, "Repetir custo")
  return (
    <Input type="number" min={0} step={0.01} className="w-28" value={txt} {...rest}
      onChange={(ev) => { setTxt(ev.target.value); onChange(Number.isFinite(Number(ev.target.value)) ? Number(ev.target.value) : 0); }} />
  );
}

export function EtapaDistribuicao({ e, atualizar }: { e: EstadoImportacao; atualizar: Atualizar }) {
  return (
    <div className="space-y-3">
      {e.decisoes.map((d) => d.codigoPai ? (
        <ItemDistribuicao
          key={`${d.nItem}-${d.codigoPai}-${d.fator}`} e={e} atualizar={atualizar} d={d}
        />
      ) : (
        <p key={d.nItem} className="rounded-md border p-3 text-sm text-muted-foreground">
          Item {d.nItem}: escolha o produto na etapa anterior.
        </p>
      ))}
    </div>
  );
}
