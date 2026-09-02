"use strict";

// =================================================================================================
// PARSER.JS — Extração de dados de documentos (RG, CPF, carteira de trabalho, comprovante de
// residência, cadastro de clientes CAIXA, Espelho da Proposta SIOPI) via OCR (Tesseract.js) +
// PDF.js, 100% no navegador.
// As CHAVES retornadas em "encontrados" são os IDs literais dos campos no documento oficial da
// DAMP (id="print_area", reproduzido sem alterações em index.html) — main.js usa essas chaves
// para preencher diretamente pelo id, sem tocar na estrutura do documento.
// =================================================================================================

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3/build/pdf.min.js';
const PDFJS_WORKER_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3/build/pdf.worker.min.js';
const TESSERACT_LANG_PATH = 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0_fast';

const IR_ANO_BASE_PADRAO = String(new Date().getFullYear() - 1);
const IR_ANO_EXERCICIO_PADRAO = String(new Date().getFullYear());

let bibliotecasCarregadas = false;
let carregandoBibliotecas = null;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
    document.head.appendChild(script);
  });
}

function carregarBibliotecasOCR() {
  if (bibliotecasCarregadas) return Promise.resolve();
  if (carregandoBibliotecas) return carregandoBibliotecas;

  carregandoBibliotecas = Promise.all([
    carregarScript(TESSERACT_SRC),
    carregarScript(PDFJS_SRC),
  ]).then(() => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    }
    bibliotecasCarregadas = true;
  });

  return carregandoBibliotecas;
}

// Converte as páginas de um PDF em imagens (dataURL). Varre o PDF inteiro (até maxPaginas), pois
// os dados úteis costumam estar em páginas internas de um cadastro, não na capa.
async function pdfParaImagens(arquivo, maxPaginas = 15) {
  const bufferArquivo = await arquivo.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: bufferArquivo }).promise;
  const totalPaginas = Math.min(pdf.numPages, maxPaginas);
  const imagens = [];

  for (let numeroPagina = 1; numeroPagina <= totalPaginas; numeroPagina++) {
    const pagina = await pdf.getPage(numeroPagina);
    // scale 2 (~144 DPI) deixava números pequenos (ex.: valores em R$) vulneráveis a erro de
    // dígito no OCR (ex.: "365.000,00" lido como "285.000,00"). scale 3 (~216 DPI) dá mais pixels
    // por caractere pro Tesseract, reduzindo bastante esse tipo de confusão de dígito.
    const viewport = pagina.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    imagens.push(canvas.toDataURL('image/png'));
  }

  return imagens;
}

const TERMOS_IGNORADOS_NOME = [
  'REPUBLICA', 'REPÚBLICA', 'FEDERATIVA', 'BRASIL', 'CARTEIRA', 'IDENTIDADE', 'TRABALHO',
  'PREVIDENCIA', 'PREVIDÊNCIA', 'SOCIAL', 'MINISTERIO', 'MINISTÉRIO', 'SECRETARIA', 'REGISTRO',
  'GERAL', 'NASCIMENTO', 'FILIACAO', 'FILIAÇÃO', 'NATURALIDADE', 'CPF', 'PIS', 'PASEP', 'NIT',
  'VALIDA', 'VÁLIDA', 'TERRITORIO', 'TERRITÓRIO', 'NACIONAL', 'ASSINATURA', 'ORGAO', 'ÓRGÃO',
  'DADOS', 'CADASTRAIS', 'IDENTIFICACAO', 'IDENTIFICAÇÃO', 'DECLARACAO', 'DECLARAÇÃO',
  'PROPOSITOS', 'PROPÓSITOS', 'ENDERECO', 'ENDEREÇO', 'MEIOS', 'COMUNICACAO', 'COMUNICAÇÃO',
  'RENDAS', 'COMPROVADAS', 'INFORMAIS', 'RELACIONAMENTO', 'AGENCIA', 'AGÊNCIA', 'CADASTRO',
  'CLIENTES', 'FORMULARIO', 'FORMULÁRIO', 'IMPRESSAO', 'IMPRESSÃO',
];

function buscarAposRotulo(texto, regexRotulo, regexValor, distanciaMax = 60) {
  const re = new RegExp(regexRotulo, 'gi');
  let match;
  while ((match = re.exec(texto)) !== null) {
    const inicioJanela = match.index + match[0].length;
    const janela = texto.slice(inicioJanela, inicioJanela + distanciaMax);
    const valorMatch = janela.match(regexValor);
    if (valorMatch) return (valorMatch[1] || valorMatch[0]).trim();
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return null;
}

function buscarTodosAposRotulo(texto, regexRotulo, regexValor, distanciaMax = 60) {
  const re = new RegExp(regexRotulo, 'gi');
  const encontrados = [];
  let match;
  while ((match = re.exec(texto)) !== null) {
    const inicioJanela = match.index + match[0].length;
    const janela = texto.slice(inicioJanela, inicioJanela + distanciaMax);
    const valorMatch = janela.match(regexValor);
    if (valorMatch) encontrados.push((valorMatch[1] || valorMatch[0]).trim());
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return encontrados;
}

// Procura um rótulo e, na janela de texto seguinte, decide SIM/NÃO (aceita variações como
// "SIM"/"S" x "NÃO"/"NAO"/"N", e também frases redigidas em 1ª pessoa quando fizer sentido).
function buscarSimNao(texto, regexRotulo, distanciaMax = 80) {
  const re = new RegExp(regexRotulo, 'gi');
  let match;
  while ((match = re.exec(texto)) !== null) {
    const inicioJanela = match.index + match[0].length;
    const janela = texto.slice(inicioJanela, inicioJanela + distanciaMax);
    const naoMatch = janela.match(/\bN[ÃA]O\b/i);
    const simMatch = janela.match(/\bSIM\b/i);
    // usa o que aparecer primeiro na janela (mais próximo do rótulo)
    if (naoMatch && (!simMatch || naoMatch.index <= simMatch.index)) return 'nao';
    if (simMatch) return 'sim';
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return null;
}

function buscarBlocoAposRotulo(texto, regexRotulo, distanciaMax = 150) {
  const re = new RegExp(regexRotulo, 'i');
  const match = re.exec(texto);
  if (!match) return null;

  const inicioJanela = match.index + match[0].length;
  const janela = texto.slice(inicioJanela, inicioJanela + distanciaMax);
  const linhasDoValor = [];

  for (const linhaBruta of janela.split('\n')) {
    const linha = linhaBruta.trim();
    if (linha === '' || linha.includes(':')) break;
    linhasDoValor.push(linha);
  }

  return linhasDoValor.length > 0 ? linhasDoValor.join(' ').trim() : null;
}

// Isola um trecho do texto entre o início de uma seção (regexInicio) e o início da seção seguinte
// (regexFim) — usado para não deixar um regex de campo "vazar" para outro bloco/participante que
// repete os mesmos rótulos (ex.: CPF/Nome/Data de Nascimento aparecem em até 4 blocos diferentes
// no Espelho da Proposta SIOPI: Responsável Técnico, Vendedor, Construtor e Proponente/Comprador).
function fatiaSecao(texto, regexInicio, regexFim, tamanhoMaxSemFim = 2500) {
  const indiceInicio = texto.search(regexInicio);
  if (indiceInicio === -1) return null;

  const restante = texto.slice(indiceInicio);
  if (!regexFim) return restante.slice(0, tamanhoMaxSemFim);

  const indiceFim = restante.slice(1).search(regexFim);
  return indiceFim === -1 ? restante.slice(0, tamanhoMaxSemFim) : restante.slice(0, indiceFim + 1);
}

// ---- Regra estrita de formatação do endereço do imóvel (Seção 5), sempre em 2 linhas ----
// Linha 1 (vai no <div class="editableDiv"> do documento): LOGRADOURO, NÚMERO - COMPLEMENTO - BAIRRO
// Linha 2 (campos text_logradouro2 / text_uf2): CIDADE / UF
// Formato pedido pelo usuário para o campo "5 - IMÓVEL OBJETO DO FINANCIAMENTO" (a <div
// class="editableDiv"> logo abaixo de "O imóvel objeto da aquisição está localizado à"):
// LOGRADOURO ; NÚMERO - COMPLEMENTO - MUNICIPIO - UF - CEP
// Cada parte é opcional (fica de fora quando não foi encontrada) — só o separador muda: "LOGRADOURO"
// e "NÚMERO" ficam unidos por " ; ", o resto (COMPLEMENTO, MUNICIPIO, UF, CEP) por " - ".
function formatarLinha1EnderecoImovel({ logradouro, numero, complemento, municipio, uf, cep }) {
  const logradouroNumero = [logradouro, numero].filter(Boolean).join(' ; ');
  const partes = [logradouroNumero, complemento, municipio, uf, cep].filter(Boolean);
  return partes.length ? partes.join(' - ') : null;
}

// Formata um número JS pro padrão monetário brasileiro usado nos campos da DAMP: "1.234,56".
function formatarValorMonetario(numero) {
  const arredondado = Math.round(numero * 100) / 100;
  const [parteInteira, parteDecimal] = arredondado.toFixed(2).split('.');
  return `${parteInteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${parteDecimal}`;
}

// Regex do "corpo" de um valor monetário no texto do OCR — bem tolerante de propósito, porque o
// separador de milhar sai errado do OCR com frequência (ponto, vírgula E até hífen — já vimos o
// Tesseract imprimir "280-000.00" para "280.000,00"). Aceita qualquer sequência de dígitos separada
// por ".", "," ou "-", com ou sem "R$" na frente.
const REGEX_CORPO_VALOR_MONETARIO = /R?\$?\s*(\d[\d.,-]{3,17}\d)/;

// Extrai um valor monetário de um trecho de texto de OCR e devolve tanto o número (pra contas)
// quanto o texto já no formato "1.234,56" (pro campo da DAMP) — ignora qualquer separador que não
// seja dígito e assume sempre os 2 últimos dígitos como centavos (é como o Espelho sempre formata).
function normalizarValorMonetarioOCR(textoBruto) {
  if (!textoBruto) return null;
  const digitos = textoBruto.replace(/\D/g, '');
  if (digitos.length < 3) return null; // precisa de pelo menos 1 dígito de real + 2 de centavos
  const numero = Number(`${digitos.slice(0, -2)}.${digitos.slice(-2)}`);
  if (!Number.isFinite(numero)) return null;
  return { numero, texto: formatarValorMonetario(numero) };
}

// Calcula o Valor Compra e Venda a partir de dois campos numéricos independentes e menores
// (Valor Financiamento Negociado, Cota de Financiamento Calculada em %) — usa a mesma relação que
// a própria SIOPI usa pra gerar a Cota: Financiamento = Cota% × Compra e Venda. Serve de conferência
// contra erro de dígito do OCR no valor de compra e venda (que é sempre o maior número da tabela e
// por isso o mais fácil de o OCR errar 1 dígito sem se notar).
function calcularValorCompraEVendaPelaCota(valorFinanciamentoTexto, cotaTexto) {
  if (!valorFinanciamentoTexto || !cotaTexto) return null;
  const financiamentoNormalizado = normalizarValorMonetarioOCR(valorFinanciamentoTexto);
  const cota = Number(cotaTexto.replace(',', '.')) / 100;
  if (!financiamentoNormalizado || !Number.isFinite(cota) || financiamentoNormalizado.numero <= 0 || cota <= 0) return null;
  return financiamentoNormalizado.numero / cota;
}

const CAMPOS_REGRA_FIXA = [
  'chkir1', 'text_irano1', 'text_irexerc1', 'chkir2', 'text_irano2', 'text_irexerc2',
  // Modalidade/enquadramento: o Espelho da Proposta é a fonte mais confiável pra esses campos (é
  // o documento oficial da operação). Ficam na lista de "regra fixa" pra sempre valerem o que o
  // Espelho encontrar, mesmo que outro documento da fila (ex.: cadastro/RG, que às vezes tem texto
  // de instrução/boilerplate parecido) tenha marcado uma opção diferente antes dele na fila.
  'chkmodalidade1', 'text_enquad1', 'chkmodalidade2', 'text_enquad2', 'chkmodalidade3', 'text_enquad3',
  'chkmodalidade4', 'text_enquad4', 'chkmodalidade5', 'text_enquad5', 'chkmodalidade6', 'text_enquad6',
  'chkmodalidade7', 'text_enquad7',
  'chkenquadramento1', 'chkenquadramento2', 'chkenquadramento3', 'chkenquadramento4', 'chkenquadramento5', 'chkenquadramento6',
];

// -------------------------------------------------------------------------------------------
// ESPELHO DA PROPOSTA (SIOPI) — documento de tabela "rótulo / valor" (Nº da Proposta, dados do
// Proponente, dados do Imóvel, modalidade/enquadramento da operação). Diferente da carteira de
// trabalho/RG (texto corrido), aqui o mesmo rótulo se repete em vários blocos de participante, por
// isso cada campo é buscado dentro da FATIA de texto do bloco certo (fatiaSecao), nunca no texto
// inteiro.
// -------------------------------------------------------------------------------------------
function textoEhEspelhoDaProposta(texto) {
  return /CONCESS[ÃA]O\s*-\s*Espelho\s+da\s+Proposta/i.test(texto)
    || /SIOPI\s*-\s*Opera[çc][õo]es\s+Imobili[áa]rias/i.test(texto);
}

const MAPA_ESTADO_CIVIL_ESPELHO = [
  { valor: 'casado', regex: /CASADO/i },
  { valor: 'solteiro', regex: /SOLTEIRO/i },
  { valor: 'viuvo', regex: /VI[ÚU]VO/i },
  { valor: 'divorciado', regex: /DIVORCIADO/i },
];

// Regime de bens (select#selectRegime, só aparece na DAMP quando Estado Civil = "casado"). No
// Espelho costuma vir num rótulo próprio ("Regime de Bens", "Regime de Casamento" ou variações) logo
// perto do Estado Civil. A ordem importa: "COMUNHÃO UNIVERSAL" tem que ser testado ANTES de
// "COMUNHÃO" genérico não é usado aqui, mas "SEPARAÇÃO ... BENS" precisa vir antes de um "SEPARAÇÃO"
// solto (evita falso-positivo com "SEPARADO(A)" do Estado Civil, que não é regime de bens).
const MAPA_REGIME_BENS_ESPELHO = [
  { valor: 'universal', regex: /COMUNH[ÃA]O\s+UNIVERSAL/i },
  { valor: 'parcial', regex: /COMUNH[ÃA]O\s+PARCIAL/i },
  { valor: 'aquestos', regex: /PARTICIPA[ÇC][ÃA]O\s+FINAL\s+NOS\s+AQUESTOS/i },
  { valor: 'separacao', regex: /SEPARA[ÇC][ÃA]O\s+(?:TOTAL\s+)?DE\s+BENS/i },
];

// Modalidades do item 7 da DAMP que têm alguma correspondência plausível com o "Item de Produto"/
// "Tipo de Financiamento" do Espelho. NENHUM rótulo bate literalmente com "Imóvel Novo Individual"
// (ver ANALISE_ESPELHO_x_DAMP.md, item 3.2) — chkmodalidade1 é usado aqui como aproximação e deve
// ser confirmado com o time de negócio antes de ir para produção.
const MODALIDADES_ESPELHO = [
  // "Imóvel Novo" (compra na planta/concluído novo) E "Imóvel Usado" (revenda) caem os dois em
  // "Aquisição Imóvel Concluído - Venda e Compra" — a diferença entre novo/usado não muda a
  // modalidade da DAMP, só o valor de compra e venda.
  { chk: 'chkmodalidade1', valor: 'text_enquad1', regex: /Im[óo]vel\s+(?:Novo|Usado)/i },
  { chk: 'chkmodalidade2', valor: 'text_enquad2', regex: /Im[óo]vel\s+em\s+Constru[çc][ãa]o/i },
  { chk: 'chkmodalidade3', valor: 'text_enquad3', regex: /Terreno\s+e\s+Constru[çc][ãa]o/i },
  { chk: 'chkmodalidade4', valor: 'text_enquad4', regex: /Constru[çc][ãa]o\s+em\s+Terreno\s+Pr[óo]prio/i },
  { chk: 'chkmodalidade5', valor: 'text_enquad5', regex: /Reforma\s+e\/ou\s+Amplia[çc][ãa]o/i },
  { chk: 'chkmodalidade6', valor: 'text_enquad6', regex: /CCFGTS\s*[-–]\s*Conclus[ãa]o/i },
  { chk: 'chkmodalidade7', valor: 'text_enquad7', regex: /Material\s+de\s+Constru[çc][ãa]o/i },
];

// Regex que localiza o início do bloco de dados pessoais de cada participante, por tipo. O
// NÚMERO da seção varia de Espelho pra Espelho (2.4 quando tem Responsável Técnico/Vendedor/
// Construtor antes dela — imóvel novo; 2.1 quando não tem — imóvel usado), então nenhum dos dois
// fixa o número, só a frase que identifica o participante.
const REGEX_SECAO_POR_PARTICIPANTE = {
  // 1º Proponente/Comprador (o principal da operação)
  principal: /\d+(?:\.\d+)*\s*-\s*Dados\s+do\s+Participante\s*-\s*Proponente\s*\/?\s*Comprador/i,
  // 2º Proponente — aparece no Espelho como "Coobrigado/Proponente" (ex.: "2.1.1 - Dados do
  // Participante - Coobrigado/Proponente")
  coobrigado: /\d+(?:\.\d+)*\s*-\s*Dados\s+do\s+Participante\s*-\s*Coobrigado\s*\/?\s*Proponente/i,
};

// participante: 'principal' (1º Proponente/Comprador) ou 'coobrigado' (2º Proponente) — controla
// de qual bloco de participante os dados pessoais (CPF, Nome, Estado Civil, Endereço, Profissão,
// FGTS) são lidos. Os campos que são da PROPOSTA em si (modalidade, valor, enquadramento, imóvel)
// não mudam com o participante e são sempre lidos do documento inteiro, não deste bloco.
function extrairCamposDoEspelho(texto, participante = 'principal') {
  const encontrados = {};

  // ---- 1 - IDENTIFICAÇÃO DA PROPOSTA ----
  // Fonte PRIMÁRIA e mais confiável para CPF/Nome/Data de Nascimento — MAS só serve pro 1º
  // Proponente: essa seção do Espelho só traz o "CPF do Proponente"/"Nome do Proponente"
  // principal, nunca o do Coobrigado. Pro 2º Proponente, essa fonte é pulada e os dados vêm
  // direto do bloco "Coobrigado/Proponente" mais abaixo.
  if (participante === 'principal') {
    const secaoIdentificacao = fatiaSecao(
      texto,
      /1\s*-\s*IDENTIFICA[ÇC][ÃA]O\s+DA\s+PROPOSTA/i,
      /1\.1\s*-\s*Hist[óo]rico\s+do\s+SIRIC/i,
    );

    if (secaoIdentificacao) {
      const cpfProponente = buscarAposRotulo(secaoIdentificacao, 'CPF\\s+do\\s+Proponente\\s*:?', /(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/);
      if (cpfProponente) encontrados.text_cpf = cpfProponente;

      const nomeProponente = buscarAposRotulo(secaoIdentificacao, 'Nome\\s+do\\s+Proponente\\s*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{5,60})/);
      if (nomeProponente) encontrados.text_nome = nomeProponente;

      const dataNascimentoProponente = buscarAposRotulo(secaoIdentificacao, 'Data\\s+de\\s+Nascimento\\s*:?', /(\d{2}\/\d{2}\/\d{4})/);
      if (dataNascimentoProponente) encontrados.text_data1 = dataNascimentoProponente;
    }
  }

  // ---- Bloco de dados pessoais do participante selecionado (1º ou 2º Proponente) ----
  // Usado como FALLBACK de CPF/Nome/Data do 1º Proponente (caso a seção 1 não tenha sido lida
  // pelo OCR), e como fonte ÚNICA de tudo isso pro 2º Proponente/Coobrigado, além de Estado Civil
  // e Endereço (residência), que não aparecem rotulados "do Proponente" na seção 1 pra ninguém.
  const regexSecaoParticipante = REGEX_SECAO_POR_PARTICIPANTE[participante] || REGEX_SECAO_POR_PARTICIPANTE.principal;
  const secaoProponente = fatiaSecao(
    texto,
    regexSecaoParticipante,
    /3\s*-\s*IM[ÓO]VEL\b/i,
  );

  if (secaoProponente) {
    if (!encontrados.text_cpf) {
      const cpf = buscarAposRotulo(secaoProponente, 'CPF\\s*:?', /(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/);
      if (cpf) encontrados.text_cpf = cpf;
    }

    if (!encontrados.text_nome) {
      const nome = buscarAposRotulo(secaoProponente, 'Nome\\s*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{5,60})/);
      if (nome) encontrados.text_nome = nome;
    }

    if (!encontrados.text_data1) {
      const dataNascimento = buscarAposRotulo(secaoProponente, 'Data\\s+de\\s+Nascimento\\s*:?', /(\d{2}\/\d{2}\/\d{4})/);
      if (dataNascimento) encontrados.text_data1 = dataNascimento;
    }

    const estadoCivilEncontrado = MAPA_ESTADO_CIVIL_ESPELHO.find(({ regex }) => {
      // Colon obrigatório logo após "Civil" — evita casar com o rótulo vizinho "Estado Civil
      // SICLI:" (que tem "SICLI" entre "Civil" e o ":", então não bate aqui).
      const bloco = buscarAposRotulo(secaoProponente, 'Estado\\s+Civil\\s*:', /([A-ZÀ-Üa-zà-ü()]{4,20})/);
      return bloco && regex.test(bloco);
    });
    if (estadoCivilEncontrado) encontrados.selectEstCiv = estadoCivilEncontrado.valor;

    // Regime de bens — só faz sentido (e o campo só aparece na DAMP) quando o Estado Civil é
    // "casado". Procura numa janela um pouco maior que a do Estado Civil porque, no Espelho, o
    // regime normalmente vem numa linha/rótulo separado ("Regime de Bens:", "Regime de Casamento:"),
    // não colado no mesmo "Estado Civil:".
    if (estadoCivilEncontrado && estadoCivilEncontrado.valor === 'casado') {
      const blocoRegime = buscarAposRotulo(
        secaoProponente,
        'Regime\\s+de\\s+(?:Bens|Casamento)\\s*:?',
        /([A-ZÀ-Üa-zà-ü() ]{4,40})/,
        60,
      );
      // Fallback: se não achou um rótulo "Regime de Bens/Casamento" explícito, procura direto pelos
      // termos do regime dentro da mesma seção do proponente (alguns Espelhos trazem só o texto do
      // regime, sem rótulo próprio, ex.: "... CASADO(A) - COMUNHÃO PARCIAL DE BENS").
      const regimeEncontrado = MAPA_REGIME_BENS_ESPELHO.find(({ regex }) => regex.test(blocoRegime || secaoProponente));
      if (regimeEncontrado) encontrados.selectRegime = regimeEncontrado.valor;

      // Data "desde" do regime de bens (geralmente a mesma data do casamento).
      const dataRegime = buscarAposRotulo(secaoProponente, '(?:Data\\s+d[eo]\\s+)?Casamento\\s*:?', /(\d{2}\/\d{2}\/\d{4})/, 40);
      if (dataRegime) encontrados.text_data2 = dataRegime;
    }

    // Endereço (município/UF) do proponente — layout em tabela, rótulos "Município:"/"UF:" em
    // células separadas (não necessariamente na mesma linha do texto após OCR).
    const municipioProponente = buscarAposRotulo(secaoProponente, 'Munic[íi]pio\\s*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{2,40})/, 120);
    const ufProponente = buscarAposRotulo(secaoProponente, '\\bUF\\s*:?', /([A-Z]{2})\b/, 40);
    if (municipioProponente) encontrados.text_logradouro = municipioProponente;
    if (ufProponente) encontrados.text_uf1 = ufProponente;

    // ---- 2 - SITUAÇÃO OCUPACIONAL ----
    // Sempre marca a opção "Sou [profissão]..." (chkocupacao1) usando a Profissão do próprio
    // proponente, e usa o mesmo município/UF de residência como município da ocupação principal
    // (o Espelho não traz um endereço de trabalho separado).
    const profissaoProponente = buscarAposRotulo(secaoProponente, 'Profiss[ãa]o\\s*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{2,40})/, 80);
    if (profissaoProponente) {
      encontrados.chkocupacao1 = true;
      encontrados.text_ocupacao = profissaoProponente;
      if (municipioProponente) encontrados.text_localocupa = municipioProponente;
      if (ufProponente) encontrados.text_uf0 = ufProponente;
    }

    // "Possui conta no FGTS há mais de 03 anos..." do Espelho = "Possuo 36 meses de trabalho sob
    // o regime do FGTS" da DAMP (mesma coisa: 3 anos = 36 meses). Sim -> sn_1, Não -> sn_2.
    const possui3Anos = buscarSimNao(secaoProponente, 'Possui\\s+conta\\s+no\\s+FGTS\\s+h[áa]\\s+mais\\s+de\\s+03\\s+anos[^\\n]*?:?', 70);
    if (possui3Anos === 'sim') encontrados.sn_1 = true;
    else if (possui3Anos === 'nao') encontrados.sn_2 = true;
  }

  // ---- Campos da PROPOSTA em si (imóvel, modalidade/valor, enquadramento, nº operação, local/data
  // de assinatura) — SÓ são lidos/preenchidos para o 1º Proponente/Comprador ("principal"). Pro 2º
  // Proponente (Coobrigado), o formulário já foi preenchido com esses dados na 1ª extração e o
  // usuário pode ter ajustado algo manualmente na tela — preencher de novo aqui sobrescreveria esse
  // ajuste à toa, então esse bloco inteiro é pulado quando participante === 'coobrigado'.
  if (participante === 'principal') {
    // ---- 3 - IMÓVEL (3.1 Identificação + 3.2 Dados do Imóvel) ----
    const secaoImovel = fatiaSecao(texto, /3\s*-\s*IM[ÓO]VEL\b/i, /4\s*-\s*PESQUISA\s+DE\s+SUBS[ÍI]DIOS/i);

    if (secaoImovel) {
      const tipoLogradouro = buscarAposRotulo(secaoImovel, 'Tipo\\s+de\\s+Logradouro\\s*:?', /([A-ZÀ-Ü]{2,15})/);
      const logradouro = buscarAposRotulo(secaoImovel, '(?<!Tipo\\s+de\\s+)Logradouro\\s*:?', /([A-ZÀ-Ü0-9][A-ZÀ-Ü0-9 ]{1,60})/);
      const numero = buscarAposRotulo(secaoImovel, 'N[uú]mero\\s*:?', /(S\s?\/?\s?N\b|\d{1,6})/i, 15);
      const complemento = buscarAposRotulo(secaoImovel, 'Complemento\\s*:?', /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9,.º° ]{1,60})/);
      const municipioImovel = buscarAposRotulo(secaoImovel, 'Munic[íi]pio\\s*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{2,40})/, 120);
      // CEP: aceita com ou sem hífen/ponto ("74000-000", "74000000" ou, como o Espelho às vezes
      // formata, "74.000-000" com ponto de milhar no meio) — normaliza tudo pro padrão "00000-000".
      const cep = buscarAposRotulo(secaoImovel, 'CEP\\s*:?', /(\d{2}\.?\d{3}-?\d{3})/, 30);
      const cepFormatado = cep ? cep.replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') : null;

      const numeroFormatado = numero && /^S\s?\/?\s?N$/i.test(numero) ? 'SN' : numero;
      const logradouroCompleto = [tipoLogradouro, logradouro].filter(Boolean).join(' ') || logradouro;

      // UF do imóvel é sempre "GO" (regra de negócio pedida pelo usuário, não extraída do Espelho)
      // — usada tanto na linha do editableDiv quanto no campo separado text_uf2.
      const linha1 = formatarLinha1EnderecoImovel({
        logradouro: logradouroCompleto,
        numero: numeroFormatado,
        complemento,
        municipio: municipioImovel,
        uf: 'GO',
        cep: cepFormatado,
      });
      if (linha1) encontrados.editableDiv = linha1;
      // Só a cidade varia de proposta pra proposta — o imóvel objeto do financiamento é sempre em
      // Goiás (regra de negócio pedida pelo usuário, não extraída do Espelho).
      if (municipioImovel) encontrados.text_logradouro2 = municipioImovel;
      encontrados.text_uf2 = 'GO';
    }

    // ---- 1.2 - Dados da Proposta / 5.3 - Negociação da Proposta: modalidade e enquadramento ----
    // "Item de Produto" é o campo mais confiável para identificar a modalidade (ex.: "7017601100 -
    // NPMCMV - FS - Imóvel Novo Individual").
    const itemDeProduto = buscarAposRotulo(texto, 'Item\\s+de\\s+Produto\\s*:?', /([^\n]{5,120})/, 130);
    const textoModalidade = itemDeProduto || texto;
    const modalidadeEncontrada = MODALIDADES_ESPELHO.find(({ regex }) => regex.test(textoModalidade));
    if (modalidadeEncontrada) {
      encontrados[modalidadeEncontrada.chk] = true;
      // O valor que acompanha a modalidade é o "Valor Compra e Venda ou Orçamento Proposto pelo
      // Cliente" (seção 5.3) — não o "Valor Financiamento Negociado" (esse é só a parte financiada,
      // menor que o valor total do imóvel quando há entrada/recursos próprios). Busca "na mão" (em
      // vez de buscarAposRotulo) por dois motivos: 1) o OCR às vezes troca a vírgula decimal por
      // ponto ("432.600.00" em vez de "432.600,00"), então aceita os dois formatos; 2) se esse rótulo
      // não tiver valor logo em seguida (célula vazia na tabela), a janela de busca pode "vazar" e
      // pegar o número do campo vizinho "Valor Financiamento Negociado" — por isso, se a palavra
      // "Financiamento" aparecer ANTES de qualquer número dentro da janela, descarta (fica em branco
      // de propósito, em vez de preencher com o valor errado).
      const rotuloCompraEVenda = /Valor\s+Compra\s+e\s+Venda\s+ou\s+Or[çc]amento\s+Proposto\s+pelo\s+Cliente\s*:?/i;
      const matchRotulo = rotuloCompraEVenda.exec(texto);
      let valorLidoDireto = null;
      if (matchRotulo) {
        const janela = texto.slice(matchRotulo.index + matchRotulo[0].length, matchRotulo.index + matchRotulo[0].length + 40);
        const valorMatch = janela.match(REGEX_CORPO_VALOR_MONETARIO);
        const antesDoValor = valorMatch ? janela.slice(0, valorMatch.index) : '';
        if (valorMatch && !/Financiamento/i.test(antesDoValor)) {
          const valorNormalizado = normalizarValorMonetarioOCR(valorMatch[1]);
          if (valorNormalizado) {
            encontrados[modalidadeEncontrada.valor] = valorNormalizado.texto;
            valorLidoDireto = valorNormalizado.numero;
          }
        }
      }

      // ---- Conferência do valor contra erro de dígito do OCR ----
      // A própria SIOPI garante essa conta: Valor Financiamento Negociado = Cota de Financiamento
      // Calculada (%) × Valor Compra e Venda. São 2 números MENORES e mais fáceis do OCR acertar
      // (financiamento e a cota em %) — se o valor calculado por eles divergir muito do valor lido
      // direto acima, o dígito errado quase sempre está no valor de compra e venda (é o maior número
      // da tabela, ex.: OCR trocando "365.000,00" por "285.000,00", ou até embaralhando o separador
      // de milhar num hífen, "280-000.00"), então o valor calculado prevalece.
      const valorFinanciamentoTexto = buscarAposRotulo(texto, 'Valor\\s+Financiamento\\s+Negociado\\s*:?', REGEX_CORPO_VALOR_MONETARIO, 40);
      const cotaFinanciamentoTexto = buscarAposRotulo(texto, 'Cota\\s+de\\s+Financiamento\\s+Calculada\\s*:?', /(\d{1,3}(?:[.,]\d{1,4})?)\s*%/, 40);
      const valorCalculadoCompraEVenda = calcularValorCompraEVendaPelaCota(valorFinanciamentoTexto, cotaFinanciamentoTexto);
      if (valorCalculadoCompraEVenda) {
        const divergeDoCalculado = valorLidoDireto === null
          || Math.abs(valorCalculadoCompraEVenda - valorLidoDireto) / valorCalculadoCompraEVenda > 0.02; // >2% de diferença
        if (divergeDoCalculado) {
          encontrados[modalidadeEncontrada.valor] = formatarValorMonetario(valorCalculadoCompraEVenda);
        }
      }
    }

    // Regra de negócio: pra todo Espelho da Proposta processado aqui, o enquadramento é sempre a
    // 1ª opção ("CARTA DE CRÉDITO FGTS – CCFGTS/PMCMV OU CCFGTS-OPERAÇÕES ESPECIAIS") — não depende
    // de achar "CCFGTS" no OCR (esse texto é obrigatório em todos os casos deste fluxo).
    encontrados.chkenquadramento1 = true;

    // Nº OPERAÇÃO (aba "Contas FGTS" da DAMP) — só preenche quando o próprio Espelho traz o campo
    // homônimo preenchido; quando vier em branco (comum), o campo é deixado em aberto de propósito
    // (ver ANALISE_ESPELHO_x_DAMP.md, item 3.2 — não há regra de negócio definida para usar Código
    // da Reserva ou Nº Contrato para Administração como substituto).
    const numeroOperacaoDamp = buscarAposRotulo(
      texto,
      'N[uú]mero\\s+da\\s+Opera[çc][ãa]o\\s*-\\s*DAMP\\s*:?',
      /([\d.\-\/]{4,20})/,
      40,
    );
    if (numeroOperacaoDamp) encontrados.text_numdamp = numeroOperacaoDamp;

    // ---- Local/data da assinatura ----
    // Regra pedida pelo usuário: local sempre "GOIANIA" (fixo, não extraído do Espelho) e a data
    // sempre a data atual (do momento em que a extração é feita), nunca uma data do documento.
    encontrados.local_assin = 'GOIANIA';
    const hoje = new Date();
    encontrados.dia_assin = String(hoje.getDate()).padStart(2, '0');
    encontrados.ano_assin = String(hoje.getFullYear());
    const MESES_BR_ESPELHO = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    encontrados.mes_assin = MESES_BR_ESPELHO[hoje.getMonth()];
  }

  return { encontrados, secoesRendaEAgenciaEncontradas: false };
}

// Extrai os campos conhecidos de um texto já reconhecido por OCR, usando como chaves os IDs
// reais dos elementos no documento oficial da DAMP.
function extrairCamposDoTexto(texto) {
  const encontrados = {};

  const cpf = buscarAposRotulo(texto, 'CPF', /(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/);
  if (cpf) encontrados.text_cpf = cpf;

  const pis = buscarAposRotulo(texto, '(?:PIS|NIS|PASEP)', /(\d{3}\.?\d{5}\.?\d{2}-?\d{1})/);
  if (pis) encontrados.text_pis = pis;

  const dataNascimento = buscarAposRotulo(texto, 'Nascimento', /(\d{2}\/\d{2}\/\d{4})/)
    || (texto.match(/\b\d{2}\/\d{2}\/\d{4}\b/) || [])[0];
  if (dataNascimento) encontrados.text_data1 = dataNascimento;

  let nome = buscarAposRotulo(texto, 'Nome\\s+Completo[^\\n:]*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{5,60})/);
  if (!nome) {
    const linhasCandidatas = texto
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => {
        if (linha.length < 8 || linha.length > 60) return false;
        if (!/^[A-ZÀ-Ü][A-ZÀ-Ü\s]+$/.test(linha)) return false;
        const palavras = linha.split(/\s+/);
        if (palavras.some((palavra) => TERMOS_IGNORADOS_NOME.includes(palavra))) return false;
        return palavras.length >= 2;
      })
      .sort((a, b) => b.length - a.length);
    nome = linhasCandidatas[0];
  }
  if (nome) encontrados.text_nome = nome;

  // Item 1 - ESTADO CIVIL (select#selectEstCiv)
  if (/\bCASADO\b/i.test(texto)) encontrados.selectEstCiv = 'casado';
  else if (/\bSOLTEIRO\b/i.test(texto)) encontrados.selectEstCiv = 'solteiro';
  else if (/\bVI[ÚU]VO\b/i.test(texto)) encontrados.selectEstCiv = 'viuvo';
  else if (/\bDIVORCIADO\b/i.test(texto)) encontrados.selectEstCiv = 'divorciado';

  const matchMunicipioUF = texto.match(/Munic[íi]pio:?\s*([A-ZÀ-Ü][A-ZÀ-Ü ]*?)\s*UF:?\s*([A-Z]{2})\b/i);

  // Item 3 - RESIDÊNCIA (município/UF de residência = município do cadastro anexado)
  if (matchMunicipioUF) {
    encontrados.text_logradouro = matchMunicipioUF[1].trim();
    encontrados.text_uf1 = matchMunicipioUF[2].trim().toUpperCase();
  }

  // Tempo de residência ("há X anos e Y meses")
  const tempoResidencia = texto.match(/h[áa]\s*(\d{1,2})\s*anos?\s*e\s*(\d{1,2})\s*meses?/i);
  if (tempoResidencia) {
    encontrados.text_compl1 = tempoResidencia[1].padStart(2, '0');
    encontrados.text_compl2 = tempoResidencia[2].padStart(2, '0');
  }

  // Item 2 - SITUAÇÃO OCUPACIONAL
  const tipoOcupacao = buscarBlocoAposRotulo(texto, 'Tipo\\s+de\\s+Ocupa[cç][aã]o\\s*:?');
  if (tipoOcupacao) {
    encontrados.chkocupacao1 = true;
    encontrados.text_ocupacao = tipoOcupacao;
    if (matchMunicipioUF) {
      encontrados.text_localocupa = matchMunicipioUF[1].trim();
      encontrados.text_uf0 = matchMunicipioUF[2].trim().toUpperCase();
    }
  }

  // Item 3 - Possui imóvel (chkresidencia1 = não possuo / chkresidencia2 = possuo)
  if (/N[ãa]o\s+possu[íi]?\s+im[óo]vel/i.test(texto)) encontrados.chkresidencia1 = true;
  else if (/Possu[íi]?\s+im[óo]vel/i.test(texto)) encontrados.chkresidencia2 = true;

  // Item 5 - IMÓVEL OBJETO DO FINANCIAMENTO (endereço em 2 linhas)
  const indiceEnderecoImovel = texto.search(/ENDERE[ÇC]O\s+DO\s+IM[ÓO]VEL/i);
  if (indiceEnderecoImovel !== -1) {
    const blocoImovel = texto.slice(indiceEnderecoImovel, indiceEnderecoImovel + 500);

    const tipoLogradouroImovel = buscarAposRotulo(blocoImovel, 'Tipo\\s+de\\s+Logradouro\\s*:?', /([A-ZÀ-Ü]{2,20})/);
    const logradouroImovel = buscarAposRotulo(blocoImovel, '(?<!Tipo\\s+de\\s+)Logradouro\\s*:?', /([A-ZÀ-Ü0-9][A-ZÀ-Ü0-9 ]{1,60})/);
    const numeroImovelBruto = buscarAposRotulo(blocoImovel, 'N[uú]mero(?!\\s+d[oa])\\s*:?\\s*', /(S\s?\/?\s?N\b|\d{1,6})/i, 15);
    const numeroImovel = numeroImovelBruto && /^S\s?\/?\s?N$/i.test(numeroImovelBruto) ? 'SN' : numeroImovelBruto;
    const complementoImovel = buscarAposRotulo(blocoImovel, 'Complemento\\s*:?', /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9,.º° ]{1,60})/);
    const matchMunicipioUFImovel = blocoImovel.match(/Munic[íi]pio\s*-\s*UF\s*:?\s*([A-ZÀ-Ü][A-ZÀ-Ü ]*?)\s*-\s*([A-Z]{2})\b/i);
    const cepImovel = buscarAposRotulo(blocoImovel, 'CEP\\s*:?', /(\d{2}\.?\d{3}-?\d{3})/, 30);
    const cepImovelFormatado = cepImovel ? cepImovel.replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') : null;

    const logradouroCompletoImovel = [tipoLogradouroImovel, logradouroImovel].filter(Boolean).join(' ') || logradouroImovel;

    const linha1 = formatarLinha1EnderecoImovel({
      logradouro: logradouroCompletoImovel,
      numero: numeroImovel,
      complemento: complementoImovel,
      municipio: matchMunicipioUFImovel ? matchMunicipioUFImovel[1].trim() : null,
      uf: matchMunicipioUFImovel ? matchMunicipioUFImovel[2].trim().toUpperCase() : null,
      cep: cepImovelFormatado,
    });
    if (linha1) encontrados.editableDiv = linha1; // vai no <div class="editableDiv"> do documento

    if (matchMunicipioUFImovel) {
      encontrados.text_logradouro2 = matchMunicipioUFImovel[1].trim();
      encontrados.text_uf2 = matchMunicipioUFImovel[2].trim().toUpperCase();
    }
  }

  // Item 1 - UNIÃO ESTÁVEL (independe do estado civil selecionado)
  if (/N[ãa]o\s+mantenho\s+uni[ãa]o\s+est[áa]vel/i.test(texto)) {
    encontrados.chkuniaoestavel2 = true;
  } else {
    const uniaoEstavelDesde = buscarAposRotulo(texto, 'Uni[ãa]o\\s+Est[áa]vel[^\\n]*?desde\\s*', /(\d{2}\/\d{2}\/\d{4})/);
    if (uniaoEstavelDesde) {
      encontrados.chkuniaoestavel1 = true;
      encontrados.text_data3 = uniaoEstavelDesde;
    } else if (/mantenho\s+uni[ãa]o\s+est[áa]vel/i.test(texto)) {
      encontrados.chkuniaoestavel1 = true;
    }
  }

  // Item 6 - USUFRUTO
  if (/N[ãa]o\s+sou\s+usufrutu[áa]rio/i.test(texto)) encontrados.chkusufruto1 = true;
  else if (/Renunciei\s+[àa]\s+condi[çc][ãa]o\s+de\s+usufrutu[áa]rio/i.test(texto)) {
    encontrados.chkusufruto2 = true;
    const indiceRI = texto.search(/Renunciei[\s\S]{0,150}?\bRI\b/i);
    if (indiceRI !== -1) {
      // janela SEM flag "i": só considera trechos realmente em MAIÚSCULAS (evita capturar
      // palavras minúsculas de ligação como "no municipío")
      const janelaRI = texto.slice(indiceRI, indiceRI + 190);
      const partesUsufruto = janelaRI.match(/([A-ZÀ-Ü]{2,}(?:\s[A-ZÀ-Ü]{2,})*)\s*\/\s*([A-Z]{2})\b/);
      if (partesUsufruto) {
        encontrados.mun_usufruto = partesUsufruto[1].trim();
        encontrados.uf_usufruto = partesUsufruto[2].trim().toUpperCase();
      }
    }
  }

  // Item 7 - MODALIDADE (Ex: "Aquisição Imóvel Concluído - Venda e Compra: R$ 240.000,00")
  const MODALIDADES = [
    { chk: 'chkmodalidade1', valor: 'text_enquad1', regex: 'Aquisi[çc][ãa]o\\s+Im[óo]vel\\s+Conclu[íi]do' },
    { chk: 'chkmodalidade2', valor: 'text_enquad2', regex: 'Aquisi[çc][ãa]o\\s+Im[óo]vel\\s+em\\s+Constru[çc][ãa]o' },
    { chk: 'chkmodalidade3', valor: 'text_enquad3', regex: 'Aquisi[çc][ãa]o\\s+Terreno\\s+e\\s+Constru[çc][ãa]o' },
    { chk: 'chkmodalidade4', valor: 'text_enquad4', regex: 'Constru[çc][ãa]o\\s+em\\s+Terreno\\s+Pr[óo]prio' },
    { chk: 'chkmodalidade5', valor: 'text_enquad5', regex: 'Reforma\\s+e/ou\\s+Amplia[çc][ãa]o' },
    { chk: 'chkmodalidade6', valor: 'text_enquad6', regex: 'CCFGTS\\s*[-–]\\s*Conclus[ãa]o' },
    { chk: 'chkmodalidade7', valor: 'text_enquad7', regex: 'Aquisi[çc][ãa]o\\s+de\\s+Material\\s+de\\s+Constru[çc][ãa]o' },
  ];
  MODALIDADES.forEach(({ chk, valor, regex }) => {
    if (!new RegExp(regex, 'i').test(texto)) return;
    encontrados[chk] = true;
    const valorEncontrado = buscarAposRotulo(texto, regex, /R?\$?\s*([\d.]{1,15},\d{2})/, 100);
    if (valorEncontrado) encontrados[valor] = valorEncontrado.replace(/^R\$?\s*/, '');
  });

  // Item 8 - ENQUADRAMENTO DO PROGRAMA
  const ENQUADRAMENTOS = [
    { chk: 'chkenquadramento1', regex: 'CCFGTS\\s*/?\\s*PMCMV|CARTA\\s+DE\\s+CR[ÉE]DITO\\s+FGTS' },
    { chk: 'chkenquadramento2', regex: 'PR[ÓO][-\\s]?COTISTA' },
    { chk: 'chkenquadramento3', regex: 'AQUISI[ÇC][ÃA]O\\s+DE\\s+MATERIAL\\s+DE\\s+CONSTRU[ÇC][ÃA]O\\s*[-–]\\s*AMC|\\bAMC\\b' },
    { chk: 'chkenquadramento4', regex: '[ÀA]\\s+VISTA,?\\s+SEM\\s+FINANCIAMENTO' },
    { chk: 'chkenquadramento5', regex: 'CARTA\\s+DE\\s+CR[ÉE]DITO\\s+SBPE\\s*\\(com' },
    { chk: 'chkenquadramento6', regex: 'CARTA\\s+DE\\s+CR[ÉE]DITO\\s+SBPE\\s*\\(no\\s+caso' },
  ];
  const enquadramentoEncontrado = ENQUADRAMENTOS.find(({ regex }) => new RegExp(regex, 'i').test(texto));
  if (enquadramentoEncontrado) encontrados[enquadramentoEncontrado.chk] = true;

  // 36 meses de trabalho sob regime do FGTS
  const trintaESeisMeses = buscarSimNao(texto, '36\\s*meses[^\\n]{0,40}?FGTS\\s*:?', 60);
  if (trintaESeisMeses === 'sim') encontrados.sn_1 = true;
  else if (trintaESeisMeses === 'nao') encontrados.sn_2 = true;

  // Já beneficiado com desconto/subsídio concedido pelo FGTS
  const jaBeneficiado = buscarSimNao(texto, 'beneficiad[oa]\\s+com\\s+desconto[^\\n]{0,60}?FGTS[^\\n]{0,20}?:?', 60);
  if (jaBeneficiado === 'sim') encontrados.sn_3 = true;
  else if (jaBeneficiado === 'nao') encontrados.sn_4 = true;

  // Operação com cessão de direitos creditórios do FGTS Futuro
  const fgtsFuturo = buscarSimNao(texto, 'FGTS\\s+Futuro\\s*\\??\\s*:?', 60);
  if (fgtsFuturo === 'sim') encontrados.sn_9 = true;
  else if (fgtsFuturo === 'nao') encontrados.sn_10 = true;

  // Operação com utilização de Conta(s) Vinculada(s) do FGTS
  const contaVinculada = buscarSimNao(texto, 'Conta\\(?s?\\)?\\s+Vinculada\\(?s?\\)?\\s+do\\s+FGTS\\s*\\??\\s*:?', 60);
  if (contaVinculada === 'sim') encontrados.sn_11 = true;
  else if (contaVinculada === 'nao') encontrados.sn_12 = true;

  // Item 4 - DECLARAÇÃO DE IMPOSTO DE RENDA: se algum comprovante de renda anexado for a
  // própria Declaração de IR, marca "cópia entregue"; senão marca "isento", sempre com ano
  // base/exercício vigentes.
  const documentosComprovanteRenda = buscarTodosAposRotulo(
    texto,
    'Documento\\s+do\\s+Comprovante\\s+de\\s+Renda\\s*:?',
    /([A-ZÀ-Ü\/ ]{5,60})/,
    80,
  );
  const comprovanteEhDeclaracaoIR = documentosComprovanteRenda.some((valor) => /IMPOSTO\s+DE\s+RENDA/i.test(valor));

  if (comprovanteEhDeclaracaoIR) {
    encontrados.chkir2 = true;
    encontrados.text_irano2 = IR_ANO_BASE_PADRAO;
    encontrados.text_irexerc2 = IR_ANO_EXERCICIO_PADRAO;
  } else {
    encontrados.chkir1 = true;
    encontrados.text_irano1 = IR_ANO_BASE_PADRAO;
    encontrados.text_irexerc1 = IR_ANO_EXERCICIO_PADRAO;
  }

  // Local da assinatura: município da agência de relacionamento do cadastro anexado
  const indiceAgencia = texto.search(/AG[ÊE]NCIA\s+DE\s+RELACIONAMENTO/i);
  if (indiceAgencia !== -1) {
    const municipioAgencia = buscarAposRotulo(texto.slice(indiceAgencia), 'Munic[íi]pio\\s*:?', /([A-ZÀ-Ü][A-ZÀ-Ü ]{1,40})/);
    if (municipioAgencia) encontrados.local_assin = municipioAgencia;
  }

  const hoje = new Date();
  encontrados.dia_assin = String(hoje.getDate()).padStart(2, '0');
  encontrados.ano_assin = String(hoje.getFullYear());
  const MESES_BR = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
  encontrados.mes_assin = MESES_BR[hoje.getMonth()];

  const secoesRendaEAgenciaEncontradas = documentosComprovanteRenda.length > 0 && indiceAgencia !== -1;

  return { encontrados, secoesRendaEAgenciaEncontradas };
}

const CAMPOS_PARADA_ANTECIPADA = ['text_nome', 'text_data1', 'text_cpf', 'text_pis', 'text_logradouro', 'text_uf1'];

// Roda o OCR completo em UM arquivo (PDF ou imagem) e devolve os campos identificados.
async function analisarArquivo(arquivo, aoProgredir, participante = 'principal') {
  const relatarProgresso = (mensagem) => { if (aoProgredir) aoProgredir(mensagem); };

  relatarProgresso('Carregando OCR... (1ª vez pode demorar)');
  await carregarBibliotecasOCR();

  let imagens;
  if (arquivo.type === 'application/pdf' || arquivo.name.toLowerCase().endsWith('.pdf')) {
    relatarProgresso('Convertendo PDF...');
    imagens = await pdfParaImagens(arquivo);
  } else {
    imagens = [arquivo];
  }

  const worker = await window.Tesseract.createWorker('por', 1, {
    langPath: TESSERACT_LANG_PATH,
    gzip: true,
  });

  let textoAcumulado = '';
  let encontrados = {};

  try {
    for (let indice = 0; indice < imagens.length; indice++) {
      relatarProgresso(`Lendo documento (OCR)... página ${indice + 1}/${imagens.length}`);

      const { data } = await worker.recognize(imagens[indice]);
      textoAcumulado += `\n${data?.text || ''}`;

      // O Espelho da Proposta (SIOPI) tem layout de tabela rótulo/valor e rótulos repetidos por
      // participante — usa extrator dedicado em vez do genérico (texto corrido de RG/CTPS/cadastro).
      const resultadoParcial = textoEhEspelhoDaProposta(textoAcumulado)
        ? extrairCamposDoEspelho(textoAcumulado, participante)
        : extrairCamposDoTexto(textoAcumulado);
      encontrados = resultadoParcial.encontrados;

      const podeParar = CAMPOS_PARADA_ANTECIPADA.every((campo) => encontrados[campo])
        && resultadoParcial.secoesRendaEAgenciaEncontradas;
      if (podeParar) break;
    }
  } finally {
    await worker.terminate();
    // Log de depuração: mostra no console (F12) o texto exatamente como o OCR reconheceu e o que
    // foi extraído dele. Ajuda a diagnosticar por que um campo saiu errado ou em branco — o rótulo
    // pode ter sido lido de um jeito diferente do esperado.
    console.log(`[OCR] Texto reconhecido de "${arquivo.name}":\n${textoAcumulado}`);
    console.log(`[OCR] Campos extraídos de "${arquivo.name}":`, encontrados);
  }

  return encontrados;
}

// Processa a FILA inteira de arquivos, um a um (o worker do Tesseract não é seguro para rodar em
// paralelo). Os campos identificados em cada arquivo são agregados aos anteriores SEM sobrescrever
// o que um arquivo anterior da fila já tiver identificado — exceto os campos de regra fixa
// (IR ano base/exercício), recalculados a cada arquivo mas sempre com o mesmo valor final.
// Grupos onde só UMA opção pode ficar marcada (checkboxes mutuamente exclusivos do documento
// oficial). Quando um arquivo da fila encontra uma opção de um desses grupos, qualquer opção de
// outro arquivo anterior da fila do MESMO grupo é descartada — senão duas chaves diferentes (ex.:
// chkmodalidade1 de um arquivo e chkmodalidade2 de outro) ficariam as duas marcadas ao mesmo tempo.
const GRUPOS_EXCLUSIVOS = [
  ['chkmodalidade1', 'text_enquad1', 'chkmodalidade2', 'text_enquad2', 'chkmodalidade3', 'text_enquad3',
    'chkmodalidade4', 'text_enquad4', 'chkmodalidade5', 'text_enquad5', 'chkmodalidade6', 'text_enquad6',
    'chkmodalidade7', 'text_enquad7'],
  ['chkenquadramento1', 'chkenquadramento2', 'chkenquadramento3', 'chkenquadramento4', 'chkenquadramento5', 'chkenquadramento6'],
];

async function analisarFilaDeArquivos(arquivos, aoProgredir, opcoes = {}) {
  const { participante = 'principal' } = opcoes;
  const encontradosAcumulados = {};

  for (let indice = 0; indice < arquivos.length; indice++) {
    const arquivo = arquivos[indice];
    const relatarProgressoArquivo = (mensagem) => {
      if (aoProgredir) aoProgredir(`Arquivo ${indice + 1}/${arquivos.length} (${arquivo.name}): ${mensagem}`);
    };

    // eslint-disable-next-line no-await-in-loop -- processamento sequencial é proposital
    const encontrados = await analisarArquivo(arquivo, relatarProgressoArquivo, participante);

    // Se este arquivo encontrou uma opção "chkX" de um grupo exclusivo, remove qualquer opção do
    // MESMO grupo que um arquivo anterior da fila já tenha colocado em encontradosAcumulados —
    // a última opção encontrada (que também é sempre reavaliada, ver CAMPOS_REGRA_FIXA) é quem vale.
    GRUPOS_EXCLUSIVOS.forEach((grupo) => {
      const opçãoEncontradaNesteArquivo = grupo.some((chave) => encontrados[chave]);
      if (!opçãoEncontradaNesteArquivo) return;
      grupo.forEach((chave) => {
        if (!encontrados[chave]) delete encontradosAcumulados[chave];
      });
    });

    Object.entries(encontrados).forEach(([chave, valor]) => {
      if (valor === undefined || valor === null || valor === '') return; // nunca sobrescreve com vazio
      const jaPreenchido = Object.prototype.hasOwnProperty.call(encontradosAcumulados, chave)
        && !CAMPOS_REGRA_FIXA.includes(chave);
      if (jaPreenchido) return; // mantém o valor já encontrado num arquivo anterior da fila
      encontradosAcumulados[chave] = valor;
    });
  }

  return encontradosAcumulados;
}

export { analisarFilaDeArquivos, CAMPOS_REGRA_FIXA, textoEhEspelhoDaProposta, extrairCamposDoEspelho, GRUPOS_EXCLUSIVOS };
