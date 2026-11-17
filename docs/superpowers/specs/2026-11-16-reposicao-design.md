# Reposição — design da tela e funcionalidade

ADR: `docs/decisions/0207-reposicao-de-estoque-e-pedido-de-compra.md` · Glossário: `CONTEXT.md` › Reposição de estoque · Status: rascunho; revisões Fable 5.2, GPT 6.1 Sol e Grok 4.7 aplicadas (2026-11-16)

## 1. Chão

- **Assunto:** reposição de mercadoria de uma loja de marketplace sem ERP (piloto: Zaven, moda; depois DSA e Daludi Shop, cosmético/saúde, após validade/lote e sazonalidade, ADR-0207 "Condição para a fase 2").
- **Quem chega:** dono ou comprador da loja, com o WhatsApp do fornecedor aberto, querendo saber *o que pedir hoje e quanto*.
- **Função única da tela:** sair dela com um pedido de compra pronto para mandar ao fornecedor, sem esquecer nada que vai faltar e sem comprar o que encalha.
- **Intenção:** a tela deve parecer a **prancheta de pedido do representante de atacado** (grade impressa, cor por linha, tamanho por coluna, quantidade escrita na célula) com a inteligência de um ERP grande por trás.

Sistema herdado: tokens OKLCH de `src/index.css`, semânticos `success/warning/info/danger`, `StatusPill`, `Select` Radix (`src/components/ui/select.tsx`), cards e tabelas do padrão de Vendas SKU e Promoções. Nenhuma cor ou fonte nova.

## 2. Onde fica e acesso

- **Item próprio no menu lateral, logo abaixo de Estoque** (`NAV_ITEMS` em `src/components/sidebar.tsx`, lista plana, sem grupos): rótulo "Reposição", ícone `ShoppingCart` (lucide), rota `/#/reposicao`, `key: 'reposicao'`. Some do menu com o módulo `reposicao` desligado, pelo mesmo `menusDeModulosDesabilitados` de `src/lib/modulos.ts` (ADR-0207 §20).
- **Outras três portas de entrada:**
  1. link do resumo de reposição (app e Telegram) → `/#/reposicao?urgencia=<faixa>`, já filtrado;
  2. botão "Reposição" no cabeçalho do Estoque, ao lado de Entrada e Nota de compra (`src/pages/Estoque.tsx`);
  3. selo de urgência (Ruptura, Vai faltar, Pedir agora) no card do produto do Estoque (`src/components/estoque/produto-card.tsx`), que abre `/#/reposicao?produto=<codigo_pai>` com o produto expandido.
- O mapa da grade reaproveita a ordenação de cor e tamanho de `src/lib/cadastro-grade.ts` (`chaveGrade`), não o componente `matriz-grade.tsx` (editor de cadastro).
- Todo membro vê e monta rascunho; **Aprovar pedido** só admin (desabilitado com a dica "Só administrador aprova o pedido" para os demais).
- Primeiro acesso sem prazo/cobertura → painel inline com 2 campos numéricos e um exemplo vivo: "Prazo de reposição (dias)", "Cobertura desejada (dias)" e a frase "Com 15 e 30: um produto que vende 1 por dia pede para durar 30 dias depois que a compra chega, mais uma folga."

## 3. Estrutura (desktop ≥1024px)

Valores em R$ e quantidades do wireframe são ilustrativos; fornecedores e grades são os reais da Zaven.

```
┌ Reposição ─────────────────────────────── Prazo 15d · Cobertura 30d [Ajustar] ┐
│ ⓘ 92% dos produtos ainda estimados pela família: a loja tem poucas vendas.     │
│                                                                                  │
│ ┌ Ruptura ───┐ ┌ Vai faltar ─┐ ┌ Pedir agora ─┐ ┌ Sugerido para comprar ──────┐ │
│ │ 4 SKUs     │ │ 2 SKUs      │ │ 11 SKUs      │ │ R$ 1.840 · 39 un.            │ │
│ │ 2 produtos │ │ 1 produto   │ │ 3 produtos   │ │ 1 fornecedor                 │ │
│ └────────────┘ └─────────────┘ └──────────────┘ └──────────────────────────────┘ │
│                                                                                  │
│ [Buscar produto…] [Fornecedor ▾] [Urgência ▾]                  Ordenar: urgência │
│                                                                                  │
│ ▸ Calça Sarja Masculina Bolso Faca   Fornec. A   Ruptura   —      27 un. R$ 1.215│
│ ▾ Short Bermuda Mauricinho           Fornec. A   Pedir ag.  +20%  12 un. R$ 312  │
│    ┌ mapa da grade ───────────────────────────────┐                              │
│    │         P          M          G          GG   │                              │
│    │ Preto   2·pedir 2  0·pedir 3  1·pedir 2  3    │                              │
│    │ Cáqui   4          1·pedir 1  0·pedir 4  2    │                              │
│    └───────────────────────────────────────────────┘                              │
│    Por quê: vende 0,9/dia · pedido +20% (vendas subiram 40% nas últimas 2 semanas)│
│    · pico de 12/11 limitado · 3 vendas em oferta fora da tendência              │
│    [Adicionar ao pedido]                                                         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Rascunho: Fornecedor A 39 un. R$ 1.527 · salvo 16/11 14:02 por Diego  [Revisar ▸]│
└──────────────────────────────────────────────────────────────────────────────────┘
```

Abas no topo: **Sugestões** (padrão) · **Pedidos**.

### 3.1 Aviso da loja

Quando mais da metade dos produtos com venda ainda depende da curva da família, uma faixa `info` única no topo: "N% dos produtos ainda estimados pela família: a loja tem poucas vendas." Sem data prometida. Nessa fase a venda perdida por dia fica oculta. Sem selo por linha.

### 3.2 Cards de urgência (topo)

Quatro cards clicáveis que filtram a lista. Número principal em **SKUs**, linha de apoio em **produtos** (famílias), porque a lista é por família. `tabular-nums`; cor semântica só na borda esquerda e no número. As faixas saem da mesma projeção da quantidade (ADR-0207 §14): todo SKU com quantidade a pedir está em Ruptura, Vai faltar ou Pedir agora.

| Card | Token | Linha de apoio |
|---|---|---|
| Ruptura | `danger` | produtos afetados; venda perdida por dia (velocidade × preço) fora da fase do aviso da loja |
| Vai faltar | `danger` 60% | "zera antes de um pedido feito hoje chegar" |
| Pedir agora | `warning` | produtos afetados |
| Sugerido para comprar | `primary` | R$ pelo custo, unidades, nº de fornecedores |

Sem gradiente, sem ícone decorativo. Card ativo com `ring-2 ring-ring`.

### 3.3 Lista de produtos (uma linha por família)

Colunas: foto · nome · fornecedor · `StatusPill` da pior urgência entre os SKUs · ajuste da tendência no pedido ("+20%", "−15%", "—" sem tendência) · dias de estoque (até a projeção zerar) · a caminho · sugestão (un. e R$). Ordem padrão: urgência, depois R$ de venda perdida. Produto sem variação: mesma linha, sem mapa ao expandir. Ruptura com pedido a caminho mostra "chega dd/mm" na pill.

### 3.4 Detalhe expandido (elemento-assinatura)

**Mapa da grade** (produtos com cor e/ou tamanho): linhas = cores (bolinha `cor_hex` + nome), colunas = tamanhos na ordem da grade. Cada célula:
- fundo pela urgência (`danger/10`, `warning/10`, neutro), borda sólida;
- texto **"2 · pedir 4"** (estoque · quantidade); só o estoque quando não precisa comprar; riscado e `muted` quando marcado Não repor;
- ícone pequeno quando a célula ainda depende da curva;
- clique abre popover com vendidos, dias disponíveis, velocidade, a caminho e o cálculo em linguagem leiga. Ex.: "Vende cerca de 1 a cada 4 dias. Quando a compra chegar, sobra 0. Para durar 30 dias, com folga, precisa de 9." Com múltiplo de compra, a frase é da família: "A família pediu 32; a caixa é de 6, então sobe para 36, repartidos pelos tamanhos que mais vendem." Quando depende da curva: "Estimado pelas outras cores e tamanhos deste produto."
- acessível: `role="grid"`, célula com `aria-label` completo; urgência também por texto, nunca só pela cor.

**Por quê:** frase gerada dos números, nunca IA: velocidade, ajuste da tendência no pedido (e a variação de vendas que o causou), picos limitados, vendas em oferta que ficaram fora da tendência, pedidos a caminho.

**Fora de linha (emenda 17/11, ADR-0207 §23–24):** o menu "Não repor ▾" saiu. Produto inteiro e cor são marcados **no Estoque** (menu ⋯ do produto → "Fora de linha…"), com confirmação (unidades que saem do rascunho; as outras cores são recalculadas; voltar à linha não devolve itens ao rascunho). Aqui a Reposição só obedece: o produto, ou a cor, some da lista e do mapa e aparece atrás do filtro "Mostrar fora de linha", esmaecido, com selo e "Abrir no Estoque". Um tamanho avulso continua em "Não repor este tamanho" no popover da célula (riscado, sem esconder a linha).

### 3.5 Rascunho e pedido

- Rascunho é da org, salvo no servidor e visto por todos os membros; barra fixa no rodapé com um rascunho por fornecedor (unidades, R$, quem salvou e quando). Admin recebe aviso no app quando há rascunho esperando.
- "Revisar" abre `Sheet` lateral por fornecedor: tabela editável (input `inputmode="numeric"`; sugestão original ao lado quando editada), total, data prevista editável.
- **Aprovar pedido** (admin) grava o pedido e libera **Copiar para WhatsApp**: fornecedor, data, itens agrupados por produto e cor em grade ("Calça Sarja Marrom Escuro: 38×2 40×1 42×6"), código do fornecedor quando houver `vinculos_fornecedor`. Copiar marca o pedido como **Enviado ao fornecedor** (também marcável à mão).
- Pedido editável (quantidade, data) até o primeiro recebimento, com "alterado por X em dd/mm".
- Aba **Pedidos**: Rascunho / Aprovado / Enviado / Parcial / Recebido / Saldo encerrado, com o alerta Atrasado; detalhe com pedido × recebido por item e atraso real em dias.
- **Entrada manual no Estoque** ganha o campo "De qual pedido?" (pedidos abertos que têm o SKU, ou "Nenhum"). Só a escolha de um pedido baixa.
- **Nota de compra** pré-seleciona o pedido aberto do fornecedor com o CNPJ emitente; o operador confirma ou troca.
- **Recebimento parcial:** após a entrada que deixa saldo, aviso "Chegaram 20 de 27 do pedido Fornecedor A. O restante ainda vem?" → Sim (segue a caminho) / Não (lista os itens que serão encerrados, confirma; reversível).

## 4. Estados

| Estado | Comportamento |
|---|---|
| Módulo desligado | rota redireciona; item fora do menu |
| Sem configuração | painel inline de prazo/cobertura com exemplo |
| Organização nova | aviso único da loja (§3.1) |
| Sem vendas na janela | "Nenhuma venda nos últimos 60 dias. Assim que vender, a reposição aparece aqui." |
| Tudo em dia | cards zerados + "Nada para pedir hoje." |
| Carregando | skeleton dos cards e de 6 linhas |
| Erro | causa + "Tentar de novo" |
| Membro não admin | Aprovar desabilitado com dica |

## 5. Responsivo (≤767px)

Cards em carrossel horizontal com snap; lista vira cartões; mapa da grade com rolagem horizontal própria e coluna de cores fixa; barra de rascunho vira botão flutuante "Pedidos (2)". Alvos ≥44px.

## 6. Movimento

Expandir linha: altura + opacidade 200ms `ease-out`. Célula editada no pedido: destaque `primary/10` que some em 600ms. Nada mais. Tudo sob `prefers-reduced-motion: no-preference`.

## 7. Texto

Rótulos do glossário (Ruptura, Vai faltar, Pedir agora, Em dia, A caminho, Pedido atrasado, Encerrar saldo, Não repor). Botões dizem o que fazem: "Adicionar ao pedido", "Aprovar pedido", "Copiar para WhatsApp", "Encerrar saldo". Sem "Desbloqueie", "Inteligente", "Poderoso".

## 8. Exemplo real (Zaven, Calça Sarja 00000169, 16/11)

Estoque 18 (Cáqui 8, Marrom Claro 6, Marrom Escuro 4); vendidos 13 em 13 dias; 4 SKUs zerados respondem por 8 das 13 vendas. Nenhum SKU passou de 3 vendas, então a curva pesa pelo menos metade em todos. A concentração está no tamanho 42 (6 de 13 vendas) e na cor Marrom Escuro. O número final sai da projeção do ADR-0207 §9–§12 com os dias disponíveis reconstruídos; nenhum total é cravado aqui.

## 9. Fora desta tela (v1)

PDF do pedido, aba Fornecedores, gráfico de projeção, faixa e card Excesso, filtro de tendência, teto em R$ por pedido, prazo por fornecedor, pedido mínimo e grade fechada do fornecedor, tela de acurácia (a foto diária já é gravada), estoque Full.
