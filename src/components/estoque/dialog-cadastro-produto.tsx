// E6b (ADR-0094, D-1/D-3): cadastro manual de produto, em duas etapas.
// Etapa 1 grava família + variações (a edge é a autoridade da validação) — capa e fotos por
// variação já são ESCOLHIDAS aqui, mas só existem `familiaId`/`variacaoId` para gravá-las
// depois que o cadastro responde, então o upload em lote roda logo em seguida, ainda dentro
// de `salvar()`. Etapa 2 mostra o progresso desse lote e mantém um upload manual avulso
// (capa / por variação) como caminho de correção/retry.
//
// O cadastro NÃO publica nada — a publicação continua sendo um ato explícito na Revisão.
//
// Limitação conhecida (spec §8.2): a foto escolhida aqui NÃO participa do enriquecimento por
// IA nesta entrega — `cadastrar-produto` enfileira `process-familia` antes de o upload em lote
// terminar, então a resolução de cor por Vision não enxerga a foto a tempo. Decisão consciente
// (opção A da §8.2), não bug; quem depende da cor por Vision resolve na Revisão.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle } from 'lucide-react';
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
import { UNIDADES_FISCAIS } from '@/lib/fiscal';
import {
  LinhaVariacaoForm, novaLinha, erroCampo, type LinhaVariacao,
} from '@/components/estoque/linha-variacao-form';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { EtapaFiscalForm, fiscalVazio, fiscalCompleto, type FiscalForm } from '@/components/estoque/etapa-fiscal-form';
import { EtapaFotos } from '@/components/estoque/etapa-fotos';
import {
  CAMPOS_NUMERICOS, montarPayload, useCadastroProduto, useSugestaoNcm,
} from '@/components/estoque/use-cadastro-produto';

// Prefill vindo da Viabilidade (T5, plano 2026-08-08). `origem` de propósito NÃO tem campo
// aqui — nem em tempo de compilação: é a trava da V-3 (ADR-0055/0107), rádio sem seleção e
// botão de salvar travado, mesmo com todo o resto preenchido. Não adicionar `origem` a este
// tipo.
export interface CadastroInicial {
  nomePai?: string;
  descricaoPai?: string;
  variacao?: Partial<Pick<LinhaVariacao,
    'gtin' | 'preco' | 'custo' | 'pesoGramas' | 'alturaCm' | 'larguraCm' | 'comprimentoCm'>>;
}

export function DialogCadastroProduto({ aberto, onFechar, inicial, onCadastrado }: {
  aberto: boolean;
  onFechar: () => void;
  /** Snapshot de pré-preenchimento vindo da Viabilidade (T5). Precisa ser um snapshot ESTÁVEL
   *  enquanto o diálogo está aberto — o chamador guarda em `useState` no clique. Se a
   *  identidade mudar a cada render do pai, o efeito de abertura reaplica o prefill por cima
   *  do que o operador já digitou. */
  inicial?: CadastroInicial;
  /** Chamado em `salvar()` logo após o sucesso do cadastro — permite ao chamador (ex.: a linha
   *  da Viabilidade) marcar o item como já cadastrado sem esperar nova análise. */
  onCadastrado?: () => void;
}) {
  const navigate = useNavigate();
  const { data: modulos } = useModulosHabilitados();
  const fiscalAtivo = !!modulos?.includes('fiscal');

  const [nomePai, setNomePai] = useState('');
  const [descricaoPai, setDescricaoPai] = useState('');
  const [unidade, setUnidade] = useState('UN');
  const [fornecedor, setFornecedor] = useState('');
  // Sem default silencioso: origem define a alíquota de imposto (ADR-0055) e o operador
  // precisa escolher. `null` mantém o botão de salvar travado.
  const [origem, setOrigem] = useState<'nacional' | 'importado' | null>(null);
  const [linhas, setLinhas] = useState<LinhaVariacao[]>([novaLinha()]);
  // Capa escolhida na etapa 1 — só existe familiaId depois do cadastro, então o upload real
  // só acontece dentro de subirLoteDeFotos, depois que `cadastrarProduto` devolve o resultado.
  const [fotosCapa, setFotosCapa] = useState<Record<'capa' | 'capa2' | 'capa3', File | null>>({
    capa: null, capa2: null, capa3: null,
  });
  // "Cadastrar" clicado ao menos uma vez — junto com o blur por campo, decide quando as
  // mensagens de erro inline aparecem (§5.4, Achado 4 da revisão final).
  const [tentouSalvar, setTentouSalvar] = useState(false);
  // ADR-0135 D-9: etapa intermediária, só existe com o módulo fiscal ativo.
  const [etapaFiscal, setEtapaFiscal] = useState(false);
  const [fiscal, setFiscal] = useState<FiscalForm>(fiscalVazio());

  const api = useCadastroProduto({ aberto, onCadastrado });
  const { sugestao: sugestaoNcm, carregando: carregandoSugestao } =
    useSugestaoNcm({ aberto, etapaFiscal, nome: nomePai, descricao: descricaoPai });

  useEffect(() => {
    if (aberto) return;
    setNomePai(''); setDescricaoPai(''); setUnidade('UN'); setFornecedor('');
    setOrigem(null); setLinhas([novaLinha()]);
    setFotosCapa({ capa: null, capa2: null, capa3: null });
    setTentouSalvar(false);
    setEtapaFiscal(false);
    setFiscal(fiscalVazio());
  }, [aberto]);

  // Efeito de ABERTURA (T5) — separado do reset acima, que roda ao FECHAR e fica intocado.
  // `origem` nunca é tocada aqui (V-3): CadastroInicial nem tem o campo. Sem `inicial`
  // (uso atual do Estoque.tsx) é no-op — comportamento byte a byte igual ao de hoje.
  useEffect(() => {
    if (!aberto || !inicial) return;
    setNomePai(inicial.nomePai ?? '');
    setDescricaoPai(inicial.descricaoPai ?? '');
    setLinhas([{ ...novaLinha(), ...inicial.variacao }]);
  }, [aberto, inicial]);

  const podeSalvar = !!nomePai.trim() && !!origem && linhas.length > 0
    && linhas.every((l) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, l[c])));

  // setTentouSalvar: por completude com a spec (§5.4, branch "b"). Na prática o botão só é
  // clicável quando `podeSalvar` já é true — ou seja, sem nenhum campo com erro — então este
  // ramo nunca revela mensagem nova hoje. Só passaria a importar se o gate `disabled={!podeSalvar}`
  // abaixo for removido.
  function submeter() {
    if (!origem) return;
    setTentouSalvar(true);
    api.salvar(
      montarPayload(
        {
          nomePai, descricaoPai, unidade, fornecedor, origem,
          // Revert do ADR-0166: esta tela não pergunta Gênero. O campo continua no payload (a
          // edge o aceita e o dialog de grade o preenche de verdade) — remover daqui a CHAVE, e
          // não só o valor, quebraria `dialog-cadastro-grade.tsx` sem nenhum teste acusar.
          genero: null,
        },
        linhas, api.chaveCadastro, fiscalAtivo ? fiscal : undefined,
      ),
      { capa: fotosCapa, porLinha: linhas.map((l) => l.foto) },
    );
  }

  const resultado = api.resultado;
  const divergencia = api.divergencia;

  return (
    <>
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) api.comConfirmacao(onFechar); }}>
      {/* sm: obrigatorio: o default do componente e `sm:max-w-sm`; sobrescrever com
          `max-w-3xl` sem o mesmo prefixo nao vence a cascata (tailwind-merge trata como
          grupos diferentes) e o dialog renderiza com 384px em qualquer desktop.
          3xl: as variacoes agora sao cards empilhados (nao uma tabela larga com scroll
          horizontal), entao a largura so precisa acomodar um card por vez. */}
      <DialogContent
        processando={api.ocupado}
        rotuloProcessando="Cadastrando produto e enviando fotos"
        className="max-h-[90vh] sm:max-w-3xl overflow-y-auto"
      >
        <DialogHeader>
          {/* Item 6 da auditoria: o dialog tem 2 etapas e nada indicava isso. Com o módulo
              fiscal ativo (ADR-0135 D-9) vira 3: dados+variações, fiscal, fotos. */}
          <DialogTitle>
            {resultado
              ? `Fotos do produto · etapa ${fiscalAtivo ? 3 : 2} de ${fiscalAtivo ? 3 : 2}`
              : fiscalAtivo
                ? `Cadastrar produto · etapa ${etapaFiscal ? 2 : 1} de 3`
                : 'Cadastrar produto · etapa 1 de 2'}
          </DialogTitle>
          <DialogDescription>
            {resultado
              // Item 1 da auditoria: se alguma foto já subiu com sucesso e não há falha
              // pendente, o texto não pode continuar pedindo "envie a capa" — o operador lê
              // isso como "o sistema perdeu minha foto".
              ? api.falhasFoto.length === 0 && api.fotosEnviadas.size > 0
                ? 'Fotos enviadas. Revise ou adicione as que faltam.'
                : 'Envie a capa do produto e uma foto por variação. Depois é só ir para a Revisão.'
              : 'O cadastro não publica nada — a publicação continua sendo feita na Revisão.'}
          </DialogDescription>
        </DialogHeader>

        {!resultado && etapaFiscal ? (
          <EtapaFiscalForm
            valor={fiscal}
            origem={origem}
            onMudar={(patch) => setFiscal((prev) => ({ ...prev, ...patch }))}
            sugestaoNcm={sugestaoNcm}
            carregandoSugestao={carregandoSugestao}
            onAplicarSugestao={() => sugestaoNcm && setFiscal((prev) => ({ ...prev, ncm: sugestaoNcm.ncm }))}
          />
        ) : !resultado ? (
          // min-w-0 obrigatorio: DialogContent e um `grid` sem `minmax(0,1fr)` (grid-cols nao
          // definido), entao o min-content do conteudo interno vaza pro dialog inteiro em vez
          // de ficar contido na largura do proprio wrapper. Sem isto, o dialog abre mais largo
          // que a viewport.
          <div className="flex min-w-0 flex-col gap-4">
            {divergencia && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  {divergencia.mensagem}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      onClick={() => { onFechar(); navigate(`/revisao/${divergencia.loteId}`); }}
                    >
                      Abrir na Revisão
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {/* Item 5 da auditoria: asterisco FORA do <label> — de propósito. Ele é o único
                  elemento associado ao Input via `htmlFor`, e seu texto vira o "nome acessível"
                  usado por `getByLabelText('Nome')` nos testes; um asterisco dentro dele
                  quebraria a correspondência exata. */}
              <span className="flex items-baseline gap-1 text-sm font-medium">
                <label htmlFor="cad-nome">Nome</label>
                <span className="text-destructive" aria-hidden="true">*</span>
              </span>
              <Input id="cad-nome" value={nomePai} onChange={(e) => setNomePai(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cad-desc" className="text-sm font-medium">Descrição</label>
              <Textarea id="cad-desc" rows={3} value={descricaoPai} onChange={(e) => setDescricaoPai(e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cad-unidade" className="text-sm font-medium">Unidade</label>
                {/* Com o módulo fiscal ativo, a coluna alimenta a NF-e — precisa ser uma das
                    UNIDADES_FISCAIS (a edge recusa qualquer outra, ADR-0135). Sem módulo, texto
                    livre — comportamento intacto. */}
                {fiscalAtivo ? (
                  <select
                    id="cad-unidade"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={unidade}
                    onChange={(e) => setUnidade(e.target.value)}
                  >
                    {UNIDADES_FISCAIS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                ) : (
                  <Input id="cad-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cad-fornecedor" className="text-sm font-medium">Fornecedor</label>
                <Input id="cad-fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Origem<span className="text-destructive"> *</span></span>
                <div className="flex items-center gap-4 pt-1.5">
                  {(['nacional', 'importado'] as const).map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio" name="origem" value={o}
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
                        id={`cad-foto-${tipo}`}
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

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Variações</span>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setLinhas((l) => [...l, novaLinha()])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar variação
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                Códigos gerados automaticamente ao salvar.
              </span>
              {/* A dúvida recorrente do operador é o produto SEM variação — a tela só mostra
                  "Variação 1" e nada diz que deixá-la sem cor é o caminho certo. Some quando ele
                  adiciona a 2ª linha: aí o produto tem variação de fato e a dica viraria ruído. */}
              {linhas.length === 1 && (
                <span className="text-xs text-muted-foreground">
                  <strong className="font-medium text-foreground">Produto sem variação?</strong>{' '}
                  Deixe só a Variação 1 e o campo <em>Cor / nome</em> em branco — sai um anúncio
                  simples, sem seletor de cor. A foto pode ficar só na Capa.
                </span>
              )}
              <div className="flex flex-col gap-3">
                {linhas.map((l, i) => (
                  <LinhaVariacaoForm
                    key={l.clientId}
                    linha={l}
                    indice={i}
                    podeRemover={linhas.length > 1}
                    tentouSalvar={tentouSalvar}
                    onMudar={(patch) => setLinhas((prev) => prev.map((x) => (x.clientId === l.clientId ? { ...x, ...patch } : x)))}
                    onRemover={() => setLinhas((prev) => prev.filter((x) => x.clientId !== l.clientId))}
                  />
                ))}
              </div>
            </div>
            {/* Item 5 da auditoria: Nome, Origem e Preço travam o botão "Cadastrar" sem
                nenhuma indicação visual de que são obrigatórios. */}
            <span className="text-xs text-muted-foreground">* obrigatório</span>
          </div>
        ) : (
          <EtapaFotos
            api={api}
            resultado={resultado}
            fotosCapa={fotosCapa}
            onEscolherCapa={(tipo, f) => setFotosCapa((prev) => ({ ...prev, [tipo]: f }))}
            // Mesmo casamento posicional de `subirLoteDeFotos`: só existe arquivo em memória para
            // mostrar a miniatura quando a contagem bate.
            arquivoPorIndice={(i) => (
              linhas.length === resultado.variacoes.length ? linhas[i]?.foto ?? null : null
            )}
            onPatchFotoLinha={(i, foto) => {
              if (linhas.length !== resultado.variacoes.length) return;
              setLinhas((prev) => prev.map((x, idx) => (idx === i ? { ...x, foto } : x)));
            }}
          />
        )}

        <DialogFooter>
          {!resultado && etapaFiscal ? (
            <>
              <Button variant="outline" onClick={() => setEtapaFiscal(false)} disabled={api.salvando}>Voltar</Button>
              <Button
                onClick={submeter}
                disabled={!fiscalCompleto(fiscal, origem) || api.salvando}
              >
                {api.salvando ? 'Cadastrando…' : 'Cadastrar'}
              </Button>
            </>
          ) : !resultado && fiscalAtivo ? (
            <>
              <Button variant="outline" onClick={() => api.comConfirmacao(onFechar)} disabled={api.ocupado}>Cancelar</Button>
              <Button onClick={() => setEtapaFiscal(true)} disabled={!podeSalvar}>Avançar</Button>
            </>
          ) : !resultado ? (
            <>
              <Button variant="outline" onClick={() => api.comConfirmacao(onFechar)} disabled={api.ocupado}>Cancelar</Button>
              <Button onClick={submeter} disabled={!podeSalvar || api.salvando}>
                {api.salvando ? 'Cadastrando…' : 'Cadastrar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => api.comConfirmacao(onFechar)} disabled={api.ocupado}>Fechar</Button>
              <Button
                disabled={api.pendencias || api.ocupado}
                onClick={() => api.comConfirmacao(() => { onFechar(); navigate(`/revisao/${resultado.loteId}`); })}
              >
                Ir para a Revisão
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Confirmação destrutiva (Achado 3, revisão final): lote de fotos com falha ainda em
        memória — fechar sem confirmar descartaria os `File` sem nenhum sinal de que a foto
        deveria existir. Padrão igual ao já usado em familia-expanded.tsx/lote-card.tsx. */}
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
