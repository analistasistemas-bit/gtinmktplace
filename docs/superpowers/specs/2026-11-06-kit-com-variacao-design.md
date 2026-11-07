# Kit com variação — desenho

**Data:** 2026-11-06
**Status:** aguardando aprovação do Diego
**Referência de mercado:** `MLBU5154491250` (Kit 4 Blusas, categoria MLB3112)

Marcação: **[Diego]** decidido por ele. **[agente]** decisão do agente, sujeita a correção.
**[medir]** depende de teste antes de construir.

## Por que existe

Diego quer vender kits de cores diferentes do mesmo produto, como o anúncio de referência: uma
página no ML onde o comprador escolhe a combinação de cores e depois o tamanho. Tudo nasce da tela
Publicados, sem planilha, como o kit vinculado e o Kit Virtual.

Nenhum dos três sentidos de "kit" atuais cobre isso (ver ADR-0154):

| Termo | Limite |
|---|---|
| Kit | N unidades do mesmo produto num SKU |
| Kit vinculado (ADR-0151) | recusa base com várias cores (`base_multivariacao`); saldo vem de um SKU só |
| Kit Virtual (ADR-0154) | produtos distintos agrupados pelo ML, uma composição por anúncio |

Este é o quarto sentido: **kit com variação**.

## Objetivos

- Criar o kit em Publicados: escolher cores, peças por kit, quantidade por combinação e tamanho.
- Publicar uma página única no ML com seletor de combinação e tamanho.
- Nunca oferecer a mesma peça em dois anúncios ao mesmo tempo.
- Repor os kits sozinho, dentro de limites definidos pelo operador, com opção manual.
- Gerar a foto de cada combinação por IA nas empresas habilitadas, cobrando por imagem.

## Fora de escopo

- Kit com produtos de famílias diferentes.
- Kit com cor repetida, ex.: 2 pretas + 2 brancas **[agente]**.
- Sugestão automática de quais combinações vendem mais.
- Outros canais: só Mercado Livre.
- Produto no Full: bloqueado, porque o estoque lá é separado **[agente, recomendação do Codex]**.

## O que seria fracasso, mesmo funcionando

- Vender kit ou unitário sem a peça existir.
- Publicar foto ou texto que o operador não viu.
- Foto gerada mostrar peça diferente da real e isso passar sem aprovação.
- Cobrar imagem de empresa sem o módulo ligado, ou gerar imagem sem registrar a cobrança.

## Fluxo do operador

### Criar

1. Publicados → **Criar kit** numa família com grade cor × tamanho.
2. Marca as cores e as peças por kit, de 2 a 6 **[Diego]**.
3. O sistema gera todas as combinações das cores marcadas **[Diego]**.
4. Digita quantos kits montar em cada combinação e tamanho **[Diego]**. As colunas são os tamanhos
   reais da base. Rascunho aprovado pelo Diego em 06/11.
5. Só vira anúncio o que tiver quantidade maior que 0 **[agente]**. Por isso não há teto de combinações.
6. Define preço, meta e piso.
7. Prévia: título, descrição, foto por combinação, preço. Publica depois de conferir.

### Gerenciar

Botão **Gerenciar kit** na linha do kit em Publicados **[agente, aceito sem objeção]**:

- Mostra saldo por combinação e tamanho.
- **Montar mais:** só aumenta o saldo do anúncio existente, nunca cria anúncio novo **[Diego]**.
  Combinação ou tamanho nunca publicado vira item novo na mesma família, com foto própria.
- **Desmontar:** as peças voltam ao unitário **[Diego]**. No modo automático, desmontar passa o kit
  para manual até o operador religar, com aviso na tela, para o sistema não remontar **[Diego]**.
- Trocar entre automático e manual, e alterar meta e piso.

## Estoque

### Modelo: estoque separado [Diego]

A peça fica oferecida em um anúncio só. O kit tem **saldo próprio real**, diferente do kit vinculado,
que deriva o saldo da base. Como o ML não vende além do saldo de cada anúncio, a janela entre venda
e atualização deixa de causar venda duplicada.

Isso substitui as regras anteriores de reserva de 1 unidade e saldo pelo mínimo das cores, que
foram descartadas.

Consequências:

- Venda de kit baixa só o saldo do SKU do kit.
- Cancelamento antes do despacho volta sozinho ao saldo do kit, que continua montado, pela regra
  atual do ADR-0121. Cancelamento pós-despacho e devolução não repõem sozinhos: seguem o aviso
  existente, e o operador confere as peças e ajusta **[agente]**.
- Base com Kit Virtual ou kit vinculado ativo não pode gerar kit com variação, porque aquelas peças
  têm outra oferta fora do controle da transferência **[agente]**.
- As travas do ADR-0151 D-9 (escrita bloqueada no SKU de kit) não podem alcançar este kit. O
  predicado `kit_multiplicador is not null` também aciona `resolverOrigemEstoque` e o saldo derivado.
  O kit com variação precisa de identificação própria, fora desse predicado.

### Montar e desmontar

São transferências de estoque entre SKUs, registradas no ledger com motivo próprio. As N cores
mexem juntas, numa transação: nunca baixa parcial.

Ordem obrigatória, para nunca existir oferta dupla:

- **Montar:** reduz o unitário → confirma no ML → aumenta o kit.
- **Desmontar:** reduz o kit → confirma no ML → aumenta o unitário.

"Confirma" é ler o saldo vivo: o 200 do QStash não prova escrita no canal. Falha no meio deixa a
peça sem oferta, nunca em dois lugares, e precisa de recuperação automática ou alerta. Peça em
trânsito não pode sumir do ledger.

### Reposição automática [Diego]

Configuração por kit:

- **Meta:** quantos kits manter em cada combinação e tamanho publicado.
- **Piso:** mínimo de peças que fica no unitário em cada cor e tamanho.
- **Modo manual:** nada move sozinho; o sistema avisa no Telegram quando uma combinação acaba.

Dispara após venda do kit, entrada de mercadoria, cancelamento e ajuste manual. Move só o que deixa
todas as cores acima do piso. Sem peça suficiente, o kit vende até zerar, sai do ar e volta sozinho
quando houver peça.

**Risco aceito pelo Diego:** venda do unitário durante a transferência pode gravar saldo desatualizado
no ML. O sistema lê o saldo vivo antes de mover, o que reduz mas não zera. O modo manual não tem
esse risco. Transferências rodam na fila serial por organização (`estoque-{orgId}`) **[agente]**.

Se várias combinações disputam peças, a distribuição é decisão do construtor, desde que seja
determinística e registrada.

**A tela de criar kit precisa explicar isso [Diego].** Meta, piso e modo manual ficam acompanhados
de texto e exemplo na própria tela, para não confundir. Exemplo a exibir, usando os valores digitados
pelo operador (Preto + Branco M, meta 3, piso 2):

| Situação | O que acontece |
|---|---|
| Vendeu 1 kit, saldo foi para 2, e o unitário tem 10 de cada | O sistema move 1 peça de cada cor para o kit |
| O unitário de Preto M está em 2 | Não move, porque o piso protege o unitário; o kit vende até acabar |
| Chegou mercadoria | O sistema repõe os kits até a meta |
| Kit zerou e o unitário está no piso | O kit sai do ar e volta sozinho quando entrar peça |

## Publicação no ML

- Uma família User Products. Cada combinação × tamanho é um item, igual às grades atuais.
- `COLOR` = texto da combinação, ex.: `Preto, Branco, Marrom e Azul Marinho`, sem `value_id` **[medir]**.
- MLB3112 não tem `SALE_FORMAT` nem `UNITS_PER_PACK`. Em categoria que tiver, preencher com a
  quantidade de peças (ADR-0071).
- Categoria e atributos vêm da base, sem IA **[agente]**.
- Custo e peso = soma das peças **[Diego aceitou]**. Dimensões seguem a regra do ADR-0151: altura × N,
  editável **[agente]**.
- GTIN: nenhum por padrão, como no ADR-0151 **[agente]**.
- Preço único para todas as combinações e tamanhos **[Diego]**. Sugestão inicial: soma dos preços
  unitários **[agente]**.
- A troca de tamanho pode levar a outra combinação quando faltar item: mesmo "pulo" que Diego aceitou
  em 20/09 para os unitários.

## Texto por IA [Diego]

Título e descrição precisam dizer que é kit, com a quantidade escolhida. É uma etapa própria, que
roda na criação e aparece na prévia editável. **Não** usar `process-familia`, que recusa kit e
reescreveria o texto como produto comum. Isso difere do ADR-0151 D-3 e o ADR novo registra.

Reprocessar não pode reescrever o kit: manter a trava de `reprocessar-familia` e `process-familia`.

## Foto [Diego]

Cada combinação publicada precisa de imagem própria, porque `COLOR` define a foto no ML.

- **Empresa com IA de imagem ligada:** o padrão é gerar a partir das fotos das cores escolhidas,
  com o modelo de Configurações (`ai_model_imagem`). O operador pode gerar outra ou enviar a dele.
- **Empresa sem IA de imagem:** envio obrigatório. Sem foto em toda combinação publicada, publicar
  fica bloqueado.
- Foto gerada só publica depois de aprovada na prévia.

A habilitação é um módulo novo por empresa, ligado em Daludi · Administração da plataforma
(`org-settings`, `modulos_habilitados`).

A tela de Configurações diz que o campo não é usado por nenhuma feature: atualizar o texto.

## Cobrança de imagem [Diego]

- Cobrar por imagem gerada na fatura, igual ao Sonar: preço por unidade na condição comercial de cada
  empresa, com evento medido e auditável.
- Conta toda imagem gerada com sucesso, inclusive a descartada. Falha de geração não cobra **[agente]**.
- Registrar também o custo real para a Daludi. `_shared/ai/tokens.ts` conta custo zero para modelo
  fora de `PRECOS`: incluir os modelos de imagem.
- A carteira e o demonstrativo mostram quantidade e valor.

## Testes antes de construir [medir]

1. `POST /items/validate` em MLB3112 com `COLOR` combinada, `MAIN_COLOR` e `SIZE`.
2. Publicar 2 combinações × 2 tamanhos e confirmar seletor, agrupamento e reativação. Cria anúncio
   real: exige autorização do Diego.
3. Política do ML sobre imagem gerada por IA.
4. Qualidade: 2 ou 3 imagens com fotos reais de um produto do Diego.
5. Custo real por imagem no OpenRouter.

Falha em 1 ou 2 reabre o desenho de publicação. Falha em 3 ou 4 reabre a foto: empresas passam a
enviar imagem.

## Deixado para o construtor

- Modelo de dados do kit, das combinações e da composição por SKU.
- Mecanismo de recuperação de transferência interrompida.
- Geração de código dos SKUs, usando `proximo_codigo_produto()`.
- Prompt de imagem e tratamento de fundo.
- Layout final, seguindo o padrão do sistema e `src/components/ui/select.tsx`.

## Documentos a escrever

ADR novo antes da implementação (`git fetch` antes de escolher o número), incluindo o quarto sentido
de "kit" no glossário. Emendas: ADR-0151 (IA no texto) e ADR-0074 (imagem deixa de ser dormente).
