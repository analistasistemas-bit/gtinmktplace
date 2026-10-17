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
     **Trocar**.
   - Texto do fornecedor rebaixado a linha de detalhe:
     `Item N · na nota: "<xProd>" · <q> peças · R$ <custo>/peça`.
   - Progresso por item: **"X de Q"** + barra (X = soma já distribuída do item, Q = quantidade da nota ×
     fator; na etapa 2 normalmente 0).
   - Topo: **"N de M itens prontos"** (item pronto = produto escolhido).
   - Item sem produto: selo **"Sem produto"**, botões **Cadastrar produto novo** (primário) e
     **Escolher existente…** (secundário). A busca só aparece ao clicar em "Escolher existente…".
   - Selos atuais (Vinculado / Casou pelo GTIN / Produto escolhido / GTIN ambíguo) continuam, só que
     visualmente coerentes com o layout.
2. **Vínculo gravado no cadastro pela nota:** ao cadastrar produto novo a partir de um item, a edge
   `cadastrar-produto` grava `vinculos_fornecedor (org, cnpj_fornecedor, cprod, codigo_pai,
   fator_conversao)` com o mesmo `on conflict (org_id, cnpj_fornecedor, cprod) do update` da RPC do
   ADR-0181. Ao reabrir a nota (ou numa próxima nota do mesmo fornecedor com o mesmo cProd), o item já
   chega **Vinculado** pelo caminho existente (`buscarVinculos`).
3. **"Escolher existente…" sem sugestão sem relação:** a lista inicial (sem texto digitado) mostra só
   candidatos de **GTIN igual** (`candidatosGtin` já existente; o vínculo exato cProd→produto já chega
   como "Vinculado"); sem candidato, mostra "Digite para buscar" em vez de listar qualquer produto.
   Não casa por nome de fornecedor (texto livre). Com texto digitado, busca em todos (como hoje).

## 3. Não-objetivos

- Juntar as etapas Produtos e Distribuição (opção C rejeitada).
- Mudar a etapa Distribuição, Resumo ou a RPC de confirmação.
- Similaridade de nome por IA/fuzzy para sugerir produto.
- Desfazer/editar vínculos existentes (fora do fluxo atual de "Trocar").

## 4. Anti-objetivos

- Item vinculado automaticamente a produto errado (vínculo só nasce de cadastro feito para aquele
  cProd daquele CNPJ, ou da confirmação da nota — nunca por nome).
- Somar estoque no cadastro (continua sem estoque inicial — ADR-0181 D-4).
- Esconder o texto do fornecedor por completo (é o que o Diego confere contra o papel).

## 5. Decisões

- **Diego:** layout A; produto vinculado e "quanto falta" em destaque; vínculo automático do produto
  cadastrado pela nota.
- **Minhas (podem ser contestadas):**
  - Vínculo gravado pela edge `cadastrar-produto` (service_role; `vinculos_fornecedor` não tem policy
    de escrita) quando o payload tem `origemNota` + `vinculoNota: { cnpjFornecedor, cprod, fator }`.
    Sem migration. Falha ao gravar o vínculo **não** desfaz o cadastro: o produto existe, o front já o
    vincula na sessão (`aoCadastrar`); a edge loga e responde sucesso com aviso.
  - O CNPJ vem do XML já lido (`nota.emitenteCnpj`), o cProd e o fator do item/decisão — o prefill
    passa os três ao diálogo de cadastro (simples e grade).
  - Regra de "pronto" do topo = produto escolhido (não depende de distribuição, que é a etapa 3).
- **ADR:** emenda curta ao ADR-0181 (vínculo também nasce no cadastro pela nota).

## 6. Validação

- Unit: edge grava vínculo com `origemNota` + `vinculoNota` (também no ramo de retry idempotente);
  não grava sem `origemNota`; vínculo existente **não** é alterado; cadastro sem nota inalterado.
- Componente: cartão com produto vinculado mostra foto/nome/código/SKUs e "0 de 35"; item sem produto
  mostra "Sem produto" + dois botões e nenhuma lista; "Escolher existente…" sem texto não lista
  produto sem relação; topo "1 de 2 itens prontos".
- Browser real (sessão isolada, sem gravar em produção) na etapa 2 com a NF 1051.

## 7. A cargo do builder

- Componentes e classes (seguir `ui/` existentes, dark/light).
- De onde vem a foto (capa) e o nº de SKUs — `ProdutoEstoqueResumo` já tem o que precisar? se não,
  incluir no select existente.
- Nome do campo no payload (`vinculoNota`) e validação (CNPJ 14 dígitos, cProd não vazio, fator > 0).
