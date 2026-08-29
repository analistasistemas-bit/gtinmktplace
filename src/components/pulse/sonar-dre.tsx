// Seção 6 do relatório da Análise PubliAI — a DRE (ADR-0148 + ADR-0149).
//
// Nenhum número nasce aqui: a decomposição vem de `montarDreSonar`, que delega a aritmética a
// `calcularSimulacaoML()` (D-15 da ADR-0141). Este arquivo é formulário e texto.
//
// Cinco PREÇOS de venda, cada um com a SUA cotação — nada é extrapolado, porque comissão e frete
// do ML têm degraus por faixa. O preço do buy-box não é um deles: não é obtenível (Spike 049).
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fetchAliquotas } from '@/lib/queries';
import { calcularTarifaML } from '@/lib/tarifa';
import type { ModalidadeML } from '@/lib/calculadora-ml';
import { NOME_MODALIDADE, precosDerivadosDre, type OrigemProduto } from '@/lib/dre-sonar';
import {
  capitalDoLote, montarCenariosDre, precosDosCenarios, type CenarioComDre,
} from '@/lib/dre-cenarios';
import { fmtBRL, parseNumeroPtBr } from '@/lib/formato';

/** Peso em kg com 3 casas: o cubado de uma caixa pequena vive na terceira (0,507 kg). */
function fmtKg(kg: number): string {
  return `${kg.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

/** Âncora da DRE: o anúncio cujo preço abre a conta. Mesma forma que o simulador de margem do
 *  Sonar já usa, para não existirem duas ideias de "produto de referência". */
export interface AncoraDre {
  id: string;
  nome: string;
  category_id: string | null;
  preco_referencia: number | null;
}

/** Preços observados no nicho, vindos da amostra. */
export interface PrecosDoNicho {
  maisBarato: number | null;
  medioDoNicho: number | null;
}

function Indisponivel({ motivo, compacto }: { motivo: string; compacto?: boolean }) {
  return (
    <div className={`flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 ${compacto ? 'p-2 text-xs' : 'p-3 text-sm'}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>
        <span className="font-medium">DRE indisponível</span> — {motivo}. Não calculamos com estimativa.
      </p>
    </div>
  );
}

/** Total de colunas numéricas da tabela (Preço, Comissão, Frete, Imposto, Custo, Lucro, Margem) —
 *  o colSpan da recusa precisa cobri-las todas, senão a mensagem some atrás de células vazias. */
const COLUNAS_NUMERICAS = 7;

function LinhaCenario({ c }: { c: CenarioComDre }) {
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        {c.rotulo}
        {/* Derivado de outra cotação, não observado no mercado (ADR-0149 D-3). */}
        {c.projecao && <span className="ml-1.5 text-xs text-muted-foreground">(projeção)</span>}
      </TableCell>
      {c.dre.estado === 'indisponivel' ? (
        <TableCell colSpan={COLUNAS_NUMERICAS}>
          <Indisponivel motivo={c.dre.motivo} compacto />
        </TableCell>
      ) : (
        <>
          <TableCell className="text-right tabular-nums font-medium">{fmtBRL(c.preco)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">−{fmtBRL(c.dre.comissao)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">−{fmtBRL(c.dre.frete)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">−{fmtBRL(c.dre.imposto)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">−{fmtBRL(c.dre.custoProduto)}</TableCell>
          <TableCell className={`text-right tabular-nums font-medium ${c.dre.lucro < 0 ? 'text-destructive' : 'text-foreground'}`}>
            {fmtBRL(c.dre.lucro)}
          </TableCell>
          <TableCell className={`text-right tabular-nums ${c.dre.lucro < 0 ? 'text-destructive' : 'text-foreground'}`}>
            {c.dre.margemPct.toFixed(1)}%
          </TableCell>
        </>
      )}
    </TableRow>
  );
}

export function SonarDre({ ancora, precos }: { ancora: AncoraDre | null; precos?: PrecosDoNicho }) {
  const [custoTexto, setCustoTexto] = useState('');
  const [origem, setOrigem] = useState<OrigemProduto | null>(null);
  const [margemAlvoTexto, setMargemAlvoTexto] = useState('');
  const [qtdTexto, setQtdTexto] = useState('');
  // Clássico ou Premium: muda a comissão e, por consequência, equilíbrio e preço-alvo (ver
  // `EntradaDreSonar.modalidade` em dre-sonar.ts). O frete é o mesmo nas duas — trocar não recota.
  const [modalidade, setModalidade] = useState<ModalidadeML>('classico');
  // D-16: sem pacote informado o ML cota 16×11×6 cm / 300 g e a proveniência nunca é `official`.
  const [pesoTexto, setPesoTexto] = useState('');
  const [alturaTexto, setAlturaTexto] = useState('');
  const [larguraTexto, setLarguraTexto] = useState('');
  const [comprimentoTexto, setComprimentoTexto] = useState('');

  const precoAncora = ancora?.preco_referencia ?? null;
  const categoria = ancora?.category_id ?? null;

  const { data: aliquotas } = useQuery({ queryKey: ['aliquotas'], queryFn: fetchAliquotas });

  // O pacote só existe quando os quatro campos estão preenchidos: cotar com três deles seria
  // completar o quarto com o padrão do ML — o palpite silencioso que a D-28 mata.
  const dimensoes = useMemo(() => {
    const g = parseNumeroPtBr(pesoTexto);
    const a = parseNumeroPtBr(alturaTexto);
    const l = parseNumeroPtBr(larguraTexto);
    const c = parseNumeroPtBr(comprimentoTexto);
    if (g == null || a == null || l == null || c == null) return null;
    return { alturaCm: a, larguraCm: l, comprimentoCm: c, pesoKg: g / 1000 };
  }, [pesoTexto, alturaTexto, larguraTexto, comprimentoTexto]);

  // O que vai para o ML usa gramas; o motor de margem usa kg. Uma conversão, num lugar só.
  const dimFrete = useMemo(
    () => (dimensoes == null ? null : {
      alturaCm: dimensoes.alturaCm,
      larguraCm: dimensoes.larguraCm,
      comprimentoCm: dimensoes.comprimentoCm,
      pesoGramas: Math.round(dimensoes.pesoKg * 1000),
    }),
    [dimensoes],
  );
  // Entra na chave: sem isto o react-query serve a cotação do pacote anterior quando o operador
  // corrige uma medida, e a tela mostra frete de uma caixa que ele já trocou.
  const chaveDim = dimFrete
    ? `${dimFrete.alturaCm}x${dimFrete.larguraCm}x${dimFrete.comprimentoCm},${dimFrete.pesoGramas}`
    : 'sem-dimensoes';

  // Passo 1: cotação da âncora. Só ela permite derivar equilíbrio e preço-alvo — não há como cotar
  // um preço antes de conhecê-lo.
  const { data: tarifaAncora, isLoading: cotandoAncora } = useQuery({
    queryKey: ['sonar', 'dre', 'tarifa', categoria, precoAncora, chaveDim],
    queryFn: () => calcularTarifaML(precoAncora!, categoria!, dimFrete),
    enabled: precoAncora != null && categoria != null && dimFrete != null,
  });

  const custoProduto = custoTexto.trim() === '' ? null : parseNumeroPtBr(custoTexto);
  const margemAlvoPct = margemAlvoTexto.trim() === '' ? null : parseNumeroPtBr(margemAlvoTexto);
  const quantidade = qtdTexto.trim() === '' ? null : parseNumeroPtBr(qtdTexto);
  // Memoizado porque é dependência dos useMemo abaixo: objeto novo a cada render os invalidaria
  // sempre, e o memo não memoizaria nada.
  const aliq = useMemo(
    () => (aliquotas ? { nacional: aliquotas.nacional, importado: aliquotas.importado } : null),
    [aliquotas],
  );

  const derivados = useMemo(
    () => (precoAncora == null ? { pontoEquilibrio: null, precoAlvo: null } : precosDerivadosDre({
      precoAnuncio: precoAncora, custoProduto, origem, aliquotas: aliq, dimensoes, modalidade,
      tarifa: tarifaAncora ?? null,
    }, margemAlvoPct)),
    [precoAncora, custoProduto, origem, aliq, dimensoes, modalidade, tarifaAncora, margemAlvoPct],
  );

  const cenarios = useMemo(() => precosDosCenarios({
    maisBarato: precos?.maisBarato ?? null,
    medioDoNicho: precos?.medioDoNicho ?? null,
    anuncioQueMaisVende: precoAncora,
    precoAlvo: derivados.precoAlvo,
    pontoEquilibrio: derivados.pontoEquilibrio,
  }), [precos, precoAncora, derivados]);

  // Passo 2: cada preço é recotado NO PRÓPRIO VALOR. É isto que corrige a extrapolação.
  const cotacoes = useQueries({
    queries: cenarios.map((c) => ({
      queryKey: ['sonar', 'dre', 'tarifa', categoria, c.preco, chaveDim],
      queryFn: () => calcularTarifaML(c.preco, categoria!, dimFrete),
      enabled: categoria != null && dimFrete != null,
    })),
  });

  if (ancora == null || precoAncora == null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Sem anúncio de referência com preço, não há receita para montar a DRE.
        </p>
      </Card>
    );
  }
  if (categoria == null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Este anúncio veio sem categoria do Mercado Livre, e a comissão depende dela — não dá para cotar.
        </p>
      </Card>
    );
  }

  const comDre = montarCenariosDre(
    cenarios,
    cenarios.map((c, i) => ({ preco: c.preco, tarifa: cotacoes[i]?.data ?? null })),
    { custoProduto, origem, aliquotas: aliq, dimensoes, modalidade },
  );

  // O bloco do lote usa o cenário da âncora — o preço que o operador está olhando.
  const daAncora = comDre.find((c) => c.chave === 'anuncio_que_mais_vende');
  const lote = daAncora?.dre.estado === 'calculada'
    ? capitalDoLote(quantidade, daAncora.dre.custoProduto, daAncora.dre.lucro)
    : null;

  const faltaEntrada = custoProduto == null || origem == null || dimensoes == null;
  const motivoDaFalta = custoProduto == null
    ? 'informe o custo do produto — sem ele não há lucro a calcular'
    : origem == null
      ? 'informe a origem do produto — a alíquota de imposto depende dela e não é presumida'
      : 'informe o peso e as dimensões do pacote — sem eles o frete sai de um pacote padrão e não vale como número oficial';
  const cotando = cotandoAncora || cotacoes.some((q) => q.isLoading);

  // Só existe cotação da âncora depois que ela responde — antes disso o rótulo fica genérico
  // (não crava 14%/18% às cegas; deriva do que o ML realmente devolveu para este anúncio).
  const pctComissao = tarifaAncora
    ? { classico: tarifaAncora.classico.percentual, premium: tarifaAncora.premium.percentual }
    : null;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">6. Dá lucro?</p>
          <p className="text-xs text-muted-foreground">
            Cinco preços de venda deste nicho, cada um cotado no Mercado Livre · {ancora.nome}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-muted-foreground">Modalidade do anúncio — muda a comissão</span>
          <div className="inline-flex gap-0.5 rounded-lg border p-0.5">
            {(['classico', 'premium'] as const).map((m) => (
              <Button key={m} type="button" size="sm" aria-pressed={modalidade === m}
                variant={modalidade === m ? 'default' : 'ghost'}
                onClick={() => setModalidade(m)}>
                {NOME_MODALIDADE[m]}{pctComissao && ` ${pctComissao[m]}%`}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Produto e negócio</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <label htmlFor="dre-custo" className="text-xs text-muted-foreground">Custo do produto</label>
            <Input id="dre-custo" inputMode="decimal" placeholder="por unidade"
              value={custoTexto} onChange={(e) => setCustoTexto(e.target.value)} />
          </div>
          <div className="space-y-1">
            {/* Origem não tem default: a alíquota depende dela e imposto não se presume (ADR-0055). */}
            <span className="text-xs text-muted-foreground">Origem</span>
            <RadioGroup className="flex gap-3 pt-1" value={origem ?? ''}
              onValueChange={(v) => setOrigem(v as OrigemProduto)}>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="nacional" id="dre-nacional" />
                <label htmlFor="dre-nacional" className="text-sm">Nacional</label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="importado" id="dre-importado" />
                <label htmlFor="dre-importado" className="text-sm">Importado</label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <label htmlFor="dre-margem" className="text-xs text-muted-foreground">Margem desejada (%)</label>
            <Input id="dre-margem" inputMode="decimal" placeholder="opcional"
              value={margemAlvoTexto} onChange={(e) => setMargemAlvoTexto(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="dre-qtd" className="text-xs text-muted-foreground">Quantidade do lote</label>
            <Input id="dre-qtd" inputMode="numeric" placeholder="opcional"
              value={qtdTexto} onChange={(e) => setQtdTexto(e.target.value)} />
          </div>
        </div>

        <Separator />

        {/* D-16: o pacote é do operador, não do ML. Os quatro são obrigatórios — o frete cobrado sai
            do maior entre peso físico e cubado, e cotar com um pacote padrão daria número oficial
            sobre uma caixa que não existe. */}
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Pacote (frete)</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <label htmlFor="dre-peso" className="text-xs text-muted-foreground">Peso do pacote (g)</label>
            <Input id="dre-peso" inputMode="decimal" placeholder="ex.: 950"
              value={pesoTexto} onChange={(e) => setPesoTexto(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="dre-altura" className="text-xs text-muted-foreground">Altura (cm)</label>
            <Input id="dre-altura" inputMode="decimal" placeholder="ex.: 18"
              value={alturaTexto} onChange={(e) => setAlturaTexto(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="dre-largura" className="text-xs text-muted-foreground">Largura (cm)</label>
            <Input id="dre-largura" inputMode="decimal" placeholder="ex.: 13"
              value={larguraTexto} onChange={(e) => setLarguraTexto(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="dre-comprimento" className="text-xs text-muted-foreground">Comprimento (cm)</label>
            <Input id="dre-comprimento" inputMode="decimal" placeholder="ex.: 13"
              value={comprimentoTexto} onChange={(e) => setComprimentoTexto(e.target.value)} />
          </div>
        </div>
      </div>

      {faltaEntrada ? (
        <Indisponivel motivo={motivoDaFalta} />
      ) : cotando ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> cotando cada preço no Mercado Livre…
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cenário</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="text-right">Frete</TableHead>
                <TableHead className="text-right">Imposto</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead className="text-right">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comDre.map((c) => <LinhaCenario key={c.chave} c={c} />)}
            </TableBody>
          </Table>

          {/* D-16: a seção 6 é dona do peso. O ML cobra pelo MAIOR entre físico e cubado, então
              uma caixa grande e vazia paga frete de caixa cheia — é a informação que decide
              embalagem. Secundária à tabela acima: por isso o tom mais discreto. */}
          {daAncora?.dre.estado === 'calculada' && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums">
                peso físico <span className="font-medium text-foreground">{fmtKg(dimensoes!.pesoKg)}</span>
              </span>
              <span className="tabular-nums">
                peso volumétrico <span className="font-medium text-foreground">{fmtKg(daAncora.dre.peso.pesoCubadoKg)}</span>
                {' '}({alturaTexto}×{larguraTexto}×{comprimentoTexto} ÷ 6000)
              </span>
              <span className="tabular-nums">
                peso taxável <span className="font-medium text-foreground">{fmtKg(daAncora.dre.peso.pesoUtilizadoKg)}</span>
                {' '}— {daAncora.dre.peso.pesoCubadoKg > dimensoes!.pesoKg ? 'o volumétrico venceu' : 'o físico venceu'}
              </span>
              <span>
                {daAncora.dre.vendedorPagaFrete
                  ? `neste preço o frete é seu: ${fmtBRL(daAncora.dre.frete)}`
                  : 'neste preço quem paga o frete é o comprador'}
              </span>
            </div>
          )}

          {lote && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                Comprando {quantidade} unidades, ao preço do anúncio que mais vende:
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span className="tabular-nums">
                  capital imobilizado <span className="font-medium">{fmtBRL(lote.capitalImobilizado)}</span>
                </span>
                <span className="tabular-nums">
                  {lote.lucroTotal < 0 ? 'prejuízo do lote' : 'lucro do lote'}{' '}
                  <span className={`font-medium ${lote.lucroTotal < 0 ? 'text-destructive' : ''}`}>
                    {fmtBRL(lote.lucroTotal)}
                  </span>
                </span>
                {/* NÃO é um "ROI" novo: a quantidade cancela na razão, então este percentual é o
                    retorno sobre o custo — o mesmo do markup (ADR-0149 D-4). */}
                {lote.retornoSobreCustoPct != null && (
                  <span className="tabular-nums text-muted-foreground">
                    retorno sobre o custo {lote.retornoSobreCustoPct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Zeros declarados, não silenciosos (ADR-0148 D-5). */}
          <p className="text-xs text-muted-foreground">
            Não inclui: custos fixos do seu negócio, custos variáveis por venda, rebate ou
            bonificação do fornecedor, nem custos de compra do lote (frete, importação).
          </p>
        </>
      )}
    </Card>
  );
}
