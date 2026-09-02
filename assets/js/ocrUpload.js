"use strict";

// =================================================================================================
// OCRUPLOAD.JS — Painel de anexo de documentos (RG, CPF, carteira de trabalho, cadastro CAIXA,
// Espelho da Proposta SIOPI) com extração automática via OCR (parser.js) e preenchimento dos
// campos da DAMP. Não toca na estrutura do documento oficial (form#damp_form / #print_area):
// só lê/escreve pelos ids e classes que já existem nele. Não duplica nada que o projeto já tem
// pronto (registros salvos, autocompletar, escala de impressão, anos de IRPF — tudo isso continua
// em scripts.js/dataBaseFunctions.js/publicFunctions.js, sem mudanças).
// =================================================================================================

// O "?v=" abaixo é um carimbo de versão: sempre que parser.js é atualizado, o número muda
// propositalmente pra forçar o navegador (e o cache do GitHub Pages/CDN) a buscar o arquivo novo
// em vez de servir uma cópia antiga em cache.
import { analisarFilaDeArquivos, CAMPOS_REGRA_FIXA, GRUPOS_EXCLUSIVOS } from './parser.js?v=20260901-3';

// -------------------------------------------------------------------------------------------
// FILA DE DOCUMENTOS: acumula arquivos anexados em momentos diferentes (nunca substitui a
// seleção anterior) e desenha a lista visual com botão de remover por arquivo.
// -------------------------------------------------------------------------------------------
function criarFilaDeArquivos({ elementoLista, textoVazio }) {
  let arquivos = [];

  function renderizar() {
    elementoLista.innerHTML = '';

    if (arquivos.length === 0) {
      const item = document.createElement('li');
      item.className = 'list-group-item text-muted';
      item.textContent = textoVazio;
      elementoLista.appendChild(item);
      return;
    }

    arquivos.forEach((arquivo, indice) => {
      const item = document.createElement('li');
      item.className = 'list-group-item d-flex justify-content-between align-items-center';

      const nome = document.createElement('span');
      nome.textContent = arquivo.name;
      item.appendChild(nome);

      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'btn btn-sm btn-outline-danger';
      remover.setAttribute('aria-label', `Remover ${arquivo.name} da fila`);
      remover.textContent = '×';
      remover.addEventListener('click', () => {
        arquivos.splice(indice, 1);
        renderizar();
      });
      item.appendChild(remover);

      elementoLista.appendChild(item);
    });
  }

  function adicionar(novosArquivos) {
    const listaNovos = Array.from(novosArquivos || []);
    if (listaNovos.length === 0) return;
    arquivos = arquivos.concat(listaNovos); // acumula, nunca sobrescreve
    renderizar();
  }

  function obterArquivos() {
    return arquivos.slice();
  }

  renderizar();
  return { adicionar, obterArquivos };
}

// -------------------------------------------------------------------------------------------
// PREENCHIMENTO DO DOCUMENTO
// -------------------------------------------------------------------------------------------
// Campos sem id próprio de elemento de formulário (tratados à parte, ver preencherDocumento):
// - "editableDiv"  -> a <div class="editableDiv"> (contenteditable) dentro de #print_area
// - "dia_assin"    -> o campo do dia da assinatura tem id="end_camp" (não "dia_assin")
// - "mes_assin"/"ano_assin" já batem 1:1 com o id do elemento, não precisam de caso especial
const IDS_ESPECIAIS = { dia_assin: 'end_camp' };

// Os checkboxes de grupo (modalidade, enquadramento, residência, usufruto, união estável, IR e os
// pares SIM/NÃO "sn_N") são geridos por um handler de CLIQUE já existente em scripts.js (não um
// handler de "change"), que cuida de exclusividade e mostrar/ocultar os blocos relacionados.
// Setar ".checked = true" direto NÃO dispara esse handler — por isso, para esses ids, simulamos um
// clique real (uma única vez, só se ainda não estiver marcado) em vez de só atribuir o valor.
function marcarCheckboxComoOMouse(elemento) {
  if (elemento.checked) return; // já marcado (ou marcado por um documento anterior da fila) — não mexe
  elemento.click();
}

function desmarcarCheckboxComoOMouse(elemento) {
  if (!elemento.checked) return; // já desmarcado — não mexe
  elemento.click(); // clicar num checkbox JÁ marcado desmarca ele (e dispara o handler de scripts.js)
}

// Antes de aplicar um grupo mutuamente exclusivo (modalidade, enquadramento), desmarca qualquer
// opção do MESMO grupo que já esteja marcada na tela mas não seja a que foi encontrada agora — sem
// isso, uma marcação deixada de um teste/extração anterior na mesma página (ex.: "empreendimento"
// marcado de antes) pode continuar visível mesmo depois de uma nova extração corrigir o campo.
function limparGruposExclusivosAntesDePreencher(encontrados) {
  GRUPOS_EXCLUSIVOS.forEach((grupo) => {
    const algumaOpçãoEncontrada = grupo.some((chave) => encontrados[chave]);
    if (!algumaOpçãoEncontrada) return;
    grupo.forEach((chave) => {
      if (encontrados[chave]) return; // essa é a opção que vamos marcar agora, não mexe nela aqui
      const elemento = document.getElementById(chave);
      if (elemento && elemento.type === 'checkbox') desmarcarCheckboxComoOMouse(elemento);
    });
  });
}

function preencherDocumento(encontrados) {
  const chkYears = document.getElementById('chk_years');

  limparGruposExclusivosAntesDePreencher(encontrados);

  Object.entries(encontrados).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;

    // "Preencher ano base e referência de IRPF" desligado = não mexe nesses 4 campos
    if (chkYears && !chkYears.checked && ['text_irano1', 'text_irexerc1', 'text_irano2', 'text_irexerc2'].includes(chave)) {
      return;
    }

    if (chave === 'editableDiv') {
      const el = document.querySelector('#print_area .editableDiv');
      if (el) {
        el.textContent = valor;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    const idReal = IDS_ESPECIAIS[chave] || chave;
    const elemento = document.getElementById(idReal);
    if (!elemento) return;

    if (elemento.type === 'checkbox') {
      if (valor) marcarCheckboxComoOMouse(elemento);
    } else {
      elemento.value = valor;
      elemento.dispatchEvent(new Event('input', { bubbles: true }));
      elemento.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function montarResumo(encontrados) {
  const total = Object.keys(encontrados).length;
  return `✔ Extração concluída: ${total} campo(s) identificado(s) e preenchido(s). Confira os dados na tela antes de imprimir — o que não foi encontrado ficou em branco para preenchimento manual.`;
}

// -------------------------------------------------------------------------------------------
// Inicialização
// -------------------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const filaDocumentos = criarFilaDeArquivos({
    elementoLista: document.getElementById('lista-arquivos'),
    textoVazio: 'Nenhum documento anexado ainda.',
  });

  const inputArquivos = document.getElementById('input-arquivos');
  const botaoAnexar = document.getElementById('botao-anexar');
  const botaoExtrair = document.getElementById('botao-extrair');
  const statusExtracao = document.getElementById('status-extracao');
  const selectParticipante = document.getElementById('select-participante');
  const areaArrastarSoltar = document.getElementById('area-arrastar-soltar');

  if (!inputArquivos || !botaoAnexar || !botaoExtrair || !statusExtracao) return;

  botaoAnexar.addEventListener('click', () => inputArquivos.click());

  inputArquivos.addEventListener('change', (evento) => {
    filaDocumentos.adicionar(evento.target.files);
    evento.target.value = '';
  });

  // -----------------------------------------------------------------------------------------
  // ARRASTAR E SOLTAR (drag-and-drop): clicar na área abre o mesmo seletor de arquivos do botão
  // "Anexar documentos"; soltar um ou mais arquivos arrastados do sistema operacional (ou de outra
  // aba/janela) adiciona eles direto na fila, sem precisar do seletor.
  // -----------------------------------------------------------------------------------------
  if (areaArrastarSoltar) {
    const CLASSE_ARRASTANDO_POR_CIMA = 'area-arrastar-soltar--ativa';

    areaArrastarSoltar.addEventListener('click', () => inputArquivos.click());

    // preventDefault em dragover é obrigatório pro navegador aceitar o "drop" — sem isso, ele
    // interpreta como "abrir o arquivo" (navegando pra fora da página) em vez de disparar 'drop'.
    areaArrastarSoltar.addEventListener('dragover', (evento) => {
      evento.preventDefault();
      areaArrastarSoltar.classList.add(CLASSE_ARRASTANDO_POR_CIMA);
      areaArrastarSoltar.style.backgroundColor = '#eef6ff';
      areaArrastarSoltar.style.borderColor = '#0d6efd';
    });

    areaArrastarSoltar.addEventListener('dragleave', () => {
      areaArrastarSoltar.classList.remove(CLASSE_ARRASTANDO_POR_CIMA);
      areaArrastarSoltar.style.backgroundColor = '';
      areaArrastarSoltar.style.borderColor = '#adb5bd';
    });

    areaArrastarSoltar.addEventListener('drop', (evento) => {
      evento.preventDefault(); // essencial: sem isso o navegador navega/abre o arquivo solto
      areaArrastarSoltar.classList.remove(CLASSE_ARRASTANDO_POR_CIMA);
      areaArrastarSoltar.style.backgroundColor = '';
      areaArrastarSoltar.style.borderColor = '#adb5bd';
      filaDocumentos.adicionar(evento.dataTransfer.files);
    });

    // Impede que soltar um arquivo FORA da área (no resto da página) faça o navegador abrir/navegar
    // pra ele — comportamento padrão do Chrome/Firefox quando não há um handler de 'drop' cancelando.
    ['dragover', 'drop'].forEach((tipoEvento) => {
      window.addEventListener(tipoEvento, (evento) => {
        if (evento.target === areaArrastarSoltar || areaArrastarSoltar.contains(evento.target)) return;
        evento.preventDefault();
      });
    });
  }

  botaoExtrair.addEventListener('click', async () => {
    const arquivos = filaDocumentos.obterArquivos();
    if (arquivos.length === 0) {
      alert('Anexe ao menos um documento (PDF ou foto — RG, CPF, carteira de trabalho, cadastro ou Espelho da Proposta) antes de clicar em "Extrair e Preencher".');
      return;
    }

    botaoExtrair.disabled = true;
    botaoAnexar.disabled = true;

    // Qual participante ler do Espelho: "principal" = 1º Proponente/Comprador (seção "Dados do
    // Participante - Proponente/Comprador"), "coobrigado" = 2º Proponente (seção "Dados do
    // Participante - Coobrigado/Proponente"). Sem o seletor no HTML, cai sempre no 1º Proponente.
    const participanteSelecionado = selectParticipante ? selectParticipante.value : 'principal';

    try {
      const encontrados = await analisarFilaDeArquivos(
        arquivos,
        (mensagem) => { statusExtracao.textContent = mensagem; },
        { participante: participanteSelecionado },
      );

      const encontrouAlgo = Object.keys(encontrados).some((chave) => !CAMPOS_REGRA_FIXA.includes(chave));
      if (!encontrouAlgo) {
        statusExtracao.textContent = '⚠ Não foi possível identificar automaticamente nenhum dado nos documentos anexados. Tente fotos/PDFs mais nítidos, bem enquadrados e com boa iluminação.';
        return;
      }

      // Fica parado na tela mostrando o resumo (sem alert() bloqueando) — assim dá pra conferir os
      // campos preenchidos no próprio documento antes de fazer qualquer outra coisa na página.
      preencherDocumento(encontrados);
      statusExtracao.textContent = montarResumo(encontrados);
    } catch (erro) {
      console.log('Erro ao processar OCR dos documentos: %s', erro);
      statusExtracao.textContent = '⚠ Não foi possível ler os documentos automaticamente. Verifique sua conexão (necessária só na 1ª vez, para baixar a biblioteca de OCR) e tente novamente.';
    } finally {
      botaoExtrair.disabled = false;
      botaoAnexar.disabled = false;
    }
  });
});
