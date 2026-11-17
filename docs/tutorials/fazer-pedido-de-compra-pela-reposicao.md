# Fazer um pedido de compra pela Reposição

> **Tipo:** Tutorial para o operador.
> **Objetivo:** do que repor até o estoque recebido, sem planilha.
> **Pré-requisito:** módulo Reposição ligado para a sua organização.

## 1. Configurar (uma vez, admin)

Na primeira abertura, informe o **prazo de reposição** (dias entre pedir e a mercadoria chegar) e a **cobertura desejada** (dias de venda que você quer ter depois da chegada). Valem para todos os fornecedores. Só admin altera depois.

## 2. Ler a grade

- Os cards de topo mostram quantos produtos estão em **Ruptura**, **Vai faltar**, **Pedir agora** e **Em dia**.
- Abra uma família: o mapa de cor × tamanho mostra, em cada célula, estoque, o que pedir e a urgência. Clique na célula para ver o **por que** daquela quantidade (velocidade, curva, folga).
- Produto com poucas vendas usa a curva da família; a tela diz quantos ainda estão estimados.
- **Fora de linha** (marcado no **Estoque**: menu ⋯ do produto → "Fora de linha…") tira um produto inteiro ou uma cor da sugestão. Ela some da Reposição (ligue "Mostrar fora de linha" para vê-la) e os itens dela saem do rascunho; voltar à linha não os devolve. O estoque que sobra continua à venda e o anúncio no ML não muda. As outras cores do produto são recalculadas.
- **Não repor este tamanho** (no popover da célula) tira só um SKU da sugestão; a linha continua na grade, riscada.
- O **múltiplo de compra** (só admin) arredonda o total da família.

## 3. Montar o rascunho

Use **Adicionar ao pedido** nas células ou famílias. O rascunho é da organização, por fornecedor, salvo e compartilhado: outro membro vê e edita. Ajuste quantidades e a data prevista na barra do rascunho e salve. Os administradores recebem o aviso de rascunho esperando.

## 4. Aprovar e enviar (admin)

O admin revisa e **aprova**. Depois de aprovado, só admin edita. Use **Copiar para WhatsApp** para gerar o texto do pedido; copiar marca o pedido como **Enviado** (ou marque à mão).

## 5. Receber

- **Por nota de compra:** importe o XML em Estoque. O sistema pré-seleciona o pedido aberto do fornecedor do CNPJ emitente. Se o fornecedor do pedido ainda não tem CNPJ, confirme que ele passa a ser identificado pelo CNPJ da nota.
- **Por entrada manual:** em Estoque, "Entrada"; responda "De qual pedido?" ou escolha "nenhum" (não baixa pedido).
- Excedente entra no estoque e fecha o item. Desfazer a nota desfaz a baixa.

## 6. Saldo parcial

Se chegou menos, o pedido fica **Parcial** e o sistema pergunta se o restante ainda vem. Responder "não" mostra os itens que serão encerrados e **encerra o saldo**; dá para reabrir depois. Pedido passado da data prevista aparece como **Atrasado**.
