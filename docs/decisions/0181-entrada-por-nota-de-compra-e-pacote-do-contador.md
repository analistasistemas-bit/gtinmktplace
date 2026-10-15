# ADR-0181 — Entrada de mercadoria por nota de compra (XML) e pacote do contador

**Data:** 2026-10-15
**Status:** proposto (design fechado em grilling com o Diego; nada implementado)
**Desenha:** V2 #2 do [ADR-0135](0135-cadastro-fiscal-e-faturador-do-ml.md) (entrada por XML do fornecedor)
e parte da V2 #1 (consumo da nota emitida, só para exportação).
**Emenda:** ADR-0135 D-5 (origem passa a aceitar sugestão confirmada vinda da nota).
**Relacionado:** [0094](0094-estoque-unico-cadastro-manual.md) (ledger e entrada),
[0110](0110-ajuste-de-estoque-so-reduz.md) (ajuste), [0055](0055-imposto-por-origem-nacional-importado.md)
/ [0107](0107-origem-obrigatoria-na-planilha.md) (origem binária), [0026](0026-generalizacao-categorizacao-atributos-por-ia.md)
(sugere, humano decide).

## Contexto

Uma org nova (PJ, Simples, sem ERP, emissão pelo Faturador do ML) quer importar as NF-e de compra para
adiantar o cadastro e dar entrada no estoque, e precisa repassar à contabilidade o que um ERP
entregaria. O XML real de exemplo (`NFe 2626…0320`, fornecedor Distribuidora Magazine 1) mostra os
pontos que o desenho precisa cobrir:

- o item da nota **não traz a grade** (`REF 06 · Short masculino - DIV - DIV · 35 PC`);
- CSOSN 102 e CFOP 5102 são do **fornecedor**, não do revendedor;
- a descrição do item é a que deve sair na nota de venda, e não é o título do anúncio.

Termos no [glossário](../reference/glossario.md): Nota de compra, Item da nota, Vínculo de
fornecedor, Distribuição na grade, Custo da nota, Custo real, Descrição fiscal.

## Decisões

**D-1 — Onde.** Assistente "Importar nota de compra" dentro de `/estoque`, sem menu novo. Gate:
módulo `estoque`; a etapa fiscal só aparece com o módulo `fiscal` ligado. A nota é recusada (LOUD,
nada gravado) quando:
- o destinatário ≠ CNPJ da `empresa_fiscal`;
- o `cStat` ≠ 100;
- a chave já foi importada.

A idempotência por item usa `chave + nItem` como `ref` da `entrada-estoque`, que já existe.

**D-2 — Descrição fiscal é campo próprio da família.** Nasce pré-preenchida com o `xProd`, é
editável e é o que vai no `title` do `fiscal_information`. `nome_pai` continua alimentando a IA do
título; família sem descrição fiscal usa `nome_pai`, como hoje.
*Rejeitado:* reusar `nome_pai`, porque a mesma frase serviria à nota e à IA e editar uma mudaria a
outra. *Rejeitado:* `xProd` literal travado, porque o `DIV - DIV` sairia na nota de venda.

**D-3 — Distribuição na grade fecha exata.** O item da nota é repartido entre as variações da família;
só confirma quando a soma = `qCom`. Diferença física vira **ajuste** depois (ADR-0110), com rastro
próprio. Produto sem grade recebe direto.
*Rejeitado:* aceitar divergência com motivo e "saldo a distribuir", porque criam estado novo e a
entrada deixa de espelhar o documento.

**D-4 — Vínculo de fornecedor.** `(CNPJ emitente + cProd) → código do PAI` (estável entre lotes; há
uma família por lote). É criado na primeira importação ("cadastrar novo" ou "vincular a existente") e
casa sozinho nas seguintes, com troca possível; GTIN da nota também casa. Produto novo usa o código
sequencial que o `cadastrar-produto` já gera; o `cProd` do fornecedor nunca vira código do produto.

**D-5 — Dois custos.** O **custo da nota** é `vProd` mais o rateio proporcional de
`vFrete`/`vSeg`/`vIPI`/`vST`/`vOutro`, menos `vDesc`, por unidade. Ele vai para o contador e fica no
ledger. O **custo real** (`variacoes.custo`) nasce igual ao da nota e é editável, porque o fornecedor às
vezes fatura abaixo do negociado; ele alimenta markup e preço. A regra de "último custo" não muda
(ADR-0055 intocado). A tela mostra os dois lado a lado.
*Rejeitado:* um custo só, porque o real nos livros diverge dos XMLs e o da nota infla o markup.

**D-6 — Fiscal da nota é sugestão confirmada (emenda o D-5 do ADR-0135).** NCM, `origem_nfe` (do
`orig`) e `familias.origem` (nacional/importado) chegam pré-preenchidos e marcados "veio da nota do
fornecedor". Só são gravados com confirmação ativa, item a item, no mesmo padrão do NCM por IA (D-9 do
ADR-0135). O CSOSN/CST e o CFOP do fornecedor **nunca** são copiados. A trava de coerência entre as
duas origens continua.

**D-7 — Pacote do contador, mensal, em `/estoque`.** É um zip com:
- **compras:** XMLs originais (guardados ≥ 5 anos), planilha de entradas (data, fornecedor, CNPJ,
  número, chave, NCM, quantidade, custo da nota);
- **inventário:** em qualquer data, a custo da nota;
- **vendas:** XMLs de venda e de devolução buscados **ao vivo** no ML por `order_id`
  (`xml_location` com a nota `AUTHORIZED`), sem gravar no banco, e planilha por nota (data, número,
  chave, valor, CSOSN, NCM, status), com totais do mês separados em receita normal / receita com ST /
  devoluções. Venda sem nota autorizada é listada à parte, nunca omitida.

Despesas do canal (tarifas, frete, repasses do Mercado Pago) ficam fora agora.

## Consequências

O cliente sem ERP sai com cadastro, estoque e fechamento mensal a partir de documentos que já
recebe. Custo duplo é mais um conceito na tela, mas é o único jeito de markup e livros ficarem certos
ao mesmo tempo. A busca de XML de venda ao vivo não guarda passivo, mas depende da API do ML no
momento da exportação e precisa de lotes para meses grandes (CPU de edge, ADR-0173).

## A verificar antes de codar

1. `fiscal_information.title`: confirmar em conta de teste que é o texto impresso no `xProd` da nota
   do Faturador (a doc oficial recusou acesso automatizado em 2026-10-15).
2. Forma da resposta de `GET /users/{id}/invoices/orders/{order_id}`, incluindo as notas de devolução e o
   acesso a `xml_location` (autenticado ou URL pública).
3. Com o contador do cliente: o pacote D-7 basta para o PGDAS-D e o inventário? A segregação por ST e
   monofásico veio de conhecimento geral, não de fonte verificada.
4. Notas de compra fora de "compra para revenda" (bonificação, remessa, devolução): recusar ou
   tratar. Fora da v1 até aparecer caso real.
