// Validação real de 11/11 (Fita Veludo 16 mm): dados da família e retorno do modelo de texto, lidos só leitura do
// banco (sem ids). O retorno é o conteúdo gravado na versão 1, no formato do modelo (sem `ativa`, campos vazios
// preenchidos); textos literais, cenas 3–7 encurtadas. As legendas da missão 2 foram apagadas pelo operador antes da leitura.
import { montarFicha, type Fato } from '../../fatos'

const DESCRICAO_ML = '🧵 QUALIDADE PARA SUAS FIXAÇÕES\n\nA Fita de Veludo de 16mm é a solução ideal para quem busca fixação firme, praticidade e alta resistência em detalhes delicados. Confeccionada em 100% poliéster durável, esta peça de 25 metros oferece alto rendimento e ótimo custo-benefício para produções em escala, vindo com a fita dupla (macho e fêmea completos). \n\nIdeal para fechamentos de roupas infantis, ajustes de acessórios compactos, organização de fios e fixaçõe precisas no artesanato em geral.\n\n✅ BENEFÍCIOS\n\n✔ Alta resistência\n✔ Praticidade na aplicação\n✔ Excelente aderência\n✔ Ótimo custo-benefício\n✔ Discrição no visual\n✔ Ideal para detalhes delicados\n\n📌 ESPECIFICAÇÕES\n\n• Unidade de venda: PC\n• Composição: 100% poliéster\n• Metragem: 25 metros\n\n🎯 INDICAÇÕES DE USO\n\n✔ Fechamentos de roupas\n✔ Ajustes de acessórios\n✔ Organização de fios\n✔ Artesanato em geral\n\n🎨 CORES DISPONÍVEIS\n\n- Branco\n- Preto\n\n📦 CONTEÚDO DA EMBALAGEM\n\n• 1 unidade do produto na cor de sua escolha\n\n🚚 ENVIO RÁPIDO\n\nProduto à pronta entrega com envio rápido e seguro para todo o Brasil.\n\nAproveite e garanta já a sua fita de veludo!'

const DESCRICAO_PAI = 'O FECHO DE CONTATO (VELCRO) DA BÚFALO DE 16MM É A SOLUÇÃO IDEAL PARA QUEM BUSCA FIXAÇÃO FIRME, PRATICIDADE E ALTA RESISTÊNCIA EM DETALHES DELICADOS. CONFECCIONADA EM 100% POLIÉSTER DURÁVEL, ESTA PEÇA DE 25 METROS OFERECE ALTO RENDIMENTO E ÓTIMO CUSTO-BENEFÍCIO PARA PRODUÇÕES EM ESCALA, VINDO COM A FITA DUPLA (MACHO E FÊMEA COMPLETOS). COM UMA LARGURA FINA E MUITO DISCRETA, ELE GARANTE EXCELENTE ADERÊNCIA SEM PESAR NO VISUAL, SENDO PERFEITO PARA FECHAMENTOS DE ROUPAS INFANTIS, AJUSTES DE ACESSÓRIOS COMPACTOS, ORGANIZAÇÃO DE FIOS E FIXAÇÕES PRECISAS NO ARTESANATO EM GERAL.'

/** Ficha como a edge monta (planilha + medidas por SKU da embalagem + atributos ML + descrição confirmada). */
export const fatosFita = (): Fato[] => montarFicha({
  planilha: { nome: 'FITAS DE VELUDO 16MM CORES C/25MTS', descricao_fornecedor: DESCRICAO_PAI, marca: null, origem: 'importado' },
  medidasPorSku: Object.fromEntries(['02864002', '02928469'].map((s) => [s, { peso_gramas: '287.00', altura_cm: '3.50', largura_cm: '24.50', comprimento_cm: '24.50' }])),
  atributosML: [
    { id: 'BRAND', value_name: 'BUFALO' }, { id: 'RIBBON_TYPE' }, { id: 'IS_DOUBLE_FACE' }, { id: 'RIBBON_FORMAT' },
    { id: 'WIDTH', value_name: '16 mm' }, { id: 'LENGTH', value_name: '25 m' }, { id: 'MATERIAL', value_name: '100% poliéster' },
    { id: 'UNITS_PER_PACK', value_name: '1' },
  ],
  textosIA: { titulo_ml: 'FITAS VELUDO 16MM 25M | 100% POLIÉSTER | ALTA RESISTÊNCIA', descricao_ml: DESCRICAO_ML },
  confirmados: [{ campo: 'descricao_ml', valor: DESCRICAO_ML, origem: 'confirmado_operador', evidencia: null, descartado: false }],
})

const vazio = { headline: '', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [] }

/** Retorno "sujo" do modelo (o que gerou os erros da validação real). */
export const retornoFita = () => ({
  contrato: 'Representar sempre a fita de veludo para fecho de contato, com largura identificada como 16 mm, em duas faces correspondentes (macho e fêmea). Manter as duas faces na mesma cor escolhida: branco ou preto. Mostrar o produto em rolo ou em segmentos de fita, sem alterar a aparência de veludo nem sugerir que as duas cores vêm juntas. Não mostrar embalagem, rótulo ou escala não informados. Não inserir texto na imagem.',
  missoes: [
    { ...vazio, missao: 1, cena: 'Imagem de capa com as duas faces da fita em rolos organizados, na cor escolhida, sobre fundo limpo e neutro. Enquadramento claro do produto, sem embalagem, sem elementos escritos e sem texto na cena.', fatosUsados: [] },
    {
      ...vazio, missao: 2, cena: 'A fita em uso em exemplos separados: fechamento de roupa infantil, ajuste de acessório compacto, organização de fios e projeto de artesanato. Manter a fita discreta e coerente com a cor escolhida. Sem texto na cena.',
      headline: 'Versátil no dia a dia', subheadline: 'Para roupas, acessórios e artesanato',
      fatosUsados: ['descricao_fornecedor', 'descricao_ml'],
    },
    {
      ...vazio, missao: 3, cena: 'Close das duas faces da fita, macho e fêmea, lado a lado e na mesma cor. Sem texto na cena.',
      headline: 'Fita dupla completa', subheadline: 'Faces macho e fêmea',
      beneficios: ['Largura fina e discreta', 'Aderência em detalhes delicados', 'As duas faces incluídas'], fatosUsados: ['nome', 'descricao_fornecedor', 'descricao_ml'],
    },
    {
      ...vazio, missao: 4, cena: 'Composição visual da fita ao lado de aplicações delicadas, como roupa infantil e acessório compacto. Sem texto na cena.',
      headline: 'Fixação prática e discreta', subheadline: 'Para detalhes delicados',
      beneficios: ['Alta resistência', 'Praticidade na aplicação', 'Excelente aderência'], fatosUsados: ['descricao_fornecedor', 'descricao_ml'],
    },
    {
      ...vazio, missao: 5, cena: 'Apresentação organizada do rolo e das duas faces da fita. Sem texto na cena.',
      headline: 'Dados do produto', subheadline: 'Fita de veludo para fecho',
      specs: [
        { campo: 'nome', rotulo: 'Produto', valor: 'FITAS DE VELUDO 16MM CORES C/25MTS' },
        { campo: 'descricao_ml', rotulo: 'Composição', valor: '100% poliéster' },
        { campo: 'descricao_ml', rotulo: 'Metragem', valor: '25 metros' },
        { campo: 'descricao_ml', rotulo: 'Cores disponíveis', valor: 'Branco ou preto' },
      ],
      fatosUsados: ['nome', 'descricao_ml'],
    },
    {
      ...vazio, missao: 6, cena: 'Sequência visual em quatro quadros mostrando a escolha de uma aplicação e a união das fitas. Sem texto na cena.',
      headline: 'Como aplicar', subheadline: 'Use nas fixações do dia a dia',
      etapas: ['Escolha a aplicação desejada', 'Separe as faces da fita', 'Posicione no local de fechamento', 'Una as faces para fixar'],
      fatosUsados: ['descricao_fornecedor', 'descricao_ml'],
    },
    {
      ...vazio, missao: 7, cena: 'Fotografia macro da textura de veludo e das duas faces correspondentes. Sem texto na cena.',
      headline: 'Detalhes da fita', subheadline: 'Veludo com fecho de contato',
      legendas: ['Faces macho e fêmea', 'Largura de 16 mm', '100% poliéster'], fatosUsados: ['nome', 'descricao_fornecedor', 'descricao_ml'],
    },
  ],
})
