// Cadastro em grade (spec 2026-09-19, ADR-0166): tela DEDICADA a roupa/calçado, fisicamente
// separada do cadastro normal — `dialog-cadastro-produto.tsx` continua sem nenhuma pergunta de
// grade. Aqui toda linha tem cor E tamanho, sempre, e os 6 campos que na prática são iguais para
// a grade inteira (preço, custo e as 4 dimensões) são preenchidos UMA vez no cabeçalho e
// herdados por linha, com cadeado individual.
//
// Fluxo completo: escolha do tipo (só com 2 tipos habilitados), cabeçalho + seleção de
// cor/tamanho + grade, etapa fiscal (só com o módulo fiscal) e etapa de fotos. O cadastro em si
// é o MESMO `useCadastroProduto` do dialog normal — idempotência, retry e upload em lote não
// têm segunda implementação aqui.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { useTiposProdutoHabilitados } from '@/hooks/useTiposProdutoHabilitados';
import { UNIDADES_FISCAIS } from '@/lib/fiscal';
import { TIPOS_PRODUTO, type TipoProdutoId } from '@/lib/tipos-produto';
import { LIMITE_VARIACOES_GERADAS, numeracaoPublicavel, opcoesDeTamanho } from '@/lib/tamanhos';
import {
  aplicarEmMassa, chaveGrade, novaLinhaGrade, ordenarEixos, reconciliarGrade, resolverLinha,
  totalDaGrade,
  type CampoHerdavel, type CamposHerdaveis, type LinhaGrade, type OpcoesMassa,
} from '@/lib/cadastro-grade';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { CORES_POPULARES, GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { ROTULOS } from '@/components/estoque/linha-grade-form';
import { MatrizGrade } from '@/components/estoque/matriz-grade';
import { erroCampo, parseNum, type LinhaVariacao } from '@/components/estoque/linha-variacao-form';
import {
  EtapaFiscalForm, fiscalVazio, fiscalCompleto, type FiscalForm,
} from '@/components/estoque/etapa-fiscal-form';
import { EtapaFotos } from '@/components/estoque/etapa-fotos';
import {
  CAMPOS_NUMERICOS, montarPayload, useCadastroProduto, useSugestaoNcm,
} from '@/components/estoque/use-cadastro-produto';
import { cn } from '@/lib/utils';

const CABECALHO_VAZIO: CamposHerdaveis = {
  preco: '', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
};

type Genero = 'masculino' | 'feminino' | 'unissex' | '';

const GENEROS: { valor: Exclude<Genero, ''>; rotulo: string }[] = [
  { valor: 'masculino', rotulo: 'Masculino' },
  { valor: 'feminino', rotulo: 'Feminino' },
  { valor: 'unissex', rotulo: 'Unissex' },
];

/** Ação destrutiva pendente de confirmação (desmarcar um eixo com dado, trocar de tipo). */
interface Confirmacao { titulo: string; texto: string; rotulo: string; acao: () => void }

export function DialogCadastroGrade({ aberto, onFechar }: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const { data: modulos } = useModulosHabilitados();
  const fiscalAtivo = !!modulos?.includes('fiscal');
  const { data: tiposProduto } = useTiposProdutoHabilitados();
  const tipos = tiposProduto ?? [];
  // NÃO inicializar o state a partir de `tipos[0]`. `useTiposProdutoHabilitados` é react-query:
  // no PRIMEIRO render `data` é `undefined`, e este dialog fica MONTADO permanentemente em
  // `Estoque.tsx` (mesmo padrão do dialog atual — ele não desmonta ao fechar). Um
  // `useState(tipos.length === 1 ? tipos[0] : null)` leria `[]`, nasceria `null` e nunca
  // acompanharia a query chegando depois: uma org com 1 tipo ficaria presa num passo 0 vazio,
  // sem botão nenhum pra clicar. O state guarda SÓ a escolha MANUAL; o tipo efetivo é DERIVADO
  // a cada render, então ele se corrige sozinho quando `data` chega.
  const [tipoManual, setTipoManual] = useState<TipoProdutoId | null>(null);
  const tipoEscolhido: TipoProdutoId | null =
    tipos.length === 1 ? (tipos[0] as TipoProdutoId) : tipoManual;
  const gruposTamanho = opcoesDeTamanho(tipoEscolhido ? [tipoEscolhido] : []);

  const [nomePai, setNomePai] = useState('');
  const [descricaoPai, setDescricaoPai] = useState('');
  const [unidade, setUnidade] = useState('UN');
  const [fornecedor, setFornecedor] = useState('');
  // Sem default silencioso: origem define a alíquota de imposto (ADR-0055) e o operador precisa
  // escolher. `null` mantém o botão de salvar travado.
  const [origem, setOrigem] = useState<'nacional' | 'importado' | null>(null);
  // Gênero é INCONDICIONALMENTE obrigatório aqui (spec §2, passo 1): toda linha desta tela tem
  // tamanho, então a trava condicional do dialog antigo deixa de fazer sentido.
  const [genero, setGenero] = useState<Genero>('');
  const [cabecalho, setCabecalho] = useState<CamposHerdaveis>(CABECALHO_VAZIO);
  const [cores, setCores] = useState<Set<string>>(new Set());
  const [tamanhos, setTamanhos] = useState<Set<string>>(new Set());
  const [removidas, setRemovidas] = useState<Set<string>>(new Set());
  const [linhas, setLinhas] = useState<LinhaGrade[]>([]);
  const [fotoPorCor, setFotoPorCor] = useState<Record<string, File | null>>({});
  const [fotosCapa, setFotosCapa] = useState<Record<'capa' | 'capa2' | 'capa3', File | null>>({
    capa: null, capa2: null, capa3: null,
  });
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null);
  // ADR-0135 D-9: etapa intermediária, só existe com o módulo fiscal ativo.
  const [etapaFiscal, setEtapaFiscal] = useState(false);
  const [fiscal, setFiscal] = useState<FiscalForm>(fiscalVazio());

  const api = useCadastroProduto({ aberto });
  // Alias de leitura, sem dependência de nada — movido para antes do `useEffect` de reconciliação
  // logo abaixo, que lê `resultado` na guarda central.
  const resultado = api.resultado;
  // A MESMA sugestão de NCM do dialog normal — o hook, nunca o efeito copiado. Duplicar as ~15
  // linhas da flag `ignore` aqui reintroduziria o bug F1 (resposta de um produto aplicada em
  // outro) nesta tela, sem nenhum teste acusar.
  const { sugestao: sugestaoNcm, carregando: carregandoSugestao } =
    useSugestaoNcm({ aberto, etapaFiscal, nome: nomePai, descricao: descricaoPai });

  // Reset ao FECHAR (mesmo padrão do dialog atual). `tipoManual` entra junto: senão reabrir numa
  // org de 2 tipos pularia o passo 0 e cairia direto no tipo da sessão anterior.
  useEffect(() => {
    if (aberto) return;
    setTipoManual(null);
    setEtapaFiscal(false);
    setFiscal(fiscalVazio());
    setNomePai(''); setDescricaoPai(''); setUnidade('UN'); setFornecedor('');
    setOrigem(null); setGenero('');
    setCabecalho(CABECALHO_VAZIO);
    setCores(new Set()); setTamanhos(new Set()); setRemovidas(new Set());
    setLinhas([]); setFotoPorCor({});
    setFotosCapa({ capa: null, capa2: null, capa3: null });
    setTentouSalvar(false);
    setConfirmar(null);
  }, [aberto]);

  // A seleção JÁ É a ação: nenhum botão "Gerar". `reconciliarGrade` é pura e devolve o diff —
  // aqui só aplicamos. Ordenar por `ordem` mantém a lista agrupada por cor mesmo depois de o
  // operador marcar e desmarcar várias vezes.
  //
  // `linhas` NÃO entra nas dependências: o efeito chama `setLinhas`, e uma dependência em
  // `linhas` faria cada clique disparar um segundo ciclo que só pararia por um `if` de guarda —
  // trava não testada que o próximo a editar o efeito remove sem perceber. Ler o valor anterior
  // dentro do updater e devolver `prev` inalterado usa o bail-out do próprio React, e o loop
  // deixa de ser possível por construção.
  useEffect(() => {
    // TRAVA CENTRAL (Global Constraint 3), 7º ponto de entrada. `tipoEscolhido` entra nas
    // dependências abaixo e vem de react-query: um refetch que mude os tipos da org recalcularia
    // `canonicos` → `ordenarEixos` → REORDENARIA `linhas`.
    //
    // `|| resultado`, não só `salvando`: a partir da resposta da edge, `linhas` é HISTÓRICO.
    // `EtapaFotos` casa `arquivoPorIndice(i) → resolvidas[i]` e `onPatchFotoLinha(i) → linhas[i]`
    // com `resultado.variacoes[i]`, e o único guard (`batem`) compara CONTAGEM, não ordem —
    // reordenar aqui manda a foto para o SKU errado, em silêncio. Guardar só `salvando` apenas
    // adiaria o estrago para o instante em que `salvando` volta a false E `resultado` é setado,
    // que é exatamente quando `EtapaFotos` monta: o pior momento possível.
    if (api.salvando || resultado) return;

    // A ordem canônica é DERIVADA aqui dentro, a partir de `tipoEscolhido` (primitivo). Pôr
    // `gruposTamanho` nas dependências rodaria o efeito a cada render — `opcoesDeTamanho` devolve
    // array NOVO sempre. Não entraria em loop (o bail-out do `return prev` segura), e é justamente
    // por isso que seria pior: mataria em silêncio a garantia que o comentário acima descreve.
    const canonicos = opcoesDeTamanho(tipoEscolhido ? [tipoEscolhido] : []).flatMap((g) => g.valores);
    const eixos = ordenarEixos(cores, tamanhos, { cores: CORES_POPULARES, tamanhos: canonicos });

    // Poda das exclusões ANTES do updater: é o único efeito colateral do ciclo e não pertence
    // dentro de um setState (que o React pode reexecutar).
    const podadas = reconciliarGrade(eixos.cores, eixos.tamanhos, removidas, []).removidas;
    if (podadas.size !== removidas.size) { setRemovidas(podadas); return; }

    setLinhas((prev) => {
      const r = reconciliarGrade(eixos.cores, eixos.tamanhos, removidas, prev);
      // `prev` inalterado = bail-out do React: sem novo render, sem ciclo.
      if (r.novas.length === 0 && r.remover.length === 0) return prev;
      const fora = new Set(r.remover);
      const todas = [
        ...prev.filter((l) => !fora.has(chaveGrade(l.cor, l.tamanho))),
        ...r.novas.map((c) => novaLinhaGrade(c.cor, c.tamanho)),
      ];
      const pos = new Map(r.ordem.map((k, i) => [k, i]));
      return todas.sort((a, b) => (
        (pos.get(chaveGrade(a.cor, a.tamanho)) ?? 0) - (pos.get(chaveGrade(b.cor, b.tamanho)) ?? 0)
      ));
    });
  }, [cores, tamanhos, removidas, tipoEscolhido, api.salvando, resultado]);

  /** Linha "tem dado" = apagá-la perderia algo que o operador digitou/escolheu. */
  function temDado(l: LinhaGrade): boolean {
    return l.gtin.trim() !== '' || l.estoqueInicial.trim() !== ''
      || Object.keys(l.overrides).length > 0 || 'foto' in l;
  }

  function mudarCores(proximas: Set<string>) {
    if (api.salvando) return;
    // Guarda central: cobre o chip, o Enter no campo de texto livre (gerador-variacoes.tsx) e
    // qualquer caminho futuro de entrada — nenhum deles chega às linhas sem passar por aqui.
    if (totalDaGrade([...proximas], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS) return;
    const saindo = [...cores].filter((c) => !proximas.has(c));
    const afetadas = linhas.filter((l) => saindo.includes(l.cor));
    if (afetadas.some(temDado)) {
      setConfirmar({
        titulo: 'Remover as linhas dessa cor?',
        texto: `${afetadas.length} linha(s) já têm dado preenchido e serão apagadas.`,
        rotulo: 'Remover mesmo assim',
        acao: () => setCores(proximas),
      });
      return;
    }
    setCores(proximas);
  }

  function mudarTamanhos(proximos: Set<string>) {
    if (api.salvando) return;
    // Mesma guarda central de `mudarCores`, por simetria.
    if (totalDaGrade([...cores], [...proximos], removidas) > LIMITE_VARIACOES_GERADAS) return;
    const saindo = [...tamanhos].filter((t) => !proximos.has(t));
    const afetadas = linhas.filter((l) => saindo.includes(l.tamanho));
    if (afetadas.some(temDado)) {
      setConfirmar({
        titulo: 'Remover as linhas desse tamanho?',
        texto: `${afetadas.length} linha(s) já têm dado preenchido e serão apagadas.`,
        rotulo: 'Remover mesmo assim',
        acao: () => setTamanhos(proximos),
      });
      return;
    }
    setTamanhos(proximos);
  }

  // Exclusão manual é permanente ENQUANTO os dois eixos continuarem marcados — é o que permite a
  // grade parcial. Desmarcar o eixo inteiro limpa a memória (`podar`, em cadastro-grade.ts).
  //
  // A guarda `api.salvando` é a TRAVA CENTRAL (mesmo desenho do fix f4a6df68): toda função que
  // muda contagem/ordem de `linhas` abre com ela. O `disabled` do botão é affordance — quem
  // garante o casamento posicional é este `return`.
  function removerLinha(cor: string, tamanho: string) {
    if (api.salvando) return;
    setRemovidas((prev) => new Set(prev).add(chaveGrade(cor, tamanho)));
    setLinhas((prev) => prev.filter((x) => !(x.cor === cor && x.tamanho === tamanho)));
  }

  // Task 6 preenche o corpo; a trava central já nasce aqui porque ela é a invariante, não o
  // recurso.
  function reincluirLinha(cor: string, tamanho: string) {
    if (api.salvando) return;
    setRemovidas((prev) => {
      const next = new Set(prev);
      next.delete(chaveGrade(cor, tamanho));
      return next;
    });
  }

  // Task 8 liga a UI; a função já é a definitiva.
  function aplicarMassa(opts: OpcoesMassa) {
    if (api.salvando) return;
    setLinhas((prev) => aplicarEmMassa(prev, opts));
  }

  function trocarTipo() {
    const acao = () => {
      if (api.salvando) return;
      setTipoManual(null);
      setCores(new Set()); setTamanhos(new Set()); setRemovidas(new Set());
      setLinhas([]); setFotoPorCor({});
    };
    if (linhas.length === 0) { acao(); return; }
    setConfirmar({
      titulo: 'Trocar o tipo de produto?',
      texto: `As ${linhas.length} linha(s) da grade serão apagadas — os tamanhos de roupa e de calçado não são os mesmos.`,
      rotulo: 'Trocar mesmo assim',
      acao,
    });
  }

  function patchLinha(clientId: string, patch: Partial<LinhaGrade>) {
    setLinhas((prev) => prev.map((x) => (x.clientId === clientId ? { ...x, ...patch } : x)));
  }

  function patchOverride(clientId: string, campo: CampoHerdavel, valor: string) {
    setLinhas((prev) => prev.map((x) => (
      x.clientId === clientId ? { ...x, overrides: { ...x.overrides, [campo]: valor } } : x
    )));
  }

  function voltarAHerdar(clientId: string, campo: CampoHerdavel) {
    setLinhas((prev) => prev.map((x) => {
      if (x.clientId !== clientId) return x;
      // Remover a CHAVE: `resolverLinha` decide por `campo in overrides`, então gravar
      // `undefined` deixaria o campo resolvendo para undefined em vez de voltar ao cabeçalho.
      const { [campo]: _removido, ...resto } = x.overrides;
      return { ...x, overrides: resto };
    }));
  }

  // Cada chip pergunta "e se eu marcasse este?". `totalDaGrade` é barato (duas multiplicações e
  // uma varredura das exclusões), então ~33 chamadas por render não precisam de memo.
  const coresBloqueadas = new Set(
    CORES_POPULARES.filter((c) => !cores.has(c)
      && totalDaGrade([...cores, c], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS),
  );
  const tamanhosBloqueados = new Set(
    gruposTamanho.flatMap((g) => g.valores).filter((t) => !tamanhos.has(t)
      && totalDaGrade([...cores], [...tamanhos, t], removidas) > LIMITE_VARIACOES_GERADAS),
  );
  // Mesmo critério para "Adicionar cor", medido com uma cor hipotética que nunca colide com uma
  // cor real (o `\u0001` não é digitável no campo).
  const bloquearNovaCor =
    totalDaGrade([...cores, '\u0001hipotetica'], [...tamanhos], removidas) > LIMITE_VARIACOES_GERADAS;

  const avisoTamanho = (v: string) => (
    tipoEscolhido === 'calcado' && !numeracaoPublicavel(v, genero)
      ? 'cadastrável, mas hoje não publica no Mercado Livre'
      : null
  );

  const resolvidas = linhas.map((l) => resolverLinha(cabecalho, fotoPorCor, l));
  // `ordenarEixos` é chamada de novo aqui (o efeito também chama). Duplicar uma função pura e
  // barata é mais seguro que um `useMemo` cujas dependências o próximo editor desalinha — e os
  // dois pontos de chamada TÊM de concordar, senão a matriz desenha colunas fora da ordem das
  // linhas. Não "otimizar" isto com estado.
  const eixos = ordenarEixos(cores, tamanhos, {
    cores: CORES_POPULARES,
    tamanhos: gruposTamanho.flatMap((g) => g.valores),
  });
  const unidades = resolvidas.reduce((s, r) => s + (parseNum(r.estoqueInicial) || 0), 0);
  const semFoto = resolvidas.filter((r) => !r.foto).length;

  const podeSalvar = !!nomePai.trim() && !!origem && !!genero && linhas.length > 0
    && resolvidas.every((r) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, r[c])));

  function submeter() {
    if (!origem || !genero) return;
    setTentouSalvar(true);
    // `resolvidas` é a MESMA lista que a tela mostra — o payload nunca resolve herança por conta
    // própria (spec §2: `resolverLinha` é a única fonte do valor efetivo).
    const variacoes: LinhaVariacao[] = resolvidas.map((r) => ({
      clientId: r.clientId, nome: r.cor, tamanho: r.tamanho, gtin: r.gtin,
      preco: r.preco, custo: r.custo, estoqueInicial: r.estoqueInicial,
      pesoGramas: r.pesoGramas, alturaCm: r.alturaCm, larguraCm: r.larguraCm,
      comprimentoCm: r.comprimentoCm, foto: r.foto,
    }));
    api.salvar(
      montarPayload(
        { nomePai, descricaoPai, unidade, fornecedor, origem, genero },
        variacoes, api.chaveCadastro, fiscalAtivo ? fiscal : undefined,
      ),
      { capa: fotosCapa, porLinha: resolvidas.map((r) => r.foto) },
    );
  }

  const passo0 = tipos.length > 1 && tipoEscolhido === null;
  // `M` conta o fluxo INTEIRO desde o primeiro render, para a numeração não mudar no meio do
  // caminho: grade + fotos, mais o passo 0 e a etapa fiscal quando existem.
  const totalEtapas = 2 + (fiscalAtivo ? 1 : 0) + (tipos.length > 1 ? 1 : 0);
  const etapaGrade = tipos.length > 1 ? 2 : 1;
  const etapaAtual = passo0 ? 1
    : resultado ? totalEtapas
      : etapaFiscal ? etapaGrade + 1 : etapaGrade;
  // Contagem divergente = retry idempotente devolveu o cadastro ORIGINAL da edge, que pode ter
  // outra quantidade de variações. É a mesma guarda de `subirLoteDeFotos`: sem ela a miniatura
  // (e o patch da foto) vão para o SKU errado, em silêncio.
  const batem = !!resultado && resolvidas.length === resultado.variacoes.length;

  const campoHerdavel = (campo: CampoHerdavel, obrigatorio = false) => {
    const { rotulo, prefixo, sufixo } = ROTULOS[campo];
    const id = `grade-cab-${campo}`;
    const erro = erroCampo(campo, cabecalho[campo]);
    return (
      <div key={campo} className="flex flex-col gap-1.5">
        {/* Rótulo PURO, sem sufixo de unidade e sem "da variação N": o cabeçalho é um campo só do
            produto inteiro. O `g`/`cm` continua como adorno visual dentro do campo. */}
        <span className="flex items-baseline gap-1 text-sm font-medium">
          <label htmlFor={id}>{rotulo}</label>
          {obrigatorio && <span className="text-destructive" aria-hidden="true">*</span>}
        </span>
        <div className="relative">
          {prefixo && (
            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
              {prefixo}
            </span>
          )}
          <Input
            id={id}
            className={cn(prefixo && 'pl-8', sufixo && 'pr-8')}
            value={cabecalho[campo]}
            onChange={(e) => setCabecalho((prev) => ({ ...prev, [campo]: e.target.value }))}
          />
          {sufixo && (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
              {sufixo}
            </span>
          )}
        </div>
        {erro && tentouSalvar && <span className="text-xs text-destructive">{erro}</span>}
      </div>
    );
  };

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => { if (!o) api.comConfirmacao(onFechar); }}>
        {/* sm: obrigatório: o default do componente é `sm:max-w-sm` e `max-w-3xl` sem o mesmo
            prefixo não vence a cascata (tailwind-merge trata como grupos diferentes). */}
        <DialogContent
          processando={api.ocupado}
          rotuloProcessando="Cadastrando a grade e enviando fotos"
          className="max-h-[90vh] sm:max-w-3xl overflow-y-auto"
        >
          <DialogHeader>
            {/* "em grade" é literal no título — é a âncora de que esta é a tela da grade, e não
                um detalhe que só aparece na dica de texto do seletor de cores. */}
            <DialogTitle>{`Cadastrar em grade · etapa ${etapaAtual} de ${totalEtapas}`}</DialogTitle>
            <DialogDescription>
              {resultado
                ? 'Envie a capa do produto e revise a foto de cada SKU. Depois é só ir para a Revisão.'
                : passo0
                  ? 'O tipo decide o eixo da grade: Tamanho (roupa) ou Numeração (calçado).'
                  : 'Preço, custo e dimensões são preenchidos uma vez e herdados por linha. O cadastro não publica nada — a publicação continua sendo feita na Revisão.'}
            </DialogDescription>
          </DialogHeader>

          {resultado ? (
            <EtapaFotos
              api={api}
              resultado={resultado}
              fotosCapa={fotosCapa}
              onEscolherCapa={(tipo, f) => setFotosCapa((prev) => ({ ...prev, [tipo]: f }))}
              arquivoPorIndice={(i) => (batem ? resolvidas[i]?.foto ?? null : null)}
              // O patch grava `foto` na LINHA (override individual), não em `fotoPorCor`: trocar
              // a foto aqui é decisão sobre AQUELE SKU, e `resolverLinha` já faz o override da
              // linha vencer a foto da cor.
              onPatchFotoLinha={(i, foto) => {
                if (!batem) return;
                const alvo = linhas[i];
                if (!alvo) return;
                setLinhas((prev) => prev.map((x) => (x.clientId === alvo.clientId ? { ...x, foto } : x)));
              }}
            />
          ) : etapaFiscal ? (
            <EtapaFiscalForm
              valor={fiscal}
              origem={origem}
              onMudar={(patch) => setFiscal((prev) => ({ ...prev, ...patch }))}
              sugestaoNcm={sugestaoNcm}
              carregandoSugestao={carregandoSugestao}
              onAplicarSugestao={() => sugestaoNcm && setFiscal((prev) => ({ ...prev, ncm: sugestaoNcm.ncm }))}
            />
          ) : passo0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {TIPOS_PRODUTO.filter((t) => tipos.includes(t.id)).map((t) => (
                <div key={t.id} className="flex flex-col gap-2 rounded-lg border p-4">
                  <Button type="button" variant="outline" onClick={() => setTipoManual(t.id)}>
                    {t.nome}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t.descricao}</span>
                </div>
              ))}
            </div>
          ) : tipoEscolhido !== null ? (
            // Gate explícito por `tipoEscolhido !== null`, não por "não é passo 0": com a query
            // ainda em voo (`tipos.length === 0`) o dialog mostra só o título — não é o mesmo
            // estado de "org sem tipo nenhum" nem o de "escolher entre Roupa e Calçado".
            //
            // min-w-0: DialogContent é um `grid` sem `minmax(0,1fr)`, então o min-content do
            // conteúdo interno vazaria para a largura do dialog.
            <div className="flex min-w-0 flex-col gap-4">
              {tipos.length > 1 && (
                <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2">
                  <span className="text-sm">
                    Tipo: <strong className="font-medium">
                      {TIPOS_PRODUTO.find((t) => t.id === tipoEscolhido)?.nome}
                    </strong>
                  </span>
                  {/* Congelado durante o salvamento junto com o resto: `trocarTipo` apaga as
                      linhas, e a lista tem que ficar imóvel até o casamento posicional terminar. */}
                  <Button
                    type="button" variant="ghost" size="sm"
                    disabled={api.salvando}
                    onClick={trocarTipo}
                  >
                    Trocar tipo
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                {/* Asterisco FORA do <label> — ele é o único elemento associado ao Input via
                    `htmlFor`, e seu texto vira o nome acessível buscado por `getByLabelText`. */}
                <span className="flex items-baseline gap-1 text-sm font-medium">
                  <label htmlFor="grade-nome">Nome</label>
                  <span className="text-destructive" aria-hidden="true">*</span>
                </span>
                <Input id="grade-nome" value={nomePai} onChange={(e) => setNomePai(e.target.value)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="grade-desc" className="text-sm font-medium">Descrição</label>
                <Textarea
                  id="grade-desc" rows={3}
                  value={descricaoPai} onChange={(e) => setDescricaoPai(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="grade-unidade" className="text-sm font-medium">Unidade</label>
                  {/* Com o módulo fiscal ativo a coluna alimenta a NF-e — a edge recusa qualquer
                      valor fora de UNIDADES_FISCAIS (ADR-0135). */}
                  {fiscalAtivo ? (
                    <select
                      id="grade-unidade"
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={unidade}
                      onChange={(e) => setUnidade(e.target.value)}
                    >
                      {UNIDADES_FISCAIS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  ) : (
                    <Input id="grade-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="grade-fornecedor" className="text-sm font-medium">Fornecedor</label>
                  <Input id="grade-fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-baseline gap-1 text-sm font-medium">
                    <label htmlFor="grade-genero">Gênero</label>
                    <span className="text-destructive" aria-hidden="true">*</span>
                  </span>
                  <select
                    id="grade-genero"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={genero}
                    onChange={(e) => setGenero(e.target.value as Genero)}
                  >
                    <option value="">Selecione…</option>
                    {GENEROS.map((g) => <option key={g.valor} value={g.valor}>{g.rotulo}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Origem<span className="text-destructive"> *</span></span>
                <div className="flex items-center gap-4">
                  {(['nacional', 'importado'] as const).map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio" name="grade-origem" value={o}
                        checked={origem === o} onChange={() => setOrigem(o)}
                      />
                      {o === 'nacional' ? 'Nacional' : 'Importado'}
                    </label>
                  ))}
                </div>
                {!origem && (
                  <span className="text-xs text-muted-foreground">Define a alíquota de imposto — obrigatório.</span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Valores do produto</span>
                <span className="text-xs text-muted-foreground">
                  Preenchidos uma vez e herdados por toda a grade. Cada linha pode destravar o
                  campo que for exceção.
                </span>
                <div className="grid gap-3 sm:grid-cols-3">
                  {campoHerdavel('preco', true)}
                  {campoHerdavel('custo')}
                  {campoHerdavel('pesoGramas')}
                  {campoHerdavel('alturaCm')}
                  {campoHerdavel('larguraCm')}
                  {campoHerdavel('comprimentoCm')}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Fotos do produto</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['capa', 'capa2', 'capa3'] as const).map((tipo) => {
                    const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
                    return (
                      <div key={tipo} className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{rotulo}</span>
                        <CampoFoto
                          id={`grade-foto-${tipo}`}
                          ariaLabel={rotulo}
                          arquivo={fotosCapa[tipo]}
                          disabled={api.salvando}
                          opcional
                          onEscolher={(f) => setFotosCapa((prev) => ({ ...prev, [tipo]: f }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <GeradorVariacoes
                gruposTamanho={gruposTamanho}
                cores={cores}
                tamanhos={tamanhos}
                coresBloqueadas={coresBloqueadas}
                tamanhosBloqueados={tamanhosBloqueados}
                bloquearNovaCor={bloquearNovaCor}
                avisoTamanho={avisoTamanho}
                desabilitado={api.salvando}
                onMudarCores={mudarCores}
                onMudarTamanhos={mudarTamanhos}
              />

              {/* IRMÃO do GeradorVariacoes, nunca dentro dele: o teste do teto de 60 linhas
                  escopa as consultas ao container "Cores e tamanhos", e o custo de uma consulta
                  de testing-library cresce com o TAMANHO do container. 15 dropzones a mais lá
                  dentro empurrariam aquele teste para o timeout. */}
              {cores.size > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Foto por cor</span>
                  <span className="text-xs text-muted-foreground">
                    Uma foto por cor vale para todos os tamanhos daquela cor. A linha que precisar
                    de foto própria escolhe a dela na grade.
                  </span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {/* `id` por índice: uma cor personalizada ("Azul Marinho") tem espaço, e um
                        espaço no `id` quebra o par label/input. O nome acessível vem do
                        `ariaLabel`, não do `id`. */}
                    {[...cores].map((cor, i) => (
                      <div key={cor} className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{cor}</span>
                        <CampoFoto
                          id={`grade-foto-cor-${i}`}
                          ariaLabel={`Foto da cor ${cor}`}
                          arquivo={fotoPorCor[cor] ?? null}
                          disabled={api.salvando}
                          opcional
                          onEscolher={(f) => setFotoPorCor((prev) => ({ ...prev, [cor]: f }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {linhas.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Grade</span>
                    <span className="text-xs text-muted-foreground">
                      {linhas.length} SKUs · {unidades} unidades · {semFoto} sem foto
                    </span>
                  </div>
                  <MatrizGrade
                    linhas={linhas}
                    resolvidas={resolvidas}
                    cores={eixos.cores}
                    tamanhos={eixos.tamanhos}
                    removidas={removidas}
                    tentouSalvar={tentouSalvar}
                    desabilitado={api.salvando}
                    onMudarLinha={patchLinha}
                    onMudarOverride={patchOverride}
                    onVoltarAHerdar={voltarAHerdar}
                    onRemoverCelula={removerLinha}
                    onReincluirCelula={reincluirLinha}
                    onAplicarMassa={aplicarMassa}
                  />
                </div>
              )}

              <span className="text-xs text-muted-foreground">* obrigatório</span>
            </div>
          ) : null}

          <DialogFooter>
            {resultado ? (
              <>
                <Button variant="outline" onClick={() => api.comConfirmacao(onFechar)} disabled={api.ocupado}>
                  Fechar
                </Button>
                <Button
                  disabled={api.pendencias || api.ocupado}
                  onClick={() => api.comConfirmacao(() => { onFechar(); api.irParaRevisao(resultado.loteId); })}
                >
                  Ir para a Revisão
                </Button>
              </>
            ) : etapaFiscal ? (
              <>
                <Button variant="outline" onClick={() => setEtapaFiscal(false)} disabled={api.salvando}>
                  Voltar
                </Button>
                <Button onClick={submeter} disabled={!fiscalCompleto(fiscal, origem) || api.salvando}>
                  {api.salvando ? 'Cadastrando…' : 'Cadastrar'}
                </Button>
              </>
            ) : fiscalAtivo ? (
              <>
                <Button variant="outline" onClick={() => api.comConfirmacao(onFechar)} disabled={api.ocupado}>
                  Cancelar
                </Button>
                <Button onClick={() => setEtapaFiscal(true)} disabled={!podeSalvar}>Avançar</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => api.comConfirmacao(onFechar)} disabled={api.ocupado}>
                  Cancelar
                </Button>
                <Button onClick={submeter} disabled={!podeSalvar || api.salvando}>
                  {api.salvando ? 'Cadastrando…' : 'Cadastrar'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Uma confirmação só para toda ação destrutiva da grade — mesmo padrão já usado no
          projeto (familia-expanded.tsx, lote-card.tsx, dialog-cadastro-produto.tsx). */}
      <AlertDialog open={!!confirmar} onOpenChange={(o) => { if (!o) setConfirmar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{confirmar?.texto}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar aqui</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const c = confirmar; setConfirmar(null); c?.acao(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmar?.rotulo}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Guarda de saída destrutiva do lote de fotos, idêntica à do dialog normal: os `File` das
          fotos que falharam só existem em memória, e fechar sem confirmar os descartaria sem
          nenhum sinal. Separada da confirmação da grade acima porque o estado vive no hook. */}
      <AlertDialog open={!!api.confirmarFechar} onOpenChange={(o) => { if (!o) api.fecharConfirmacao(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar sem reenviar as fotos que falharam?</AlertDialogTitle>
            <AlertDialogDescription>
              {api.falhasFoto.length} foto(s) não foram enviadas ({api.falhasFoto.join(', ')}). Continuar
              descarta os arquivos escolhidos — você vai precisar selecioná-los de novo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar aqui</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const acao = api.confirmarFechar; api.fecharConfirmacao(); acao?.(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Fechar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
