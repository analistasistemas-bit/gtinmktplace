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
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { supabase } from '@/lib/supabase';
import { effectiveOrgId, useSupportStore, canWrite } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import {
  cadastrarProduto, uploadFotoProduto, ProdutoJaExisteError, CadastroResultadoAmbiguoError,
  type ResultadoCadastro,
} from '@/lib/produtos-saldo';
import type { ProdutoEntrada, VariacaoEntrada } from '@/lib/produto-entrada';
import {
  LinhaVariacaoForm, novaLinha, parseNum, erroCampo, type LinhaVariacao,
} from '@/components/estoque/linha-variacao-form';
import { CampoFoto } from '@/components/estoque/campo-foto';

// Todo campo numérico que `erroCampo` valida — usado pelo gate `podeSalvar` para travar o
// submit se QUALQUER um, em QUALQUER linha, tiver erro (não só `preco`).
const CAMPOS_NUMERICOS = [
  'preco', 'custo', 'estoqueInicial', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm',
] as const;

// Normaliza `NaN` (texto inválido) para `null`. `podeSalvar` já garante que nenhum campo
// numérico de nenhuma linha tem erro antes de chegar aqui — NaN não deveria ocorrer; isto é
// só uma conversão defensiva de tipo, não a validação em si.
function numOuNull(v: string): number | null {
  const n = parseNum(v);
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

function montarPayload(
  pai: { nomePai: string; descricaoPai: string; unidade: string; fornecedor: string; origem: 'nacional' | 'importado' },
  linhas: LinhaVariacao[],
  chaveCadastro: string,
): ProdutoEntrada {
  const variacoes: VariacaoEntrada[] = linhas.map((l) => ({
    nome: l.nome.trim() || null,
    gtin: l.gtin.trim() || null,
    preco: numOuNull(l.preco) ?? 0,
    custo: numOuNull(l.custo),
    estoqueInicial: numOuNull(l.estoqueInicial),
    pesoGramas: numOuNull(l.pesoGramas),
    alturaCm: numOuNull(l.alturaCm),
    larguraCm: numOuNull(l.larguraCm),
    comprimentoCm: numOuNull(l.comprimentoCm),
  }));
  return {
    nomePai: pai.nomePai.trim(),
    descricaoPai: pai.descricaoPai.trim() || null,
    unidade: pai.unidade.trim() || null,
    fornecedor: pai.fornecedor.trim() || null,
    origem: pai.origem,
    chaveCadastro,
    variacoes,
  };
}

export function DialogCadastroProduto({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [nomePai, setNomePai] = useState('');
  const [descricaoPai, setDescricaoPai] = useState('');
  const [unidade, setUnidade] = useState('UN');
  const [fornecedor, setFornecedor] = useState('');
  // Sem default silencioso: origem define a alíquota de imposto (ADR-0055) e o operador
  // precisa escolher. `null` mantém o botão de salvar travado.
  const [origem, setOrigem] = useState<'nacional' | 'importado' | null>(null);
  const [linhas, setLinhas] = useState<LinhaVariacao[]>([novaLinha()]);
  // Só troca quando o último resultado foi CONHECIDO (sucesso, 409 ou validação): duplo
  // clique e retry de rede reusam a mesma chave, e a 2ª tentativa devolve o cadastro original
  // em vez de duplicar. Ver `resultadoAmbiguo` e o useEffect de reset abaixo.
  const [chaveCadastro, setChaveCadastro] = useState(() => crypto.randomUUID());
  // true só quando o último submit terminou em CadastroResultadoAmbiguoError (rede caiu, ou
  // erro que não é 409/validação) — a edge pode ou não ter gravado. Zera a cada novo submit.
  const [resultadoAmbiguo, setResultadoAmbiguo] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCadastro | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  // Capa escolhida na etapa 1 — só existe familiaId depois do cadastro, então o upload real
  // só acontece dentro de subirLoteDeFotos, depois que `cadastrarProduto` devolve o resultado.
  const [fotosCapa, setFotosCapa] = useState<Record<'capa' | 'capa2' | 'capa3', File | null>>({
    capa: null, capa2: null, capa3: null,
  });
  const [enviandoFotos, setEnviandoFotos] = useState<{ feitos: number; total: number } | null>(null);
  const [falhasFoto, setFalhasFoto] = useState<string[]>([]);
  // Item 1 da auditoria: alvos ('capa'|'capa2'|'capa3'|variacaoId) que já subiram com sucesso —
  // sem isto a etapa 2 voltava a mostrar um input vazio pra foto que já tinha sido enviada no
  // lote automático de `salvar()`, e o operador lia isso como "perdi minha foto".
  const [fotosEnviadas, setFotosEnviadas] = useState<Set<string>>(new Set());
  // Alvo cujo "Trocar" foi clicado — força o input a reaparecer mesmo já enviado.
  const [trocando, setTrocando] = useState<Set<string>>(new Set());
  // 409 de divergência: a chave já foi usada e o que está no formulário não bate com o que
  // foi salvo. A partir daqui todo retry com esta chave devolve o mesmo erro — o toast some
  // ou expira, então a saída (ir na Revisão) precisa ficar visível enquanto o diálogo estiver
  // aberto, não só no instante do erro.
  const [divergencia, setDivergencia] = useState<{ mensagem: string; loteId: string } | null>(null);
  // Confirmação destrutiva antes de fechar com foto pendente (Achado 3, revisão final): sem
  // isto, Escape/backdrop/"Fechar"/"Ir para a Revisão" descartavam os `File` que ainda não
  // foram reenviados com sucesso, sem nenhum sinal de que a foto deveria existir. Guarda a
  // AÇÃO (não só "fechar"), porque "Ir para a Revisão" fecha E navega — a confirmação precisa
  // rodar a ação certa, não sempre `onFechar`.
  const [confirmarFechar, setConfirmarFechar] = useState<(() => void) | null>(null);
  // "Cadastrar" clicado ao menos uma vez — junto com o blur por campo, decide quando as
  // mensagens de erro inline aparecem (§5.4, Achado 4 da revisão final).
  const [tentouSalvar, setTentouSalvar] = useState(false);

  useEffect(() => {
    if (aberto) return;
    setNomePai(''); setDescricaoPai(''); setUnidade('UN'); setFornecedor('');
    setOrigem(null); setLinhas([novaLinha()]); setResultado(null);
    // chaveCadastro só regenera se o último resultado foi conhecido — resultado ambíguo (rede)
    // preserva a chave pro retry ser reconhecido pela idempotência da edge, em vez de criar
    // um segundo produto.
    if (!resultadoAmbiguo) setChaveCadastro(crypto.randomUUID());
    setDivergencia(null);
    setFotosCapa({ capa: null, capa2: null, capa3: null });
    setEnviandoFotos(null);
    setFalhasFoto([]);
    setFotosEnviadas(new Set());
    setTrocando(new Set());
    setConfirmarFechar(null);
    setTentouSalvar(false);
  }, [aberto, resultadoAmbiguo]);

  const podeSalvar = !!nomePai.trim() && !!origem && linhas.length > 0
    && linhas.every((l) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, l[c])));

  // Guarda ÚNICA por onde toda saída destrutiva passa — Escape, clique fora, "Cancelar",
  // "Fechar" e "Ir para a Revisão" (que também descarta o state ao chamar `onFechar`). Com
  // foto pendente (falha no lote da etapa 2), exige confirmação explícita antes de rodar a
  // ação em vez de travar para sempre ou deixar passar direto.
  function comConfirmacao(acao: () => void) {
    if (ocupado) return;
    if (falhasFoto.length > 0) { setConfirmarFechar(() => acao); return; }
    acao();
  }

  async function salvar() {
    if (!origem) return;
    setSalvando(true);
    // Toda nova tentativa merece a chance de resolver limpo de novo.
    setResultadoAmbiguo(false);
    try {
      const r = await cadastrarProduto(montarPayload(
        { nomePai, descricaoPai, unidade, fornecedor, origem }, linhas, chaveCadastro,
      ));
      setResultado(r);
      setChaveCadastro(crypto.randomUUID());
      // Primeira invalidação: o produto já aparece na listagem, sem esperar as fotos.
      qc.invalidateQueries({ queryKey: ['produtos-saldo'] });
      await subirLoteDeFotos(r);
      // Segunda invalidação, OBRIGATÓRIA: a primeira roda antes dos uploads, e `imagem_path` /
      // `capa_storage_path` só são gravados dentro de uploadFotoProduto. Sem esta, o card fica
      // com placeholder mesmo com a foto já enviada.
      qc.invalidateQueries({ queryKey: ['produtos-saldo'] });
      if (r.filaOk && r.falhasEstoque.length === 0) toast.success('✓ Produto cadastrado');
    } catch (e) {
      if (e instanceof ProdutoJaExisteError) {
        setDivergencia({ mensagem: e.message, loteId: e.loteId });
        toast.error(e.message, {
          action: { label: 'Abrir na Revisão', onClick: () => navigate(`/revisao/${e.loteId}`) },
        });
      } else if (e instanceof CadastroResultadoAmbiguoError) {
        setResultadoAmbiguo(true);
        toast.error(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : 'Falha ao cadastrar o produto.');
      }
    } finally {
      setSalvando(false);
    }
  }

  async function reprocessar(familiaId: string) {
    try {
      const { error } = await supabase.functions.invoke('reprocessar-familia', { body: { familia_id: familiaId } });
      if (error) throw error;
      toast.success('✓ Reenfileirado para o enriquecimento por IA');
      setResultado((r) => (r ? { ...r, filaOk: true } : r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reprocessar.');
    }
  }

  // `loteId` explícito (não lido de `resultado`): quando chamada pelo lote logo após
  // `setResultado(r)`, o state ainda não re-renderizou — `resultado` no closure continuaria
  // `null` e o upload seria descartado em silêncio. Etapa 2 passa `resultado.loteId` (já
  // válido ali); o lote passa o `r` recebido como parâmetro de `cadastrarProduto`.
  async function subirFoto(arquivo: File, alvo: Parameters<typeof uploadFotoProduto>[3], loteId: string) {
    setEnviandoFoto(true);
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      const orgId = effectiveOrgId();
      if (!userId || !orgId) throw new Error('Sem sessão ou organização.');
      if (!canWrite()) throw new Error('Suporte somente leitura.');
      const owner = storageOwnerForUpload(userId, orgId, useSupportStore.getState().context?.scope ?? null);
      await uploadFotoProduto(owner, loteId, arquivo, alvo);
      // Cobre os dois chamadores: o retry manual da etapa 2 (que sem isto nunca invalidava —
      // o card ficava com placeholder mesmo com o path já gravado) e o lote automático (que já
      // invalida de novo ao fim de `salvar()`; repetir aqui é redundante mas inofensivo).
      qc.invalidateQueries({ queryKey: ['produtos-saldo'] });
      toast.success('✓ Foto enviada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar a foto.');
      throw e;
    } finally {
      setEnviandoFoto(false);
    }
  }

  /**
   * Casamento POSICIONAL, e ele é correto por quatro invariantes encadeados:
   *   1. derivarCodigos numera na ordem do array           (_shared/produto/codigos.ts:38)
   *   2. montarLinhasProduto casa variacoes[i] ↔ codigos[i] (_shared/produto/validar.ts:102)
   *   3. a edge ordena a resposta por codigo                (cadastrar-produto/index.ts:256)
   *   4. todo codigo tem 8 digitos, entao ordem lexicografica = numerica
   * Se qualquer um deles mudar, a foto vai para o SKU errado EM SILENCIO.
   *
   * Se `linhas.length !== r.variacoes.length`, os invariantes acima não garantem mais nada —
   * a contagem divergente é sinal de que um retry idempotente devolveu o cadastro ORIGINAL da
   * edge, que pode ter menos ou mais variações do que o formulário atual (o operador editou
   * linhas entre tentativas). Pular o casamento de variação nesse caso é mais seguro do que
   * arriscar o índice errado; o operador é avisado via `falhasFoto`. A foto de capa não é
   * afetada — casa por `familiaId`, não por índice.
   */
  async function subirLoteDeFotos(r: ResultadoCadastro) {
    // `rotulo` é só para a mensagem de falha (o operador não reconhece um variacaoId em UUID);
    // não participa do casamento em si, que usa `alvo`. `chave` identifica o alvo em
    // `fotosEnviadas`/`trocando` (item 1 da auditoria — marca "já enviada" na etapa 2).
    const alvos: Array<{
      arquivo: File; alvo: Parameters<typeof uploadFotoProduto>[3]; rotulo: string; chave: string;
    }> = [];
    (['capa', 'capa2', 'capa3'] as const).forEach((tipo) => {
      const arquivo = fotosCapa[tipo];
      const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
      if (arquivo) alvos.push({ arquivo, alvo: { tipo, familiaId: r.familiaId }, rotulo, chave: tipo });
    });
    const falhas: string[] = [];
    if (linhas.length !== r.variacoes.length) {
      linhas.forEach((l, i) => {
        if (l.foto) falhas.push(`Variação (linha ${i + 1}, contagem divergente — vá pra Revisão)`);
      });
    } else {
      linhas.forEach((l, i) => {
        const v = r.variacoes[i];
        if (l.foto && v) {
          alvos.push({ arquivo: l.foto, alvo: { tipo: 'variacao', variacaoId: v.id }, rotulo: v.codigo, chave: v.id });
        }
      });
    }
    if (alvos.length === 0 && falhas.length === 0) return;

    if (alvos.length > 0) {
      setEnviandoFotos({ feitos: 0, total: alvos.length });
      const enviadosNesteLote: string[] = [];
      for (const [i, a] of alvos.entries()) {
        try {
          await subirFoto(a.arquivo, a.alvo, r.loteId);
          enviadosNesteLote.push(a.chave);
        } catch {
          falhas.push(a.rotulo);
        }
        setEnviandoFotos({ feitos: i + 1, total: alvos.length });
      }
      setEnviandoFotos(null);
      setFotosEnviadas((prev) => new Set([...prev, ...enviadosNesteLote]));
    }
    setFalhasFoto(falhas);
  }

  const pendencias = resultado && (!resultado.filaOk || resultado.falhasEstoque.length > 0);
  // Cobre as três fases destrutivas de fechar no meio: `salvando` (cadastrarProduto em voo —
  // fechar aqui não cancela a chamada, só descarta os `File`s escolhidos no useEffect de
  // reset), `enviandoFotos !== null` (lote automático em andamento) e `enviandoFoto` (retry
  // manual da etapa 2 em andamento — o guard original, preservado).
  const ocupado = salvando || enviandoFoto || enviandoFotos !== null;

  return (
    <>
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) comConfirmacao(onFechar); }}>
      {/* sm: obrigatorio: o default do componente e `sm:max-w-sm`; sobrescrever com
          `max-w-3xl` sem o mesmo prefixo nao vence a cascata (tailwind-merge trata como
          grupos diferentes) e o dialog renderiza com 384px em qualquer desktop.
          3xl: as variacoes agora sao cards empilhados (nao uma tabela larga com scroll
          horizontal), entao a largura so precisa acomodar um card por vez. */}
      <DialogContent className="max-h-[90vh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          {/* Item 6 da auditoria: o dialog tem 2 etapas e nada indicava isso. */}
          <DialogTitle>{resultado ? 'Fotos do produto · etapa 2 de 2' : 'Cadastrar produto · etapa 1 de 2'}</DialogTitle>
          <DialogDescription>
            {resultado
              // Item 1 da auditoria: se alguma foto já subiu com sucesso e não há falha
              // pendente, o texto não pode continuar pedindo "envie a capa" — o operador lê
              // isso como "o sistema perdeu minha foto".
              ? falhasFoto.length === 0 && fotosEnviadas.size > 0
                ? 'Fotos enviadas. Revise ou adicione as que faltam.'
                : 'Envie a capa do produto e uma foto por variação. Depois é só ir para a Revisão.'
              : 'O cadastro não publica nada — a publicação continua sendo feita na Revisão.'}
          </DialogDescription>
        </DialogHeader>

        {!resultado ? (
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
                <Input id="cad-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
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
                        disabled={salvando}
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
          <div className="flex min-w-0 flex-col gap-4">
            {/* Cadastro parcial NUNCA é reportado como sucesso: o operador seguiria para a
                Revisão achando que está tudo certo. */}
            {!resultado.filaOk && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  O produto foi cadastrado, mas o enriquecimento por IA não foi enfileirado.
                  Sem isso ele não fica pronto para publicar.
                  <div className="mt-2">
                    <Button size="sm" onClick={() => reprocessar(resultado.familiaId)}>Reprocessar</Button>
                  </div>
                </div>
              </div>
            )}
            {resultado.falhasEstoque.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  O estoque inicial não foi aplicado nestes SKUs — use “Dar entrada” na tela de
                  Estoque para corrigir:
                  <ul className="mt-1 list-inside list-disc font-mono text-xs">
                    {resultado.falhasEstoque.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {enviandoFotos && (
              <p className="text-sm text-muted-foreground">
                enviando fotos ({enviandoFotos.feitos}/{enviandoFotos.total})…
              </p>
            )}
            {falhasFoto.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  Falha ao enviar a foto de: {falhasFoto.join(', ')}. Envie de novo abaixo.
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Fotos do produto</span>
              {/* items-stretch (grid default) + CampoFoto com h-20 fixo nas 3 colunas: alinha
                  Capa (que pode estar "enviada", card mais raso) com Capa 2/3 (dropzone) —
                  achado do dono do produto: layout desalinhado entre as 3 colunas. */}
              <div className="grid gap-2 sm:grid-cols-3">
                {(['capa', 'capa2', 'capa3'] as const).map((tipo) => {
                  const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
                  // FALHOU tem prioridade sobre ENVIADA: um retry manual que falhou depois de
                  // um sucesso anterior ainda precisa pedir o arquivo de novo.
                  const status: 'falhou' | 'enviada' | 'naoEnviada' = falhasFoto.includes(rotulo)
                    ? 'falhou' : fotosEnviadas.has(tipo) ? 'enviada' : 'naoEnviada';
                  return (
                    <div key={tipo} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{rotulo}</span>
                      <CampoFoto
                        id={`retry-capa-${tipo}`}
                        ariaLabel={rotulo}
                        arquivo={fotosCapa[tipo]}
                        disabled={enviandoFoto}
                        enviada={status === 'enviada' && !trocando.has(tipo)}
                        opcional={status === 'naoEnviada'}
                        onTrocar={() => setTrocando((prev) => new Set(prev).add(tipo))}
                        onEscolher={(f) => {
                          if (f) {
                            subirFoto(f, { tipo, familiaId: resultado.familiaId }, resultado.loteId)
                              .then(() => {
                                // Retry manual bem-sucedido apaga o aviso de falha desse alvo —
                                // sem isto o banner vermelho ficava contradizendo o toast de
                                // sucesso — e marca o alvo como enviado (item 1).
                                setFalhasFoto((prev) => prev.filter((x) => x !== rotulo));
                                setFotosEnviadas((prev) => new Set(prev).add(tipo));
                                setTrocando((prev) => { const p = new Set(prev); p.delete(tipo); return p; });
                              })
                              .catch(() => {});
                            setFotosCapa((prev) => ({ ...prev, [tipo]: f }));
                          } else {
                            // "Remover": desiste do arquivo que falhou — some com o card e com
                            // o aviso de falha, volta pro estado "nenhuma foto escolhida".
                            setFotosCapa((prev) => ({ ...prev, [tipo]: null }));
                            setFalhasFoto((prev) => prev.filter((x) => x !== rotulo));
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Foto por variação</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {resultado.variacoes.map((v, i) => {
                  const status: 'falhou' | 'enviada' | 'naoEnviada' = falhasFoto.includes(v.codigo)
                    ? 'falhou' : fotosEnviadas.has(v.id) ? 'enviada' : 'naoEnviada';
                  // Mesmo casamento posicional de `subirLoteDeFotos` — só existe arquivo em
                  // memória pra mostrar a miniatura quando a contagem bate.
                  const contagemBate = linhas.length === resultado.variacoes.length;
                  const arquivoEmMemoria = contagemBate ? linhas[i]?.foto ?? null : null;
                  const patchFoto = (foto: File | null) => {
                    if (!contagemBate) return;
                    setLinhas((prev) => prev.map((x, idx) => (idx === i ? { ...x, foto } : x)));
                  };
                  return (
                    <div key={v.id} className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">{v.codigo}</span>
                      <CampoFoto
                        id={`retry-var-${v.id}`}
                        ariaLabel={v.codigo}
                        arquivo={arquivoEmMemoria}
                        disabled={enviandoFoto}
                        enviada={status === 'enviada' && !trocando.has(v.id)}
                        opcional={status === 'naoEnviada'}
                        onTrocar={() => setTrocando((prev) => new Set(prev).add(v.id))}
                        onEscolher={(f) => {
                          if (f) {
                            subirFoto(f, { tipo: 'variacao', variacaoId: v.id }, resultado.loteId)
                              .then(() => {
                                setFalhasFoto((prev) => prev.filter((x) => x !== v.codigo));
                                setFotosEnviadas((prev) => new Set(prev).add(v.id));
                                setTrocando((prev) => { const p = new Set(prev); p.delete(v.id); return p; });
                              })
                              .catch(() => {});
                            patchFoto(f);
                          } else {
                            patchFoto(null);
                            setFalhasFoto((prev) => prev.filter((x) => x !== v.codigo));
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!resultado ? (
            <>
              <Button variant="outline" onClick={() => comConfirmacao(onFechar)} disabled={ocupado}>Cancelar</Button>
              {/* setTentouSalvar: por completude com a spec (§5.4, branch "b"). Na prática o
                  botão só é clicável quando `podeSalvar` já é true — ou seja, sem nenhum campo
                  com erro — então este ramo nunca revela mensagem nova hoje. Só passaria a
                  importar se o gate `disabled={!podeSalvar}` abaixo for removido. */}
              <Button onClick={() => { setTentouSalvar(true); salvar(); }} disabled={!podeSalvar || salvando}>
                {salvando ? 'Cadastrando…' : 'Cadastrar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => comConfirmacao(onFechar)} disabled={ocupado}>Fechar</Button>
              <Button
                disabled={!!pendencias || ocupado}
                onClick={() => comConfirmacao(() => { onFechar(); navigate(`/revisao/${resultado.loteId}`); })}
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
    <AlertDialog open={!!confirmarFechar} onOpenChange={(o) => { if (!o) setConfirmarFechar(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fechar sem reenviar as fotos que falharam?</AlertDialogTitle>
          <AlertDialogDescription>
            {falhasFoto.length} foto(s) não foram enviadas ({falhasFoto.join(', ')}). Continuar
            descarta os arquivos escolhidos — você vai precisar selecioná-los de novo depois.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar aqui</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { const acao = confirmarFechar; setConfirmarFechar(null); acao?.(); }}
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
