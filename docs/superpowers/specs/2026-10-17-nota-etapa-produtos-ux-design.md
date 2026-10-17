# Importar nota — etapa "Produtos" mais clara e vínculo no cadastro — design

**Data:** 2026-10-17
**Origem:** entrada da NF 1051 (J E Araujo). O short foi cadastrado pela nota, a importação não foi
confirmada, e ao reabrir a nota o item voltou como "Escolha o produto", com o short listado também
sob o item do conjunto infantil. O título "Conjunto infantil - DIV - DIV" (texto cru do fornecedor)
confundiu.
**Base:** ADR-0181 (entrada por nota de compra), `src/components/estoque/importar-nota/`.

## 1. Intenção

Na etapa 2 ("Produtos"), o Diego quer ver primeiro, em cada item: **qual produto está vinculado** e
**quanto falta distribuir**. Produto cadastrado a partir de um item da nota não pode voltar a pedir
"Escolha o produto".

## 2. Objetivos

1. **Layout A — cartões enxutos** (escolhido no mockup de 2026-10-17):
   - Destaque do cartão = produto vinculado: foto (capa), nome formatado, código, nº de SKUs, botão
     **Trocar** (com **Cancelar**, que preserva a seleção anterior).
   - Texto do fornecedor rebaixado a linha de detalhe:
     `Item N · na nota: "<xProd>" · <qCom> <uCom> × <fator> = <unidades> unidades · R$ <custo>/unidade`
     (custo por unidade convertida; quando fator = 1 omite "× 1"). Reusar `quantidadeEmEstoque` /
     `custoAquisicaoUnit` já existentes.
   - Progresso por item em texto + barra: **"Distribuídas: X de Q · faltam Q−X"** (Q = unidades
     convertidas; X = soma já distribuída do item). Não comunicar só por cor/barra.
   - Topo: **"N de M itens prontos"**. "Pronto" = predicado único por item `itemPronto(d)` (produto
     escolhido **e** fator inteiro ≥ 1 **e** `quantidadeEmEstoque(item.qCom, fator).ok`), usado **tanto** pelo contador **quanto** pela trava da etapa
     Produtos (`motivoBloqueioEtapa(e, 1)`). Distribuição não entra (é a etapa 3): item com produto e
     fator válidos e distribuição zerada conta como pronto.
   - Item sem produto: selo **"Sem produto"**, botões **Cadastrar produto novo** (primário) e
     **Escolher existente…** (secundário, abre a busca já focada). A busca só aparece ao pedir.
   - Selos atuais (Vinculado / Casou pelo GTIN / Produto escolhido / GTIN ambíguo) continuam, mais
     um novo: **"Cadastrado desta nota"** (ver item 2).
   - Estados distintos: carregando produtos, erro ao carregar, busca sem resultado.
2. **Produto cadastrado pela nota volta ligado ao mesmo item ao reabrir a nota.**
   - Ao cadastrar produto novo a partir de um item, a edge `cadastrar-produto` grava na família a
     origem `mudanca_estrutural.refNota = "nfe:<chave44>:<nItem>"` — **mesmo formato** já usado por
     `adicionar-variacoes-familia` (`REF_NOTA`), junto com o `origem_cadastro='nota'` que já grava.
   - Ao abrir a nota, o front busca (RLS da org) as famílias com `origem_cadastro='nota'` e `refNota`
     com prefixo `nfe:<chave>:`, e para cada `nItem` **sem escolha manual na sessão** (decisão vazia ou
     automática por vínculo/GTIN) aplica
     o `codigo_pai` com selo "Cadastrado desta nota". Por item (`nItem`), nunca por cProd — dois itens
     com o mesmo cProd não interferem.
   - **`vinculos_fornecedor` não muda**: continua nascendo só na confirmação da nota (RPC do
     ADR-0181). Nenhum fator é gravado antes da confirmação.
   - Prioridade quando há mais de uma origem para o item: **"Cadastrado desta nota" > vínculo do
     fornecedor > GTIN único > nada** — o cadastro feito para aquele `nItem` é a informação mais
     específica (ex.: vínculo antigo aponta A, operador cadastrou B para este item → reabre com B).
     Se o operador trocar, vale a escolha manual da sessão.
   - Mais de um `codigo_pai` com a mesma `refNota` (cadastrou duas vezes para o mesmo item): deduplicar
     por `codigo_pai` (versões da mesma família contam uma vez); com códigos distintos **não** ligar
     sozinho — selo **"Cadastrado mais de uma vez — escolha"** e esses códigos como candidatos iniciais
     em "Escolher existente…" (mesmo tratamento do GTIN ambíguo).
   - Idempotência: `refNota` entra na comparação do retry da mesma `chaveCadastro` (como
     `grade_tamanho`/`genero` no ADR-0182): retry com `refNota` diferente da gravada → 409, antes de
     qualquer efeito. `refNota` só é aceito com `origemNota` e formato válido (`REF_NOTA`); org vem do
     usuário autenticado, nunca do payload.
3. **"Escolher existente…" sem sugestão sem relação:** sem texto digitado, mostra só candidatos de
   **GTIN igual** (`candidatosGtin`, preservados mesmo após escolha manual, para o "Trocar"); sem
   candidato, "Digite para buscar". **Com texto digitado, busca em todos os produtos** (corrige o
   comportamento atual em que GTIN ambíguo restringe a busca, `etapa-itens.tsx:24`). Não casa por nome
   de fornecedor.

## 3. Não-objetivos

- Juntar as etapas Produtos e Distribuição (opção C rejeitada).
- Mudar a etapa Distribuição, Resumo, a RPC de confirmação ou `vinculos_fornecedor`.
- Similaridade de nome por IA/fuzzy para sugerir produto.

## 4. Anti-objetivos

- Item ligado automaticamente a produto errado (só por vínculo confirmado, GTIN único ou cadastro
  feito para aquele mesmo `nItem` daquela mesma nota — nunca por nome).
- Somar estoque no cadastro (continua sem estoque inicial — ADR-0181 D-4).
- Esconder o texto do fornecedor por completo (é o que o Diego confere contra o papel).

## 5. Decisões

- **Diego:** layout A; produto vinculado e "quanto falta" em destaque; produto cadastrado pela nota
  volta ligado.
- **Minhas (podem ser contestadas):**
  - Retomada por `refNota` (nota+item) em vez de gravar `vinculos_fornecedor` antecipado — revisão do
    Codex (2026-10-17) mostrou que o vínculo global quebra com cProd repetido, vínculo antigo e fator
    antecipado. Sem migration.
  - O cadastro feito pela nota **não** cria vínculo para notas futuras; isso continua acontecendo na
    confirmação (como hoje).
  - Falha ao consultar os produtos já cadastrados desta nota: os itens sem escolha manual (vazios
    **ou** resolvidos automaticamente por vínculo/GTIN, que poderiam ser superados por um cadastro do
    item) mostram aviso; os vazios mostram estado
    próprio **"Não foi possível conferir produtos já cadastrados desta nota"** com **Tentar novamente**;
    o "Tentar novamente" preserva escolhas manuais; nesse estado "Escolher existente…" fica primário e "Cadastrar produto novo" secundário (evita
    duplicar justamente quando a retomada falhou).
- **ADR:** emenda curta ao ADR-0181 (origem `refNota` também no cadastro pela nota; retomada por item).

## 6. Validação

- Unit (edge): grava `refNota` com `origemNota` válido; recusa `refNota` sem `origemNota` ou fora do
  formato; retry com `refNota` diferente → 409 sem efeito; cadastro sem nota inalterado; org do token.
- Unit (front): reabertura liga item ao produto com `refNota` daquele `nItem`; dois itens com mesmo
  cProd ligam cada um ao seu; vínculo antigo A + cadastro B do item → B; duas famílias distintas com a
  mesma `refNota` → não liga, selo "Cadastrado mais de uma vez", candidatos = as duas; versões da mesma
  família → liga; busca com texto ignora restrição de candidatos; `itemPronto` com fator válido e
  distribuição zerada = pronto, fator inválido = não pronto, e é o mesmo usado pela trava; falha da
  consulta → estado "Não foi possível conferir" + Tentar novamente.
- Componente: cartão vinculado (foto/nome/código/SKUs, "Distribuídas: 0 de 35 · faltam 35"); item sem
  produto (selo + dois botões, sem lista); Trocar → Cancelar preserva; topo "1 de 2 itens prontos".
- Browser real (sessão isolada, sem gravar em produção) na etapa 2 com a NF 1051.

## 7. A cargo do builder

- Componentes e classes (seguir `ui/` existentes, dark/light).
- Foto e nº de SKUs: `ProdutoEstoqueResumo` já tem `qtdSkus`, `capaStoragePath`, `capaMlPictureId`.
- Nome do campo no payload (`refNota`) e onde montar (`prefill-cadastro.ts` recebe chave e nItem).
