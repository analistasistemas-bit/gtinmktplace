# Calculadora Mercado Livre Premium — Design

**Data:** 2026-08-18  
**Status:** aprovado pela orientação “siga o recomendado”  
**Escopo:** versão A — calculadora essencial, sem persistência e sem precificação em massa

## Objetivo

Adicionar ao menu Viabilidade uma calculadora unitária que ajude o dono ou gestor da operação a responder, antes de investir em estoque:

1. Vale a pena comprar este produto?
2. Por quanto devo vendê-lo no Mercado Livre?

O resultado não se limita a números. A experiência emite um veredito explicável: **Comprar**, **Negociar custo**, **Ajustar preço** ou **Evitar**.

## Princípios

- **API oficial primeiro:** comissão, taxa fixa e frete devem vir da conta Mercado Livre da organização quando houver categoria e dados suficientes.
- **Estimativa nunca se disfarça de precisão:** qualquer fallback manual ou projeção precisa estar rotulado.
- **Decisão antes do estoque:** o foco é evitar compras inviáveis e revelar a negociação necessária.
- **Procedência visível:** cada valor informa se veio da API ML, do produto cadastrado, do usuário ou de uma estimativa.
- **Sem efeitos operacionais:** a versão A não salva simulações nem altera produtos, anúncios, estoque ou tenant data.

## Escopo

### Incluído

- Nova modalidade **Calculadora ML** dentro de Viabilidade.
- Produto cadastrado opcional com preenchimento de dados disponíveis.
- Busca de categoria por texto e validação por ID `MLB...` usando a API oficial.
- Categoria opcional com modo manual degradado claramente notificado.
- Comparação Clássico e Premium.
- Comissão, taxa fixa e frete oficiais quando calculáveis.
- Frete manual como fallback explícito.
- Custo, preço, impostos, custos fixos, custos variáveis e rebate.
- Altura, largura, comprimento, peso real, peso cubado e peso utilizado.
- Margem-alvo, preço de equilíbrio, preço projetado para a meta e custo máximo de compra.
- Veredito e explicação acionável.
- Sensibilidade simples a custo, preço e frete.
- Estados responsivos, acessíveis, vazios, de carregamento e erro.

### Fora do escopo

- Salvar ou compartilhar simulações.
- Precificação em massa.
- Alterar cadastro, custo, preço, estoque ou anúncio.
- Copiar tabelas estáticas da Pronix como fonte de verdade.
- Garantir que uma projeção de preço continue na mesma faixa de tarifa sem revalidação.

## Arquitetura recomendada

### 1. Superfície

`src/pages/Viabilidade.tsx` ganha um nível superior de navegação:

- **Análise de mercado:** preserva integralmente o fluxo atual de planilha/GTIN.
- **Calculadora ML:** monta a nova experiência unitária.

A nova superfície deve ser isolada em componentes próprios; a página existente apenas alterna as modalidades.

### 2. Busca de categoria

Criar uma edge function somente leitura para pesquisa de categorias. Ela reutiliza `buscarCategoriaPreditor` de `supabase/functions/_shared/ml/domain-discovery.ts`, aceita texto ou ID `MLB...`, exige usuário autenticado e usa a conexão ML da organização.

Não reutilizar diretamente a action de `atributos-familia`: ela exige `familia_id`, tem autorização de escrita e pertence a outro caso de uso.

Contrato sugerido:

```ts
type BuscarCategoriaRequest = { query: string }
type CategoriaCandidata = {
  domainId: string
  domainName: string
  categoriaId: string
  categoriaNome: string
}
type BuscarCategoriaResponse = { candidatos: CategoriaCandidata[] }
```

Regras:

- busca com debounce;
- mínimo de caracteres para texto comum;
- ID `MLB...` validado diretamente;
- resultados ordenados pela API;
- nenhuma seleção automática silenciosa;
- categoria escolhida sempre exibe nome e ID.

### 3. Cotação oficial

Reutilizar `calcularTarifaML` e a edge `calcular-tarifa-ml` para obter:

- comissão total Clássico e Premium;
- percentual e taxa fixa de cada modalidade;
- frete absorvido pelo vendedor;
- valor recebido após comissão e frete.

A consulta é habilitada somente quando preço, categoria e contexto mínimo forem válidos. A resposta deve ser associada à chave preço + categoria + dimensões + peso para evitar resultado atrasado em campos já alterados.

Dimensões ausentes não podem transformar frete `0` em “frete grátis”. A UI deve mostrar **Frete não calculado** e exigir dimensões válidas ou valor manual.

### 4. Motor de decisão

Criar um módulo TypeScript puro, sem React e sem rede. Ele recebe entradas normalizadas e uma cotação oficial ou manual e devolve todos os resultados derivados.

```ts
interface EntradaCalculadoraML {
  precoVenda: number
  custoProduto: number
  aliquotaImpostoPct: number
  custosFixos: number
  custosVariaveis: number
  rebate: number
  margemAlvoPct: number
  dimensoes?: { alturaCm: number; larguraCm: number; comprimentoCm: number; pesoKg: number }
}

interface CotacaoModalidade {
  origem: 'api_ml' | 'manual'
  percentual: number
  taxaFixa: number
  comissaoTotal: number
  frete: number | null
}
```

Fórmulas-base:

```text
pesoCubadoKg = alturaCm × larguraCm × comprimentoCm ÷ 6000
pesoUtilizadoKg = max(pesoRealKg, pesoCubadoKg)
imposto = preçoVenda × alíquota / 100
custoTotal = custoProduto + comissãoTotal + frete + imposto + custosFixos + custosVariáveis − rebate
lucro = preçoVenda − custoTotal
margemPct = lucro ÷ preçoVenda × 100
lucroAlvo = preçoVenda × margemAlvoPct / 100
custoMaximoCompra = preçoVenda − comissãoTotal − frete − imposto − custosFixos − custosVariáveis + rebate − lucroAlvo
```

O preço de equilíbrio e o preço para margem-alvo podem ser calculados analiticamente no modo manual. Com cotação oficial, são **projeções** baseadas na estrutura da cotação atual, pois taxa fixa e frete podem mudar ao cruzar faixas. A ação **Validar na API** recalcula no preço sugerido antes de promovê-lo a resultado oficial.

### 5. Procedência e precisão

Cada campo derivado carrega origem e nível de confiança:

- `api_ml`: valor oficial para a conta e parâmetros consultados;
- `produto`: preenchido do cadastro do PubliAI;
- `usuario`: informado manualmente;
- `estimado`: projeção ou fallback.

Estados globais de precisão:

- **Oficial:** categoria, comissão e frete validados na API.
- **Parcial:** categoria válida, mas frete sem dimensões ou manual.
- **Estimativa:** sem categoria; comissão e frete manuais.

O estado deve permanecer visível junto ao resultado, não apenas como toast.

## Experiência e hierarquia

Modo da superfície: **Operate**. A feature herda o sistema visual existente do PubliAI; não copia a identidade da Pronix.

### Desktop

- Coluna esquerda: contexto, entradas comerciais e logística com divulgação progressiva.
- Coluna direita fixa durante a rolagem: precisão, veredito, métricas e comparação de modalidades.
- A Central de decisão é o ponto focal, acima da decomposição contábil.

### Mobile

- Fluxo em coluna única.
- Resumo compacto permanece acessível após o primeiro cálculo.
- Clássico/Premium usam controle segmentado em vez de duas colunas apertadas.
- Tabelas de decomposição viram listas rotuladas, sem rolagem horizontal obrigatória.

### Fluxo

1. Selecionar produto cadastrado ou iniciar produto avulso.
2. Pesquisar e escolher categoria; “Continuar sem categoria” é permitido, mas ativa aviso persistente.
3. Informar custo, preço, impostos e despesas.
4. Informar dimensões/peso ou ativar frete manual.
5. Receber comparação Clássico/Premium e veredito em tempo real.
6. Ajustar margem-alvo e testar recomendações de preço/custo.
7. Validar na API qualquer preço projetado antes de tratá-lo como oficial.

## Veredito

O veredito é determinístico e explica suas entradas. Não usa LLM.

- **Comprar:** margem atual igual ou superior à meta, lucro positivo e sem lacuna crítica de precisão.
- **Negociar custo:** lucro não atinge a meta e o custo máximo calculado é menor que o custo informado.
- **Ajustar preço:** o preço projetado alcança a meta; deve ser validado na API.
- **Evitar:** prejuízo ou distância da meta sem ajuste plausível pelos números disponíveis.
- **Dados insuficientes:** preço/custo inválidos ou ausência simultânea de cotação e valores manuais.

Quando mais de uma ação for possível, priorizar a decisão de compra: mostrar primeiro o custo máximo negociável e, em seguida, o preço projetado.

O texto deve citar números: “Negocie o custo de R$ 30,00 para até R$ 24,60 para alcançar 12% de margem”. Não usar apenas cor ou adjetivos.

## Diferenciais premium

1. **Categoria inteligente:** sugestões oficiais com nome, domínio e ID.
2. **Rastreabilidade:** procedência por valor e estado global de precisão.
3. **Meta reversa:** custo máximo e preço necessário para atingir a margem escolhida.
4. **Sensibilidade acionável:** impactos objetivos de pequenas mudanças em custo, preço e frete.
5. **Veredito explicado:** ação recomendada com números e limitações.

Esses diferenciais pertencem à versão A. Persistência, colaboração e lote continuam fora do escopo.

## Estados e falhas

### Vazio

Explicar em uma frase que a calculadora avalia a compra e o preço. Exibir campos essenciais primeiro; não mostrar cartões de resultado zerados como se fossem informação.

### Categoria ausente

Permitir modo manual após ação explícita. Exibir banner persistente e selo de estimativa. Informar que comissão, taxa fixa e frete podem variar por categoria.

### API indisponível ou conta desconectada

- preservar todas as entradas;
- não substituir valores oficiais por zero;
- explicar qual consulta falhou;
- oferecer tentar novamente ou migrar conscientemente para modo manual;
- não salvar tokens, respostas sensíveis ou dados de outra organização.

### Dimensões incompletas

Comissão pode ser oficial, mas frete permanece “não calculado”. Oferecer completar dimensões/peso ou informar frete manual.

### Concorrência de requisições

Ignorar respostas de categoria ou cotação que não correspondam ao estado atual. React Query deve usar chaves completas e debounce; alterações rápidas não podem piscar números antigos como oficiais.

### Valores inválidos

Rejeitar negativos onde não fizerem sentido, preço zero, percentuais fora da faixa e dimensões parciais. Exibir erro junto ao campo e preservar o restante da simulação.

## Acessibilidade e conteúdo

- Navegação completa por teclado.
- Labels reais para todos os controles.
- Estados de lucro/prejuízo comunicados por texto, ícone e cor.
- Resultados dinâmicos anunciados sem excesso; evitar live region a cada tecla.
- Valores em `pt-BR`, mas cálculos armazenados como números.
- Foco levado ao primeiro erro apenas no envio/validação explícita, não durante digitação.
- Respeitar redução de movimento.

## Testes

### Unidade — motor puro

- peso cubado e escolha do maior peso;
- imposto, comissão, taxa fixa, frete, rebate e custos;
- Clássico/Premium;
- custo máximo, equilíbrio e margem-alvo;
- arredondamento monetário;
- vereditos e explicações;
- frete `null` diferente de `0`;
- projeção diferente de valor validado.

### Unidade — categoria

- texto comum e ID `MLB...`;
- resposta vazia, erro e timeout;
- autenticação e isolamento por organização;
- nenhuma mutação de família.

### Componentes

- produto avulso e produto cadastrado;
- categoria opcional e aviso persistente;
- alternância entre API e manual;
- carregamento, erro, retry e resposta obsoleta;
- procedência dos números;
- teclado e nomes acessíveis;
- layout móvel da comparação.

### Integração

- categoria selecionada aciona cotação correta;
- mudar preço/dimensões invalida a cotação anterior;
- validar preço projetado substitui projeção por cotação oficial;
- falha da API nunca aparece como custo zero.

## Segurança e tenancy

- Toda edge function exige autenticação e resolve a organização pelo usuário.
- A conta ML consultada é sempre a conexão da organização, nunca inferida do navegador ou de texto do produto.
- Nenhuma operação escreve em `familias`, `variacoes`, `lotes`, estoque ou anúncios.
- Cache inclui organização e todos os parâmetros que alteram a cotação.
- Logs não incluem token OAuth.

## Entregáveis de implementação

- Registro de produto em `PRODUCT.md`.
- Especificação atual.
- Motor puro e testes.
- Busca read-only de categorias e cliente frontend.
- Componentes da Calculadora ML e integração na Viabilidade.
- Estados premium, responsivos e acessíveis.
- Testes direcionados, detector Impeccable e verificação visual desktop/mobile.

## Roteamento Orquestração Codex

O Sol mantém planejamento, integração e decisão final.

- **Terra — motor e contratos:** motor puro, tipos, fórmulas, vereditos e testes unitários.
- **Terra — API e integração:** edge read-only de categoria, reutilização de cotação e testes de contrato/tenancy.
- **Luna — superfície UI:** componentes e estados conforme contrato já fechado, após motor e contratos estabilizados.
- **Luna — testes de componente:** cobertura de estados e acessibilidade sem sobrepor arquivos de implementação.

As tarefas dependentes não serão paralelizadas antes dos contratos do motor/API. O Sol revisa, integra, executa a verificação final e resolve conflitos.

