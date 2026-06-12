# ADR-0004: Atribuição de cor — descrição primeiro, IA Vision como fallback

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

A planilha do sistema interno não contém uma coluna explícita com a **cor textual** dos filhos (variações). O que existe é o **código de cor do fornecedor** no campo `NOME` (ex: "LINHA P/COST.XIK 120 2000J 455"), que é um número opaco do ponto de vista do comprador.

O Mercado Livre **exige o atributo COLOR como obrigatório** na categoria de Linhas de Costura (e na maioria das categorias de aviamentos/têxtil). Sem isso, a publicação é rejeitada.

A cor real existe na **foto do produto** (cada filho tem uma única foto, nomeada `00CODIGO.jpeg`). Modelos de vision modernos (GPT-4o Vision, Gemini Vision) são excelentes em identificar cor de imagem.

## Decisão

A atribuição de cor segue uma estratégia em camadas:

1. **Camada 1 — parser de texto:** o sistema primeiro tenta extrair a cor da `descricao_detalhado` ou do `NOME` do filho. Usa regex/dicionário para nomes de cor comuns em português (preto, branco, vermelho, azul royal, verde bandeira, neon, cru, etc.).

2. **Camada 2 — IA Vision (fallback):** se a camada 1 não achar cor, o sistema chama GPT-4o Vision com a foto do produto e um prompt curto pedindo o nome de cor em português. Custo ~$0.005 por imagem.

3. **Camada 3 — operador valida:** a cor inferida (de qualquer camada) chega pré-preenchida na tela de revisão; o operador valida com 1 clique ou edita.

O sistema **só chama a IA Vision quando a cor não está explícita na descrição** — economiza chamadas, mas mantém qualidade.

A origem da cor é gravada no campo `variacoes.cor_origem` (enum: `descricao`, `vision`, `manual`) para auditoria e métrica de qualidade do parser de texto.

## Alternativas consideradas

- **Opção A: Tabela de-para manual por fornecedor (código → cor)**
  - Pros: determinístico; nomes consistentes com a marca do fornecedor
  - Cons: trabalho inicial pesado para cada novo fornecedor (alguns têm centenas de cores); precisa manter atualizada; quebra quando o fornecedor adiciona nova cor
  - Rejeitada como caminho principal (mantida como possibilidade futura caso a auditoria mostre que Vision erra muito em fornecedores específicos)

- **Opção B: Operador digita toda a cor manualmente na tela de revisão**
  - Pros: simples de implementar; controle total do operador
  - Cons: trabalho repetitivo, ~50 cliques por lote; subverte o objetivo do projeto (automação)
  - Rejeitada como fluxo principal

- **Opção C: IA Vision para TUDO (sem parser de texto)**
  - Pros: simplicidade do código
  - Cons: chama Vision mesmo quando o nome já está no texto ("VERMELHO" na descrição); desperdício de $$ e latência
  - Rejeitada porque a camada 1 (parser) é trivial de implementar e economiza muito

- **Opção D: Descrição → Vision → operador valida (escolhida)**
  - Pros: usa IA só onde realmente precisa; operador valida sempre; auditável via `cor_origem`
  - Cons: dependência de modelo Vision; ~$0.005/imagem analisada
  - Aceita

## Consequências

**Boas:**
- Custo mínimo de IA: para a maioria dos lotes onde a descrição já tem o nome da cor, Vision não é chamado
- Operador valida em 1 clique 90% do tempo (quando IA acerta) — UX rápida
- Auditável: dá pra responder "essa cor veio de onde?" via SQL no campo `cor_origem`
- Permite evoluir: se um fornecedor específico der muitos erros, podemos plugar a Opção A (tabela de-para) só pra ele sem refactor

**Tradeoffs aceitos:**
- Dependência de modelo Vision com qualidade variável em tons próximos (vermelho cardinal vs vermelho fogo)
- Custo de Vision escala com volume de produtos sem cor textual
- Parser de texto precisa de manutenção conforme fornecedores usem termos novos

**Como reverter:**
- Pode-se desligar a Vision e cair em modo "manual" (operador preenche tudo) sem mudar o schema
- Pode-se trocar de GPT-4o Vision para Gemini Vision sem mudar o resto do sistema (camada de IA isolada por contrato)

## Adendo (2026-06-05) — Código da cor no NOME

Quando o NOME traz `{número} {cor}` (ex.: `1354 VERMELHO TOMATE`), uma camada anterior ao
dicionário (`extrairCorECodigo`) extrai o **código** e o **nome literal** da cor — abreviações
comuns expandidas (AZ→Azul, VD→Verde, AMA→Amarelo, CL→Claro, ESC→Escuro, BCA→Branco, PTO→Preto)
e title-case — embutindo em `variacoes.cor` como `"{Cor} {código}"` (ex.: `Vermelho Tomate 1354`).
Sem esse padrão, mantém-se o dicionário canônico. Vale no CREATE; falsos positivos
(ex.: `10 BCA` → `Branco 10`) são corrigidos pelo operador na Revisão.

## Adendo (2026-06-12) — Camada 1 não lê a descrição detalhada

A decisão original (item 1) listava a `descricao_detalhado` como fonte do dicionário de
cores. Na prática a `DESCRICAO_DETALHADO` evoluiu para **prosa de marketing longa**, cheia
de cores **incidentais** que não nomeiam a cor do produto — ex.: a linha de bobina branca
"LINHA 100% POLIESTER 150 15000MT" (`MLB6953626078`) tinha na descrição *"...a linha de cima
(que faz o desenho **colorido**)..."*, e `colorido` (sinônimo de `Multicolor`) foi atribuído
como cor da variação. Além disso, a `descricao_pai` é **por família** (igual para todas as
variações), então **nunca** consegue distinguir cor por variação — só pode gerar falso
positivo ou pintar todas as cores iguais.

**Decisão:** a Camada 1 (dicionário) passa a usar **apenas campos curtos e estruturados** —
o nome da variação (`v.nome`) e o nome do pai (`nome_pai`), via helper puro
`extrairCorDeVariacao`. A descrição é **excluída de propósito**. Quando não há cor textual
nesses campos, a resolução cai no **Vision** (Camada 2), que lê a foto real — exatamente o
fallback projetado. Sinônimos do dicionário (inclusive `colorido`) são preservados; o que
muda é a **fonte**, não o léxico. Só afeta CREATE/reprocessamento daqui pra frente; o único
anúncio já publicado afetado (`MLB6953626078`) foi corrigido ao vivo (COLOR
`Multicolor`→`Branco` + seção "CORES DISPONÍVEIS").
