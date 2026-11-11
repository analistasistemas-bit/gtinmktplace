# Galeria IA — redesenho de UX (proposta para aprovação do Diego)

**Data:** 11/11/2026 · **Origem:** validação real interrompida pelo Diego ("tudo muito confuso, vários erros, muita informação, péssimo gosto"). Auditoria com a skill `ui-ux-pro-max-fable5`; implementação depois com `frontend-design-fable5`. Trabalho dentro do produto existente: segue o design system do app (shadcn, `Select` Radix, tokens atuais); não cria identidade visual nova.

## 1. Para quem e para quê

- **Quem usa:** o operador da loja (ex.: equipe da AVIL), que sabe do produto, não de IA nem de campos internos.
- **A única tarefa da tela:** pôr no anúncio, por cor, fotos novas certas, com o mínimo de decisões.
- **Teste de toda decisão de tela:** "o operador precisa disso para decidir algo agora?" Se não, some ou vai para "Detalhes".

## 2. O que está errado hoje (auditoria)

| # | Problema | Onde | Por que confunde |
|---|---|---|---|
| A1 | O fluxo inteiro está espremido num modal (e o modal tinha 384 px) | `dialog-galeria.tsx` | 4 etapas longas com rolagem dentro de rolagem; sem visão do todo |
| A2 | A tela expõe o modelo interno: "Ficha verdade", "Contrato de identidade", "Cena", `atributo:BRAND`, `peso_gramas`, `descricao_ml` | fatos, roteiro | São nomes de banco e de prompt, em inglês ou jargão |
| A3 | Mostra dados que não vão para a imagem (descrição do fornecedor inteira, título e descrição do ML) | fatos | Informação demais; o operador lê tudo achando que precisa |
| A4 | 14+ "Confirmar/Descartar" sem dizer para quê nem o que acontece se ignorar | fatos | Sensação de tarefa obrigatória sem sentido |
| A5 | O roteiro mostra os 6 campos (título, subtítulo, benefícios, etapas, legendas, cena) em TODAS as 7 missões, inclusive os que a missão não usa | roteiro | Campos vazios e campos que geram erro "remova do roteiro" |
| A6 | Erros despejam o texto interno (a descrição inteira do anúncio repetida 3×, "oração inteira", "layout da missão") | roteiro | Ilegível; não diz o que fazer |
| A7 | Missões que não podem ser geradas aparecem "Ativa" com aviso ("lupa em ajuste — será ignorada") | roteiro | Contradição: ativa e ignorada |
| A8 | "Salvar alterações" falhou sem nenhum aviso; "Aprovar roteiro" fica cinza sem dizer por quê | roteiro | Ação sem retorno = o operador não sabe o que aconteceu |
| A9 | Rótulos de botão e etapa técnicos ("Fatos e referências", "Roteiro") | todas | Não dizem o que a pessoa faz |

## 3. Proposta

### 3.1 Estrutura: página própria em 4 passos, não modal

Abrir a galeria como **página** (`/#/publicados/:mlItemId/galeria`), com um cabeçalho fixo do anúncio e um **indicador de passos** clicável. O botão na linha de Publicados vira **"Galeria IA"** com texto (não só ícone).

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Publicados   FITAS VELUDO 16MM 25M · MLB7168683146 · Legacy       │
│ [miniatura]    Cores: Branco · Preto                                  │
│                                                                      │
│  ① Conferir dados ─── ② Escolher imagens ─── ③ Gerar e aprovar ─── ④ Aplicar no anúncio │
└──────────────────────────────────────────────────────────────────────┘
```

Cada passo tem **uma frase dizendo para que serve** e **um botão principal** no rodapé ("Continuar", "Gerar 2 imagens · R$ 1,00", "Aplicar na cor Branco"). O passo seguinte só abre quando o atual está resolvido; se não está, o rodapé diz **o que falta**, em uma linha.

### 3.2 Passo 1 — Conferir dados (antes "Fatos e referências")

Frase do topo: *"A IA só escreve nas imagens o que estiver confirmado aqui. O que você não confirmar não aparece."*

Três blocos, nesta ordem; bloco vazio não aparece:

1. **Divergências com a etiqueta** (só se houver) — recorte da foto da etiqueta + "Cadastro: X · Etiqueta: Y" + [Manter cadastro] [Usar o da etiqueta].
2. **Confirme para usar nas imagens** — só os dados que podem virar texto de imagem (material, medidas do produto, comprimento, largura, unidades, marca), com **rótulo em português** (Material, Largura, Comprimento, Marca…) e o valor. Cada linha com um interruptor "Usar nas imagens"; botão **"Confirmar todos"** no topo do bloco.
3. **Já confirmados** — lista compacta (Nome, Origem…), recolhida por padrão.

Sai da tela: descrição do fornecedor inteira, título e descrição do ML, peso/medidas da **embalagem** (não vão para a imagem). Ficam num "Ver todos os dados do cadastro", recolhido.

"Não conferido na etiqueta" vira um selo discreto **"sem etiqueta"** com tooltip; a ciência é marcada uma vez, em lote, no passo 2 ("Alguns dados não aparecem na etiqueta — usar mesmo assim").

### 3.3 Passo 2 — Escolher imagens (antes "Roteiro")

Frase: *"Escolha quais imagens criar e confira os textos de cada uma."*

Grade de **cartões de imagem**, um por missão, cada um com um **esboço do layout** (miniatura cinza mostrando onde fica o texto), o nome da imagem em linguagem simples e um interruptor:

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ [esboço]      │ │ [esboço]      │ │ [esboço]      │ │ [esboço]      │
│ Capa          │ │ Onde usar     │ │ Benefícios    │ │ Ficha técnica │
│ só a foto     │ │ título + sub  │ │ 3 benefícios  │ │ 4 dados       │
│      [●  ON]  │ │      [●  ON]  │ │      [○ OFF]  │ │      [○ OFF]  │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Como usar     │ │ Detalhe (lupa)│ │ Detalhes      │
│ indisponível: │ │ em breve      │ │ em breve      │
│ o cadastro não│ │               │ │               │
│ tem instruções│ │               │ │               │
└───────────────┘ └───────────────┘ └───────────────┘
```

- Imagem que não pode ser criada aparece **desligada e desabilitada**, com o motivo em uma frase (nunca "ativa, será ignorada").
- Ao abrir um cartão: **só os campos que aquela imagem mostra** (Capa: nenhum; Onde usar: Título e Subtítulo; Benefícios: Título + até 3 benefícios; Ficha técnica: até 4 pares, escolhidos da lista de dados confirmados por seletor, não digitados). Contador de palavras ao lado de cada campo.
- "Descrição da cena" e "Regras de aparência do produto" (antes "Cena" e "Contrato de identidade") ficam em **"Ajustes avançados"**, recolhido.
- **Erros:** uma linha, ao lado do campo, dizendo a correção: "Texto longo demais para a imagem — encurte para até 5 palavras", "Esse valor não está nos dados confirmados — escolha da lista". Nunca o texto interno nem o fato inteiro.
- Salvamento **automático** a cada alteração, com "Salvo" discreto; falha → aviso visível com "Tentar de novo". O botão principal "Continuar" fica ativo quando ao menos 1 imagem válida está ligada; se não, o rodapé diz o que falta.

### 3.4 Passo 3 — Gerar e aprovar

- Seletor de cor (Radix `Select`) + resumo "**2 imagens · R$ 1,00**" + botão **Gerar**.
- Grade das imagens geradas, grandes, com: [Aprovar] [Gerar outra (2 de 3 restantes)]; avisos da verificação por visão como **selo amarelo** com frase curta ("O texto do rótulo pode ter mudado — confira").
- Estados claros: gerando (barra + "cerca de 30 s"), verificando, pronta, aprovada (selo verde).

### 3.5 Passo 4 — Aplicar no anúncio

- Escolha "Substituir as fotos da cor" / "Adicionar às fotos da cor" (Radix `Select`), prévia **lado a lado** "Hoje no anúncio" × "Depois", lista dos MLB afetados, botão **"Aplicar na cor Branco"** com confirmação.
- Acompanhamento por MLB com selo (Aplicando / Aplicado / Não aplicado — motivo) e **"Desfazer"** (antes "Reverter").

### 3.6 Escrita (vale para tudo)

- Rótulos em português, do ponto de vista do operador; nenhum id interno (`atributo:*`, `*_cm`, `descricao_ml`).
- Botões dizem o que acontece ("Gerar 2 imagens · R$ 1,00", "Aplicar na cor Branco", "Desfazer aplicação").
- Erro = causa + correção, uma linha, ao lado do que precisa mudar, com `role="alert"`.
- Toda ação tem retorno (carregando → feito/erro).

## 4. Correções funcionais que entram junto (do diagnóstico)

Detalhe em `.superpowers/sdd/2026-11-08-galeria-da-cor/diagnostico-validacao-real.md`. Resumo: o gerador do roteiro só preenche os campos que cada missão mostra; ancoragem da ficha técnica pelo valor do dado (não pela descrição inteira); missões sem base (sem instruções de uso, lupa travada) nascem desligadas; salvar persiste o liga/desliga e mostra erro; o servidor não valida missão desligada; o "Aprovar" (agora "Continuar") diz o que falta.

## 5. Fora deste redesenho

Nada muda nas regras (fatos confirmados, cobrança, trava, aplicação). Mesmas edges, mesmos dados; muda a apresentação e os defeitos listados.
