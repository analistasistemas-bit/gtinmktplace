# ADR-0181 — Entrada de mercadoria por nota de compra (XML) e pacote do contador

**Data:** 2026-10-15
**Status:** proposto. Design fechado em grilling com o Diego, revisado pelo Codex `gpt-6-astra`
(FALTA-INFORMAÇÃO → lacunas respondidas abaixo e validadas pelo Diego). Nada implementado.
**Desenha:** V2 #2 do [ADR-0135](0135-cadastro-fiscal-e-faturador-do-ml.md) (entrada por XML do fornecedor)
e parte da V2 #1 (consumo da nota emitida, só para exportação).
**Emenda:** ADR-0135 D-5 (origem passa a aceitar sugestão confirmada vinda da nota).
**Relacionado:** [0094](0094-estoque-unico-cadastro-manual.md) (ledger e entrada),
[0110](0110-ajuste-de-estoque-so-reduz.md) (ajuste), [0055](0055-imposto-por-origem-nacional-importado.md)
/ [0107](0107-origem-obrigatoria-na-planilha.md) (origem binária), [0026](0026-generalizacao-categorizacao-atributos-por-ia.md)
(sugere, humano decide).

## Contexto

Uma org nova (PJ, Simples Nacional, comércio, PE, sem ERP, emissão pelo Faturador do ML) quer
importar as NF-e de compra para adiantar o cadastro e dar entrada no estoque. Também precisa
repassar à contabilidade o que um ERP entregaria. O XML de exemplo (`NFe 2626…0320`, fornecedor
Distribuidora Magazine 1) mostra os pontos que o desenho precisa cobrir:

- o item da nota **não traz a grade** (`REF 06 · Short masculino - DIV - DIV · 35 PC`);
- CSOSN 102 e CFOP 5102 são do **fornecedor**;
- o arquivo é uma **exportação do ERP do fornecedor**, não o XML original da SEFAZ: sem
  `<Signature>` e com `<nItem>` como elemento em vez de atributo de `<det>`.

Termos no [glossário](../reference/glossario.md): Nota de compra, Item da nota, Vínculo de
fornecedor, Distribuição na grade, Custo de aquisição, Custo de precificação, Descrição fiscal.

## Decisões

**D-1 — Onde e quem.** Assistente "Importar nota de compra" dentro de `/estoque`, sem menu novo.
Gate: módulo `estoque` + `tipo_pessoa = pj` + CNPJ na `empresa_fiscal`. A etapa fiscal só aparece com o
módulo `fiscal` ligado. Notas, vínculos, arquivos e exportações são org-scoped: chaves
`(org_id, chave)` e `(org_id, cnpj_fornecedor, cprod)`, XML em storage privado e autorização
também nos workers.

**D-2 — Aceitação da nota.** Aceita os dois formatos, o XML da SEFAZ (`nfeProc` assinado) e a exportação
de ERP. Valida:
- o dígito verificador da chave;
- o destinatário = CNPJ da org;
- `cStat = 100` quando houver protocolo;
- a coerência entre a soma dos itens e o total da nota.

Nota sem assinatura entra com o aviso "cópia sem assinatura". O risco de fraude é baixo, porque quem
envia é a própria org. Só entram CFOPs de **venda/revenda do fornecedor** (`51xx`/`61xx`, ST
`54xx`/`64xx`); bonificação, remessa, devolução e demais naturezas são recusadas com o motivo. A
chave já importada não é recusada às cegas: reabre a importação para conferir ou retomar.

**D-3 — A nota de compra é documento à parte.** Ela guarda o XML original, o cabeçalho e os itens,
com **valores exatos da nota**, sem arredondar por unidade: `vProd`, `vFrete`, `vSeg`, `vDesc`,
`vOutro`, `vIPI`, `vST` por item. Depois de concluída, não muda. O ledger
(`estoque_movimentos`) segue como hoje: guarda quantidade e **custo de precificação**. Por isso **`registrar_entrada`
não muda de semântica**. O custo de aquisição (e o médio do inventário) vive nas notas; o custo de precificação vive no SKU e no ledger.
O pacote do contador lê das notas, nunca do ledger.

**D-4 — Importação atômica.** Uma RPC nova aplica a nota inteira numa transação, ou nada. Ela chama
`registrar_entrada` por SKU com `ref = chave:nItem:SKU`, o que torna a reexecução idempotente e evita a
colisão entre SKUs do mesmo item. Produto **cadastrado a partir da nota nasce com saldo 0**, porque o saldo
vem só da nota e o estoque inicial do `cadastrar-produto` não pode duplicar a entrada. A distribuição
confirmada é congelada; corrigir depois é ação explícita (D-10).

**D-5 — Descrição fiscal é campo próprio da família.** Nasce pré-preenchida com o `xProd`, é
editável e é o que vai no `title` do `fiscal_information`. `nome_pai` continua alimentando a IA do
título; família sem descrição fiscal usa `nome_pai`, como hoje.
*Rejeitado:* reusar `nome_pai`, porque a mesma frase serviria à nota e à IA. *Rejeitado:* `xProd` literal,
porque o `DIV - DIV` sairia na nota de venda.

**D-6 — Vínculo de fornecedor, com conversão de unidade.**
- **Chave:** `(CNPJ emitente + cProd) → código do PAI`. O código do PAI é estável entre lotes; o SKU é
  resolvido na família mais recente, como no estoque canônico.
- **Criação e uso:** nasce na primeira importação ("cadastrar novo" ou "vincular a existente"), casa
  sozinho nas seguintes e pode ser trocado.
- **Conversão de unidade:** o vínculo guarda o fator `uCom → peça` (ex.: `1 CX = 12 PC`). É perguntado
  uma vez e a distribuição é sempre em unidades de estoque inteiras.
- **GTIN:** casa quando presente e válido; `SEM GTIN` nunca casa; GTIN em conflito exige escolha.
- **Código do produto:** produto novo usa o código sequencial do `cadastrar-produto`; o `cProd` nunca
  vira código. Recompra não sobrescreve cadastro já confirmado.

**D-7 — Distribuição na grade fecha exata, em qualquer SKU.** A quantidade do item (já convertida)
é repartida entre variações, e a soma tem que fechar exata. O vínculo só pré-seleciona o produto: uma
REF genérica pode ser distribuída entre SKUs de **produtos diferentes**, sem conceito novo. Produto
sem grade recebe direto. **Falta física** vira ajuste depois (ADR-0110). **Sobra física** é entrada
manual separada.
*Rejeitado:* aceitar divergência ou "saldo a distribuir", porque a entrada deixaria de espelhar o
documento.

**D-8 — Variação nova nasce só no PubliAI, não publicada.** Quando a nota traz tamanho ou cor que a
família não tem, a variação é criada localmente como **não publicada** e vai ao ML pelo fluxo normal
de revisão. A importação nunca publica nada (revisão humana obrigatória). O caminho existente
(`adicionar-variacoes-familia`) publica; a importação não o reusa como está.
*A verificar no plano:* o push de estoque precisa ignorar SKU ausente do anúncio.

**D-9 — Custo documentado, custos adicionais e custo de precificação.**
- **Custo da nota:** `vProd` mais frete, seguro, IPI, ST e outras despesas, menos o desconto. Usa os
  valores **discriminados por item** do XML; o rateio proporcional (por valor, fechando os centavos com
  o total) só cobre o que vier apenas no total.
- **Custos adicionais documentados:** CT-e de frete de compra, seguro e guias pagas à parte. São
  vinculados à nota e aos itens beneficiados e rateados. **Integram o custo de aquisição**, conforme o
  parecer (CPC 16 itens 11/16/18, NBC TG 1002 13.2).
- **Custo de precificação:** `variacoes.custo`, um custo **gerencial**. Nasce igual ao custo de
  aquisição, é editável pelo operador e alimenta markup e preço (ADR-0055 intocado). Não integra o
  pacote contábil, que reflete só os documentos fiscais e o custo de aquisição deles.

*Decisão do Diego (2026-10-15), contra a recomendação do parecer simulado (item 5):* o parecer pedia
que, quando o custo de precificação refletir valor efetivamente pago acima do documentado, a
diferença fosse informada à contabilidade com comprovante. O Diego manteve o custo de precificação
fora do pacote. A orientação contábil desse caso fica com a empresa e o contador dela.

A tela mostra lado a lado o custo de aquisição e o custo de precificação.

**D-10 — Fiscal da nota é sugestão confirmada (emenda o D-5 do ADR-0135).**
- **NCM, `origem_nfe` e `familias.origem`:** chegam pré-preenchidos e marcados "veio da nota do
  fornecedor". Só são gravados com confirmação ativa, item a item.
- **Origem:** a do fornecedor é traduzida para a operação da revenda. Compra no mercado interno de
  mercadoria importada é diferente de importação direta, então o valor documental é preservado e a
  origem de saída é confirmada.
- **CSOSN/CST e CFOP do fornecedor:** nunca são copiados. O CSOSN de saída vem de um **"CSOSN padrão
  de revenda" da `empresa_fiscal`**, informado com o contador, que aparece no produto para confirmar
  e nunca é aplicado em silêncio.

**D-11 — Desfazer e cancelamento.** **Desfazer importação** é só para admin: reduz o saldo via
`ajustar_estoque`, marca a nota como `desfeita` (não apaga) e é recusado listando os SKUs quando parte já
foi vendida (saldo insuficiente). O **cancelamento fiscal** da nota pelo fornecedor não é detectável sem
certificado: o operador marca a nota como cancelada e o caminho é o mesmo do desfazer.

**D-12 — Inventário é foto, não reconstrução.** O sistema não reconstrói inventário de data passada
pelo ledger: o ledger é apagável por `limpar_movimentos_orfaos`, e o saldo vindo da planilha não passa
por ele. Entrega:
- **"inventário de hoje"**: saldo × custo médio de aquisição;
- **foto automática em 31/12**: gravada e imutável, para o **Livro Registro de Inventário (modelo 7)**,
  obrigatório (CGSN 140 art. 63, II). Campos: data-base, CNPJ/IE, código, descrição, NCM, unidade,
  quantidade, custo unitário, valor total, cor/tamanho.

O **critério de avaliação** é o **custo médio ponderado móvel** por variação, recalculado a cada entrada a
partir do custo de aquisição (nota + adicionais) e guardado nas notas. Nunca o último custo, que é só de
precificação (NBC TG 1002 13.1/13.5).

A foto separa:
- estoque próprio no estabelecimento;
- estoque próprio **em terceiros (Full)**;
- mercadoria de terceiros.

A empresa **confirma a contagem física**; diferenças justificadas viram ajuste. SKU sem nenhuma nota
importada aparece marcado "sem nota de compra", nunca com custo inventado.

**D-13 — Pacote do contador, mensal, em `/estoque`.** É um zip com:
- **compras:** XMLs originais e planilha de entradas (data, fornecedor, CNPJ, número, chave, CFOP,
  NCM, CSOSN, quantidade e valores da nota);
- **inventário:** D-12;
- **vendas:** XMLs de venda, eventos (cancelamento, CC-e) e devoluções do Faturador do ML, obtidos **ao vivo** pelo
  **download por período** da API na hora da exportação, **sem gravar** no PubliAI. O download por
  período é preferido à busca pedido a pedido, que perde devolução emitida para pedido antigo.
  *Decisão do Diego (2026-10-15):* as notas de venda ficam sempre disponíveis no portal do ML, e guardar
  cópia só inflaria o banco. A **conservação legal** (LC 123 art. 26, II) é da empresa, apoiada no
  repositório do ML e no pacote exportado que ela entrega ao contador.
  - Vai em lotes retomáveis com manifesto de documentos e falhas.
  - API indisponível ≠ ausência de nota; pacote parcial é declarado como parcial.
  - Inclui conciliação pedidos × notas e vendas sem nota.
  - Inclui planilha item a item (data, número, chave, valor, CFOP, NCM, CEST, CSOSN, UF, status).
  - Devolução entra no mês de emissão da nota de devolução.
- **devoluções emitidas fora do ML:** a devolução **ao fornecedor** é emitida pela própria org (CFOP
  5.202/6.202), por emissor externo, como o Emissor gratuito do Sebrae. O PubliAI **importa** esse XML,
  vincula à nota de compra e baixa o estoque. Reembolso de venda sem retorno físico **não** volta ao
  estoque.

O PubliAI **não classifica** ST nem monofásico. Cada item sai com a coluna **"tratamento fiscal:
pendente/validado"**, preenchida pela contabilidade. Totais por CSOSN são só auxiliares, e o CSOSN da
compra nunca define a tributação da revenda (parecer, pergunta 3). Confecção dos capítulos 61/62
não é monofásica por padrão.

O pacote **não substitui** livro Caixa, DEFIS nem escrituração.

**Fora desta entrega (fase futura nomeada):** dados de Mercado Livre e Mercado Pago (vendas brutas,
tarifas, fretes, publicidade, estornos, repasses) para o livro Caixa. O PubliAI já tem esses dados no
Financeiro, e o contador precisa deles todo mês. Repasse líquido **não** é faturamento: a base do Simples é a
venda bruta (LC 123 art. 3º, §1º).

## Parecer do contador (simulado)

> Gerado em 2026-10-15 pelo Codex `gpt-6-astra` **no papel de contador** da empresa (Simples, comércio,
> Recife/PE). Serve para destravar o desenho e **não substitui o contador real**. Cada "não verificado"
> abaixo segue pendente.

1. **Inventário:** custo médio ponderado móvel (PEPS também é admitido; o último custo não serve).
   O inventário em 31/12 é obrigatório no Livro Registro de Inventário mod. 7 (CGSN 140 art. 63, II;
   Convênio SINIEF s/nº 1970 art. 76). → D-12.
2. **Custo de aquisição:** inclui frete de compra mesmo em CT-e separado, seguro, manuseio, e ICMS-ST
   e IPI suportados; desconto comercial reduz. Ficam **fora**: juros, multa, desconto financeiro
   condicionado, comissão ML, publicidade e frete de entrega ao comprador (CPC 16; LC 123 art. 23). → D-9.
3. **PGDAS-D:** revenda de confecção = Anexo I, normal. ST/antecipação **com encerramento** é segregada;
   antecipação de PE **sem encerramento** é recolhida fora do DAS e não sai da receita (LC 123 art. 13
   §1º XIII; art. 18 §4º-A I; RICMS/PE Dec. 44.650/2017 arts. 328, 338–340, 363). → D-13 (coluna de
   tratamento validado).
4. **Devolução ao fornecedor:** a PUBLIAI emite (RICMS/PE arts. 530–531), por exemplo pelo Emissor
   Sebrae (gratuito); CFOP 5.202/6.202. A **devolução de venda** o Faturador do ML emite. → D-13.
5. **Custo pago acima do documentado:** informar à contabilidade com comprovante; custo gerencial é
   permitido (Lei 8.137/1990 arts. 1º II/IV, 2º V). → **Não adotado** (D-9, decisão do Diego).
6. **O que o contador recebe:**
   - **todo mês:** vendas (XMLs, eventos, devoluções, conciliação); compras e estoque (XMLs, CT-e,
     divergências); ML/MP (bruto, tarifas, repasses), que é fase futura; extratos, despesas e tributos
     pagos, que ficam com a empresa;
   - **todo ano:** inventário confirmado, movimento anual, fechamento financeiro e sócios.
   - **Obrigações:** PGDAS-D (dia 20), DEFIS (31/03), livros Caixa/Entradas/Inventário (CGSN 140
     art. 63), DeSTDA em PE (dia 28; dispensa do CNPJ não verificada). SEF/EFD só acima do sublimite
     (não verificado).

**Ressalvas não verificadas:** CNAE, Cacepe, sublimite e regime especial da empresa; ST e benefícios de
PE por mercadoria; formalidades estaduais do livro de inventário; uso de NFA-e; fluxo de devolução na
conta do ML.

## Consequências

O cliente sem ERP sai com cadastro, estoque e um pacote mensal a partir de documentos que já recebe.
Guardar a nota como documento à parte custa uma tabela nova, mas mantém o caminho financeiro
existente intacto e dá ao contador dados exatos. A busca de XML de venda ao vivo não guarda passivo,
mas depende da API do ML no momento da exportação.

## A verificar antes de codar

1. `fiscal_information.title` é o texto impresso no `xProd` da nota do Faturador (conta de teste).
2. Download por período dos XMLs do Faturador: autenticação, filtros (canceladas e devoluções),
   histórico disponível, volume e bytes por mês, limites, e CPU e memória da montagem do zip (ADR-0173).
3. O push de estoque ignora o SKU não publicado (D-8).
4. Validar o pacote com o **contador real** do cliente. O parecer abaixo é simulado.
5. Pedir ao fornecedor um XML original da SEFAZ e testar os dois formatos (D-2).
