/* =========================================================================
   Conta Blocos — ETAPA 2: lógica do jogo (port do main.py)
   - time.sleep vira await; o loop principal é uma máquina de estados igual
     à do ESP32.
   - Onde o main.py lia o mini ábaco (num_display), aqui se lê o valor dos
     blocos nos leitores: dezena (esquerda) * 10 + unidade (direita).
   ========================================================================= */
(() => {
  "use strict";

  const CB = window.CB;
  const lcd = CB.lcd;
  const dicaEl = document.getElementById("dica-jogo");

  /* ------------------------------------------------------------------
     Infra: cancelamento ao desligar, cliques e esperas
     ------------------------------------------------------------------ */
  class Cancelado extends Error {}
  let sessao = {};                                   // muda a cada liga/desliga
  const verificar = (s) => { if (s !== sessao || !CB.ligado()) throw new Cancelado(); };

  const pend = { voltar: false, rolar: false, confirmar: false };
  window.addEventListener("cb:botao", (e) => {
    if (e.detail.estado === "down" && CB.ligado()) pend[e.detail.nome] = true;
  });
  function limparPend() { pend.voltar = pend.rolar = pend.confirmar = false; }
  function lerPend() { const c = { ...pend }; limparPend(); return c; }

  // time.sleep(): como no ESP32, cliques durante a espera são descartados
  async function dormir(ms) {
    const s = sessao;
    await new Promise((r) => setTimeout(r, ms));
    verificar(s);
    limparPend();
  }
  // intervalo de leitura dos botões (os cliques ficam guardados)
  async function esperar(ms) {
    const s = sessao;
    await new Promise((r) => setTimeout(r, ms));
    verificar(s);
  }
  async function tocarTom(freq, ms) {
    const s = sessao;
    await CB.tom(freq, ms);
    verificar(s);
    limparPend();
  }

  // time.ticks_us(): os navegadores arredondam o relógio, então somamos um
  // pequeno ruído para os últimos dígitos não ficarem sempre iguais.
  const ticksUs = () => Math.floor(performance.now() * 1000) + Math.floor(Math.random() * 100);

  const valorLeitor = () => CB.leitor.valor();
  const numDisplay = () => { const v = valorLeitor(); return v === null ? 0 : v; };
  const limparLeitores = () => CB.leitor.limpar();

  /* ------------------------------------------------------------------
     Sons
     ------------------------------------------------------------------ */
  const tocarClick = () => tocarTom(300, 15);
  const somLigar = () => tocarTom(1000, 200);
  const somConfirmar = () => tocarTom(800, 100);
  const somErro = () => tocarTom(250, 500);
  async function somAcerto() {
    await tocarTom(1200, 150);
    await dormir(50);
    await tocarTom(1500, 200);
  }
  async function somVitoria() {
    for (const [f, d] of [[523, 120], [659, 120], [784, 120], [1047, 350]]) {
      await tocarTom(f, d);
      await dormir(30);
    }
  }

  /* ------------------------------------------------------------------
     Estado do jogo
     ------------------------------------------------------------------ */
  let estado, estadoSalvo, ultimoNum;
  let nivel, modo, operacao;
  let dadoMin, dadoMax, dado2Min, dado2Max;
  let dado1, dado2, dezenaBase, divBase, valInicial, valSecundaria, respostaCerta;
  let questao, acertos, erros, caixaDisp;
  let previewAtivo = false;

  function resetarEstado() {
    estado = "INICIO"; estadoSalvo = ""; ultimoNum = -1;
    nivel = ""; modo = ""; operacao = "";
    dadoMin = 0; dadoMax = 5; dado2Min = null; dado2Max = null;
    dado1 = 0; dado2 = 0; dezenaBase = 10; divBase = 1;
    valInicial = 0; valSecundaria = 0; respostaCerta = 0;
    questao = 0; acertos = 0; erros = 0; caixaDisp = [];
    previewAtivo = false;
  }
  resetarEstado();

  /* ------------------------------------------------------------------
     Saída: LCD
     ------------------------------------------------------------------ */
  const printLcd = (l1, l2 = "") => lcd.print(l1, l2);
  const atualizarLinha1 = (t) => lcd.linha1(t);
  const dica = (t) => { dicaEl.textContent = t; };

  function formatarLinhaRole() {
    if (nivel === "1") return `  ${operacao}   = `;
    if (nivel === "2") return `${valInicial} ${operacao}   = `;
    if (nivel === "3") {
      if (modo === "CAIXA") return "  +   = ";
      if (modo === "DEZENA") return `   +   = ${valSecundaria}`;
    }
    if (nivel === "4") {
      if (operacao === "*") return "  *   = ";
      if (operacao === "/") return `${valInicial} /   = `;
    }
    return "";
  }

  function formatarLinhaRolando(d1, d2) {
    if (nivel === "1") return `${d1} ${operacao} ${d2} = `;
    if (nivel === "2") return `${valInicial} ${operacao} ${d1 + d2} = `;
    if (nivel === "3") {
      if (modo === "CAIXA") return `${d1} + ${d2} = `;
      if (modo === "DEZENA") return `${dezenaBase + d1 + d2} +   = ${valSecundaria}`;
    }
    if (nivel === "4") {
      if (operacao === "*") return `${d1} * ${d2} = `;
      if (operacao === "/") return `${valInicial} / ${d1 + d2} = `;
    }
    return "";
  }

  function formatarCaixa(disponiveis) {
    let s = "Use: ";
    for (let n = 1; n <= 9; n++) s += disponiveis.includes(n) ? String(n) : " ";
    return s;
  }

  function mostrarTelaRole() {
    previewAtivo = false;
    dica("Segure Rolar para girar os dados e solte para parar.");
    if (nivel === "3" && modo === "CAIXA") printLcd("Role os dados!", formatarCaixa(caixaDisp));
    else printLcd(formatarLinhaRole(), "Role os dados!");
  }

  // Linha de cima da pergunta; v = valor dos blocos (ou null se vazio)
  function linhaPergunta(v) {
    if (nivel === "3" && modo === "CAIXA") {
      const esc = v === null ? [] : interpretarEntradaCaixa(v);
      return `${dado1} + ${dado2} = ${esc.join(" + ")}`;
    }
    if (nivel === "3" && modo === "DEZENA") {
      return v === null ? `${valInicial} +   = ${valSecundaria}` : `${valInicial} + ${v} = ${valSecundaria}`;
    }
    return `${valInicial} ${operacao} ${valSecundaria} = ${v === null ? "" : v}`;
  }

  // Feche a Caixa: mostra o "+" entre os leitores e soma os blocos na leitura
  function atualizarVisualCaixa() {
    const on = nivel === "3" && modo === "CAIXA" &&
      (estado === "ROLE" || estado === "RESPONDA" || estado === "CONFIRMAR_SAIDA");
    document.body.classList.toggle("modo-caixa", on);
    CB.leitor.modoSoma(on);
  }

  function mostrarTelaQuestao() {
    if (nivel === "3" && modo === "CAIXA") dica("Coloque 1 ou 2 blocos nos leitores (eles são somados) e clique em Confirmar.");
    else dica("Arraste os blocos para os leitores e clique em Confirmar.");
    if (nivel === "3" && modo === "CAIXA") printLcd(`${dado1} + ${dado2} = `, formatarCaixa(caixaDisp));
    else printLcd(linhaPergunta(null));
    previewAtivo = true;
    atualizarPreview();
  }

  // Mostra no LCD, ao vivo, o que está sobre os leitores (como no PDF)
  function atualizarPreview() {
    if (!previewAtivo || estado !== "RESPONDA") return;
    atualizarLinha1(linhaPergunta(valorLeitor()));
  }
  window.addEventListener("cb:leitura", atualizarPreview);

  /* ------------------------------------------------------------------
     Regras auxiliares
     ------------------------------------------------------------------ */
  function rolarOperacao() {
    const opcoes = nivel === "4" ? ["*", "/"] : ["+", "-"];
    return opcoes[ticksUs() % 2];
  }

  function prepararNovaRodada() {
    if (modo === "MISTO") {
      if (nivel === "4") {
        operacao = rolarOperacao();
        if (operacao === "*") { dadoMin = 0; dadoMax = 7; dado2Min = null; dado2Max = null; }
        else { dadoMin = 0; dadoMax = 5; dado2Min = 1; dado2Max = 5; }
      } else {
        operacao = "?";
      }
    }

    if (nivel === "3" && modo === "DEZENA") {
      dezenaBase = ((ticksUs() % 8) + 1) * 10;
      valSecundaria = dezenaBase + 10;
    } else if (nivel === "4" && operacao === "/") {
      divBase = (ticksUs() % 10) + 1;
      const quociente = (Math.floor(ticksUs() / 7) % 9) + 1;
      valInicial = divBase * quociente;
    }

    mostrarTelaRole();
  }

  function ajustarDivisorExato(d1, d2) {
    const soma = d1 + d2;
    if (soma > 0 && valInicial % soma === 0 && Math.floor(valInicial / soma) <= 99) return [d1, d2];

    const validos = [];
    for (let d = 1; d <= 10; d++) {
      if (valInicial % d === 0 && Math.floor(valInicial / d) <= 99) validos.push(d);
    }
    let melhor = divBase;
    if (validos.length) {
      melhor = validos[0];
      for (const d of validos) if (Math.abs(d - soma) < Math.abs(melhor - soma)) melhor = d;
    }
    const novoD2 = Math.min(5, Math.max(1, melhor));
    const novoD1 = melhor - novoD2;
    CB.setDados(novoD1, novoD2);
    return [novoD1, novoD2];
  }

  async function rolarDados(x1, y1, x2, y2) {
    if (x2 === null || x2 === undefined) x2 = x1;
    if (y2 === null || y2 === undefined) y2 = y1;

    const momentoPress = ticksUs();
    let d1 = (momentoPress % (y1 - x1 + 1)) + x1;
    let d2 = (Math.floor(momentoPress / 100) % (y2 - x2 + 1)) + x2;

    if (nivel === "3" && modo === "CAIXA") printLcd(formatarLinhaRolando(d1, d2), formatarCaixa(caixaDisp));
    else printLcd(formatarLinhaRolando(d1, d2), "Rolando...");

    // Gira enquanto o jogador mantiver o botão pressionado
    while (CB.botoes.rolar) {
      d1 = d1 < y1 ? d1 + 1 : x1;
      d2 = d2 < y2 ? d2 + 1 : x2;
      CB.setDados(d1, d2);
      atualizarLinha1(formatarLinhaRolando(d1, d2));
      await tocarClick();
      await dormir(50);
    }

    // Desaceleração independente ao soltar
    const momentoSoltar = ticksUs();
    const giros1 = (momentoSoltar % 10) + 10;
    const giros2 = (Math.floor(momentoSoltar / 10) % 10) + 10;
    let atraso = 50;

    for (let passo = 0; passo < Math.max(giros1, giros2); passo++) {
      if (passo < giros1) d1 = d1 < y1 ? d1 + 1 : x1;
      if (passo < giros2) d2 = d2 < y2 ? d2 + 1 : x2;
      CB.setDados(d1, d2);
      atualizarLinha1(formatarLinhaRolando(d1, d2));
      await tocarClick();
      await dormir(atraso);
      atraso += 15;
    }
    return [d1, d2];
  }

  function temJogadaCaixa(alvo, disponiveis) {
    if (disponiveis.includes(alvo)) return true;
    for (const x of disponiveis) {
      const y = alvo - x;
      if (y !== x && disponiveis.includes(y)) return true;
    }
    return false;
  }

  function interpretarEntradaCaixa(valor) {
    const d1 = Math.floor(valor / 10);
    const d2 = valor % 10;
    if (d1 === 0 && d2 > 0) return [d2];
    if (d2 === 0 && d1 > 0) return [d1];
    if (d1 > 0 && d2 > 0 && d1 !== d2) return [d1, d2];
    return [];
  }

  /* ------------------------------------------------------------------
     Menus
     ------------------------------------------------------------------ */
  const TELAS_NIVEIS = {
    0: " 1   2    3   4 ",
    1: "[1]  2    3   4 ",
    2: " 1  [2]   3   4 ",
    3: " 1   2   [3]  4 ",
    4: " 1   2    3  [4]",
  };
  const TELAS_SOMA_SUBT = {
    1: ["    [1-Soma]    ", "2-Subt  3-Misto "],
    2: [" [2-Subtracao]  ", "1-Soma  3-Misto "],
    3: ["   [3-Misto]    ", "1-Soma  2-Subt  "],
  };
  const PADRAO_SOMA_SUBT = ["Modos:  1-Soma  ", "2-Subt  3-Misto "];
  const TELAS_NIVEL3 = {
    1: ["[Feche a Caixa ]", " 2-Prox. Dezena "],
    2: ["[Proxima dezena]", "1-Feche a Caixa "],
  };
  const PADRAO_NIVEL3 = ["Modos: 1-F.Caixa", " 2-Prox. Dezena "];
  const TELAS_NIVEL4 = {
    1: [" [1-Multiplic.] ", "2-Divs  3-Misto "],
    2: ["   [2-Divisao]  ", "1-Mult  3-Misto "],
    3: ["   [3-Misto]    ", "1-Mult  2-Divs  "],
  };
  const PADRAO_NIVEL4 = ["Modos:  1-Mult  ", "2-Divs  3-Misto "];

  // Redesenha o menu só quando o número lido mudou
  function desenharMenu(tabela, padrao) {
    const n = numDisplay();
    if (n !== ultimoNum) {
      const t = tabela[n] || padrao;
      printLcd(t[0], t[1]);
      ultimoNum = n;
    }
    return n;
  }
  const dicaMenu = () => dica("Coloque o bloco com o número da opção no leitor da unidade e clique em Confirmar.");

  async function iniciarModo(novoNivel, mensagem) {
    printLcd(mensagem, "Selecionado!");
    nivel = novoNivel;
    estado = "ROLE";
    atualizarVisualCaixa();
    await somConfirmar();
    await dormir(1000);
  }

  /* ------------------------------------------------------------------
     Um passo do loop principal (uma volta do while True do main.py)
     ------------------------------------------------------------------ */
  async function passo() {
    const c = lerPend();

    // --- Tratamento global do botão Voltar ---
    if (c.voltar) {
      if (estado === "ROLE" || estado === "RESPONDA") {
        estadoSalvo = estado;
        estado = "CONFIRMAR_SAIDA";
        previewAtivo = false;
        dica("Confirmar = sair do jogo. Rolar ou Voltar = continuar.");
        printLcd("Sair do jogo?");
        c.voltar = false;
        c.rolar = false;
      } else if (["1", "2", "3", "4"].includes(estado)) {
        limparLeitores();
        estado = "NIVEIS";
        ultimoNum = -1;
        c.voltar = false;
      } else if (estado === "NIVEIS" || estado === "FIM") {
        estado = "INICIO";
        c.voltar = false;
      }
    }

    // --- TELA INICIAL ---
    if (estado === "INICIO") {
      dica("");
      await somLigar();
      printLcd("     Conta", "     Blocos");
      await dormir(2000);
      estado = "NIVEIS";
      limparLeitores();
      ultimoNum = -1;
      CB.setDados(0, 0);
      questao = 0;
      acertos = 0;
      erros = 0;
    }

    // --- CONFIRMAÇÃO DE SAÍDA ---
    else if (estado === "CONFIRMAR_SAIDA") {
      if (c.confirmar) {
        CB.setDados(0, 0);
        limparLeitores();
        estado = "INICIO";
      } else if (c.rolar || c.voltar) {
        estado = estadoSalvo;
        if (estado === "ROLE") mostrarTelaRole();
        else if (estado === "RESPONDA") mostrarTelaQuestao();
      }
    }

    // --- SELEÇÃO DE NÍVEL ---
    else if (estado === "NIVEIS") {
      dicaMenu();
      const n = numDisplay();
      if (n !== ultimoNum) {
        printLcd("Niveis:", TELAS_NIVEIS[n] || TELAS_NIVEIS[0]);
        ultimoNum = n;
      }
      if (c.confirmar && n >= 1 && n <= 4) {
        estado = String(n);
        printLcd(`Nivel ${estado}`, "Selecionado!");
        await somConfirmar();
        await dormir(1000);
        limparLeitores();
        ultimoNum = -1;
      }
    }

    // --- NÍVEL 1 ---
    else if (estado === "1") {
      dicaMenu();
      const n = desenharMenu(TELAS_SOMA_SUBT, PADRAO_SOMA_SUBT);
      if (c.confirmar && n >= 1 && n <= 3) {
        dado2Min = null; dado2Max = null;
        let msg;
        if (n === 1) { modo = "SOMA"; operacao = "+"; dadoMin = 0; dadoMax = 5; msg = "Modo Soma"; }
        else if (n === 2) { modo = "SUBTRACAO"; operacao = "-"; dadoMin = 0; dadoMax = 7; msg = "Modo Subtracao"; }
        else { modo = "MISTO"; operacao = "?"; dadoMin = 0; dadoMax = 7; msg = "Modo Misto"; }
        await iniciarModo("1", msg);
        limparLeitores();
        prepararNovaRodada();
      }
    }

    // --- NÍVEL 2 ---
    else if (estado === "2") {
      dicaMenu();
      const n = desenharMenu(TELAS_SOMA_SUBT, PADRAO_SOMA_SUBT);
      if (c.confirmar && n >= 1 && n <= 3) {
        dadoMin = 1; dadoMax = 6;
        dado2Min = null; dado2Max = null;
        let msg;
        if (n === 1) { modo = "SOMA"; operacao = "+"; valInicial = 0; msg = "Modo Soma"; }
        else if (n === 2) { modo = "SUBTRACAO"; operacao = "-"; valInicial = 99; msg = "Modo Subtracao"; }
        else { modo = "MISTO"; operacao = "?"; valInicial = 49; msg = "Modo Misto"; }
        await iniciarModo("2", msg);
        limparLeitores();
        prepararNovaRodada();
      }
    }

    // --- NÍVEL 3 ---
    else if (estado === "3") {
      dicaMenu();
      const n = desenharMenu(TELAS_NIVEL3, PADRAO_NIVEL3);
      if (c.confirmar && n >= 1 && n <= 2) {
        let msg;
        if (n === 1) {
          modo = "CAIXA";
          dadoMin = 0; dadoMax = 6;
          dado2Min = null; dado2Max = null;
          caixaDisp = [1, 2, 3, 4, 5, 6, 7, 8, 9];
          msg = "Feche a Caixa";
        } else {
          modo = "DEZENA";
          dadoMin = 0; dadoMax = 5;
          dado2Min = 0; dado2Max = 4;
          msg = "Proxima Dezena";
        }
        await iniciarModo("3", msg);
        if (modo === "CAIXA") {
          printLcd("Some os blocos", "nos leitores");
          await dormir(3000);
        }
        limparLeitores();
        prepararNovaRodada();
      }
    }

    // --- NÍVEL 4 ---
    else if (estado === "4") {
      dicaMenu();
      const n = desenharMenu(TELAS_NIVEL4, PADRAO_NIVEL4);
      if (c.confirmar && n >= 1 && n <= 3) {
        let msg;
        if (n === 1) { modo = "MULT"; operacao = "*"; dadoMin = 0; dadoMax = 7; dado2Min = null; dado2Max = null; msg = "Modo Multiplic."; }
        else if (n === 2) { modo = "DIVS"; operacao = "/"; dadoMin = 0; dadoMax = 5; dado2Min = 1; dado2Max = 5; msg = "Modo Divisao"; }
        else { modo = "MISTO"; operacao = ""; dadoMin = 0; dadoMax = 7; dado2Min = null; dado2Max = null; msg = "Modo Misto"; }
        await iniciarModo("4", msg);
        limparLeitores();
        prepararNovaRodada();
      }
    }

    // --- ROLAR DADOS E MONTAR QUESTÃO ---
    else if (estado === "ROLE") {
      if (modo !== "CAIXA" && questao >= 5) {
        estado = "FIM";
        dica("Confirmar ou Rolar = jogar de novo. Voltar = menu.");
        if (acertos === 0) {
          printLcd("  0 acertos :(  ", "Tente novamente!");
        } else {
          printLcd("   Parabens!!   ", ` Acertou ${acertos} de 5 `);
          await somVitoria();
        }
      } else if (c.rolar) {
        [dado1, dado2] = await rolarDados(dadoMin, dadoMax, dado2Min, dado2Max);

        if (modo === "MISTO" && (nivel === "1" || nivel === "2")) operacao = rolarOperacao();

        if (nivel === "1") {
          if (operacao === "-" && dado1 < dado2) {
            [dado1, dado2] = [dado2, dado1];
            CB.setDados(dado1, dado2);
          }
          valInicial = dado1;
          valSecundaria = dado2;
          respostaCerta = operacao === "+" ? dado1 + dado2 : dado1 - dado2;
        } else if (nivel === "2") {
          valSecundaria = dado1 + dado2;
          if (modo === "MISTO") {
            if (operacao === "-" && valInicial < valSecundaria) operacao = "+";
            else if (operacao === "+" && valInicial + valSecundaria > 99) operacao = "-";
          }
          respostaCerta = operacao === "+" ? valInicial + valSecundaria : valInicial - valSecundaria;
        } else if (nivel === "3") {
          if (modo === "CAIXA") {
            if (dado1 + dado2 === 0) {
              dado1 = 1; // garante intervalo [1, 12]
              CB.setDados(dado1, dado2);
            }
            respostaCerta = dado1 + dado2;

            if (!temJogadaCaixa(respostaCerta, caixaDisp)) {
              atualizarLinha1(`${dado1} + ${dado2} = Role dnv`);
              await somErro();
              return;
            }
          } else if (modo === "DEZENA") {
            valInicial = dezenaBase + dado1 + dado2;
            respostaCerta = valSecundaria - valInicial;
          }
        } else if (nivel === "4") {
          if (operacao === "*") {
            valInicial = dado1;
            valSecundaria = dado2;
            respostaCerta = dado1 * dado2;
          } else if (operacao === "/") {
            [dado1, dado2] = ajustarDivisorExato(dado1, dado2);
            valSecundaria = dado1 + dado2;
            respostaCerta = Math.floor(valInicial / valSecundaria);
          }
        }

        limparLeitores();
        estado = "RESPONDA";
        mostrarTelaQuestao();
      }
    }

    // --- VALIDAÇÃO DA RESPOSTA ---
    else if (estado === "RESPONDA") {
      if (c.confirmar) {
        previewAtivo = false;
        const v = numDisplay();

        if (nivel === "3" && modo === "CAIXA") {
          const escolhidos = interpretarEntradaCaixa(v);
          const soma = escolhidos.reduce((a, b) => a + b, 0);
          const jogadaValida = escolhidos.length > 0 && escolhidos.every((n) => caixaDisp.includes(n)) && soma === respostaCerta;

          if (jogadaValida) {
            caixaDisp = caixaDisp.filter((n) => !escolhidos.includes(n));
            printLcd(`${dado1} + ${dado2} = ${escolhidos.join(" + ")}`, formatarCaixa(caixaDisp));
            await somAcerto();
            await dormir(1500);
            limparLeitores();

            if (caixaDisp.length === 0) {
              printLcd("Fechou a caixa!", "   Parabens!!   ");
              dica("Confirmar ou Rolar = jogar de novo. Voltar = menu.");
              await somVitoria();
              estado = "FIM";
            } else {
              estado = "ROLE";
              prepararNovaRodada();
            }
          } else {
            printLcd("Jogada invalida!", formatarCaixa(caixaDisp));
            await somErro();
            await dormir(1500);
            limparLeitores();
            mostrarTelaQuestao();
          }
        } else {
          const linhaResp = nivel === "3" && modo === "DEZENA"
            ? `${valInicial} + ${v} = ${valSecundaria}`
            : `${valInicial} ${operacao} ${valSecundaria} = ${v}`;

          if (v === respostaCerta) {
            printLcd(linhaResp, "Correto!");
            await somAcerto();
            erros = 0;
            questao += 1;
            acertos += 1;
            if (nivel === "2") valInicial = respostaCerta;
            await dormir(1500);
            limparLeitores();
            estado = "ROLE";
            if (questao < 5) prepararNovaRodada();
          } else if (erros < 2) {
            printLcd(linhaResp, "Erro! Tente dnv");
            await somErro();
            erros += 1;
            await dormir(1500);
            limparLeitores();
            mostrarTelaQuestao();
          } else {
            printLcd(linhaResp, `Resp: ${respostaCerta}`);
            await somErro();
            erros = 0;
            questao += 1;
            await dormir(1500);
            limparLeitores();
            estado = "ROLE";
            if (questao < 5) prepararNovaRodada();
          }
        }
      }
    }

    // --- FIM DE JOGO ---
    else if (estado === "FIM") {
      if (c.confirmar || c.rolar) estado = "INICIO";
    }

    atualizarVisualCaixa();
  }

  /* ------------------------------------------------------------------
     Liga/desliga
     ------------------------------------------------------------------ */
  async function executar() {
    try {
      for (;;) {
        await passo();
        await esperar(10);
      }
    } catch (err) {
      if (!(err instanceof Cancelado)) console.error(err);
    }
  }

  window.addEventListener("cb:energia", (e) => {
    sessao = {};            // cancela qualquer execução em andamento
    limparPend();
    resetarEstado();
    limparLeitores();
    CB.setDados(0, 0);
    atualizarVisualCaixa();
    dica("");
    if (e.detail) executar();
  });

  // Auxiliar para testes automáticos
  CB.dbg = () => ({ estado, nivel, modo, operacao, respostaCerta, questao, acertos, erros, dado1, dado2, caixaDisp: [...caixaDisp] });
})();
