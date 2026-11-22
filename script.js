/* =========================================================================
   Conta Blocos — versão web (interface: visual, botões, LEDs, LCD e blocos)
   A lógica do jogo (main.py) está em jogo.js, que usa a API window.CB.
   ========================================================================= */
(() => {
  "use strict";

  const stage = document.getElementById("stage");
  const viewport = document.getElementById("viewport");
  let escala = 1;

  /* ---------- Ajuste de escala (o desenho tem 1140 x 665) ---------- */
  function ajustarEscala() {
    const larg = document.documentElement.clientWidth;
    escala = Math.min(larg / 1140, 1.4);
    stage.style.transform = `scale(${escala})`;
    viewport.style.height = `${665 * escala}px`;
  }
  window.addEventListener("resize", ajustarEscala);
  ajustarEscala();

  function posicaoNoPalco(e) {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / escala, y: (e.clientY - r.top) / escala };
  }

  /* ---------- Áudio (equivale a tocar_tom do main.py) ---------- */
  let audioCtx = null;
  let audioBloqueado = false;
  const buzzerEl = document.getElementById("buzzer");
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

  // Cria o AudioContext e mantém uma saída silenciosa sempre ativa: sem isso,
  // alguns navegadores/fones Bluetooth "dormem" e cortam o começo dos sons.
  async function prepararAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const mudo = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.value = 0;
      mudo.connect(g);
      g.connect(audioCtx.destination);
      mudo.start();
    }
    if (audioCtx.state === "running") {
      audioBloqueado = false;
    } else if (!audioBloqueado) {
      // não deixa o jogo travar se o navegador não liberar o áudio
      try { await Promise.race([audioCtx.resume(), pausa(250)]); } catch (err) { /* segue sem áudio */ }
      if (audioCtx.state !== "running") audioBloqueado = true;
    } else {
      audioCtx.resume().catch(() => {});
    }
  }

  // Equivale a tocar_tom(freq, ms) do main.py
  async function tom(freq, ms) {
    try {
      await prepararAudio();
      const dur = ms / 1000;
      const t = audioCtx.currentTime;
      const rampa = Math.min(0.005, dur / 3);
      const osc = audioCtx.createOscillator();
      const ganho = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0, t);
      ganho.gain.linearRampToValueAtTime(0.04, t + rampa);
      ganho.gain.setValueAtTime(0.04, t + dur - rampa);
      ganho.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(ganho);
      ganho.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      buzzerEl.classList.add("tocando");
      await pausa(ms);
      buzzerEl.classList.remove("tocando");
    } catch (err) {
      await pausa(ms);
    }
  }

  /* ---------- LCD 16x2 ---------- */
  const lcdEl = document.getElementById("lcd");
  const celulas = [[], []];
  for (let linha = 0; linha < 2; linha++) {
    for (let col = 0; col < 16; col++) {
      const c = document.createElement("b");
      lcdEl.appendChild(c);
      celulas[linha].push(c);
    }
  }

  function escreverLinha(linha, texto) {
    const t = String(texto).slice(0, 16).padEnd(16, " ");
    for (let i = 0; i < 16; i++) celulas[linha][i].textContent = t[i] === " " ? "" : t[i];
  }

  const lcd = {
    ligado: false,
    // print_lcd(linha1, linha2="")
    print(l1, l2 = "") {
      if (!this.ligado) return;
      escreverLinha(0, l1);
      escreverLinha(1, l2);
    },
    // atualizar_linha1_lcd(texto)
    linha1(texto) {
      if (!this.ligado) return;
      escreverLinha(0, texto);
    },
    limpar() {
      escreverLinha(0, "");
      escreverLinha(1, "");
    },
  };

  /* ---------- LEDs dos dados (7 LEDs por dado, valores 0 a 7) ---------- */
  const COLS = [35, 88, 142];
  const LINS = [37, 87, 141];
  // Ordem dos LEDs: 0=TL 1=TR 2=ML 3=C 4=MR 5=BL 6=BR
  const POS_LED = [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]];
  const PADRAO = [
    [],
    [3],
    [0, 6],
    [0, 3, 6],
    [0, 1, 5, 6],
    [0, 1, 3, 5, 6],
    [0, 1, 2, 4, 5, 6],
    [0, 1, 2, 3, 4, 5, 6],
  ];

  function criarDado(id) {
    const el = document.getElementById(id);
    const leds = POS_LED.map(([c, l]) => {
      const u = document.createElement("u");
      u.style.left = `${COLS[c] - 14}px`;
      u.style.top = `${LINS[l] - 14}px`;
      el.appendChild(u);
      return u;
    });
    return leds;
  }
  const ledsDado = [criarDado("dado-1"), criarDado("dado-2")];

  function mostrarDado(idx, valor) {
    const acesos = PADRAO[Math.max(0, Math.min(7, valor | 0))];
    ledsDado[idx].forEach((u, i) => u.classList.toggle("on", acesos.includes(i)));
  }
  function setDados(d1, d2) {
    mostrarDado(0, d1);
    mostrarDado(1, d2);
  }
  setDados(0, 0);

  /* ---------- Chave de legendas ---------- */
  document.getElementById("chk-legendas").addEventListener("change", (e) => {
    document.body.classList.toggle("legendas", e.target.checked);
  });

  /* ---------- Liga/Desliga ---------- */
  const chave = document.getElementById("chave");
  const CB_estado = { ligado: false };

  chave.addEventListener("click", () => {
    CB_estado.ligado = !CB_estado.ligado;
    lcd.ligado = CB_estado.ligado;
    chave.classList.toggle("ligada", CB_estado.ligado);
    document.body.classList.toggle("ligado", CB_estado.ligado);
    if (!CB_estado.ligado) {
      lcd.limpar();
      setDados(0, 0);
    }
    window.dispatchEvent(new CustomEvent("cb:energia", { detail: CB_estado.ligado }));
  });

  /* ---------- Botões (equivalem a btn_x.value()) ---------- */
  const botoes = { voltar: false, rolar: false, confirmar: false };

  function ligarBotao(nome) {
    const el = document.getElementById(`btn-${nome}`);
    const soltar = () => {
      if (!botoes[nome]) return;
      botoes[nome] = false;
      el.classList.remove("apertado");
      window.dispatchEvent(new CustomEvent("cb:botao", { detail: { nome, estado: "up" } }));
    };
    el.addEventListener("pointerdown", (e) => {
      if (!CB_estado.ligado) return;
      el.setPointerCapture(e.pointerId);
      botoes[nome] = true;
      el.classList.add("apertado");
      window.dispatchEvent(new CustomEvent("cb:botao", { detail: { nome, estado: "down" } }));
    });
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
    el.addEventListener("lostpointercapture", soltar);
  }
  ["voltar", "rolar", "confirmar"].forEach(ligarBotao);

  /* ---------- Blocos e leitores NFC ---------- */
  const TAM_BLOCO = 52;     // tamanho no painel
  const TAM_LEITOR = 100;   // tamanho sobre o leitor
  const TAM_ARRASTE = 64;   // tamanho enquanto arrasta
  const ZONA_Y = 340;       // a partir daqui conta como "em cima do leitor"
  const ZONAS_X = [[652, 852], [852, 1052]]; // dezena | unidade

  const encaixes = [null, null];
  const blocos = [];
  const leituraEl = document.getElementById("leitura");

  // Grade 4 x 5: duas linhas claras e duas escuras, números 1 2 3 4 5 / 6 7 8 9 0
  const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  for (let linha = 0; linha < 4; linha++) {
    for (let col = 0; col < 5; col++) {
      const numero = NUMEROS[(linha % 2) * 5 + col];
      const el = document.createElement("div");
      el.className = "bloco " + (linha < 2 ? "claro" : "escuro");
      el.textContent = numero;
      stage.appendChild(el);
      const b = { el, numero, hx: 705 + col * 61, hy: 47 + linha * 61, encaixe: null };
      blocos.push(b);
      colocar(b, b.hx, b.hy, TAM_BLOCO);
      ligarArraste(b);
    }
  }

  function colocar(b, x, y, tam) {
    const s = b.el.style;
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${tam}px`;
    s.height = `${tam}px`;
    s.fontSize = `${Math.round(tam * 0.46)}px`;
  }

  function voltarParaPainel(b) {
    if (b.encaixe !== null && encaixes[b.encaixe] === b) encaixes[b.encaixe] = null;
    b.encaixe = null;
    colocar(b, b.hx, b.hy, TAM_BLOCO);
  }

  function irParaLeitor(b, i) {
    const anterior = encaixes[i];
    if (anterior && anterior !== b) voltarParaPainel(anterior);
    encaixes[i] = b;
    b.encaixe = i;
    const cx = (ZONAS_X[i][0] + ZONAS_X[i][1]) / 2;
    colocar(b, cx - TAM_LEITOR / 2, 380, TAM_LEITOR);
  }

  // No Feche a Caixa os dois blocos são somados (5 + 4), e não dezena/unidade
  let modoSoma = false;
  function textoLeitura() {
    const a = encaixes[0], b = encaixes[1];
    if (!a && !b) return "—";
    if (modoSoma) return a && b ? `${a.numero} + ${b.numero}` : String((a || b).numero);
    return String(valorLido());
  }

  // Valor lido: dezena (esquerda) * 10 + unidade (direita); null se vazio
  function valorLido() {
    if (!encaixes[0] && !encaixes[1]) return null;
    return (encaixes[0] ? encaixes[0].numero : 0) * 10 + (encaixes[1] ? encaixes[1].numero : 0);
  }

  function atualizarLeitura() {
    const v = valorLido();
    leituraEl.textContent = "Leitura: " + textoLeitura();
    window.dispatchEvent(new CustomEvent("cb:leitura", { detail: v }));
  }

  function limparLeitores() {
    blocos.forEach((b) => { if (b.encaixe !== null) voltarParaPainel(b); });
    atualizarLeitura();
  }

  function ligarArraste(b) {
    let desloc = TAM_ARRASTE / 2;

    b.el.addEventListener("pointerdown", (e) => {
      b.el.setPointerCapture(e.pointerId);
      // se estava num leitor, libera o encaixe
      if (b.encaixe !== null) {
        if (encaixes[b.encaixe] === b) encaixes[b.encaixe] = null;
        b.encaixe = null;
        atualizarLeitura();
      }
      b.el.classList.add("arrastando");
      const p = posicaoNoPalco(e);
      colocar(b, p.x - desloc, p.y - desloc, TAM_ARRASTE);
    });

    b.el.addEventListener("pointermove", (e) => {
      if (!b.el.classList.contains("arrastando")) return;
      const p = posicaoNoPalco(e);
      colocar(b, p.x - desloc, p.y - desloc, TAM_ARRASTE);
    });

    const soltar = (e) => {
      if (!b.el.classList.contains("arrastando")) return;
      b.el.classList.remove("arrastando");
      const p = posicaoNoPalco(e);
      let destino = -1;
      if (p.y >= ZONA_Y) {
        ZONAS_X.forEach(([a, z], i) => { if (p.x >= a && p.x < z) destino = i; });
      }
      if (destino >= 0) irParaLeitor(b, destino);
      else voltarParaPainel(b);
      atualizarLeitura();
    };
    b.el.addEventListener("pointerup", soltar);
    b.el.addEventListener("pointercancel", soltar);
  }

  /* ---------- API para a etapa 2 (lógica do main.py) ---------- */
  window.CB = {
    lcd,                       // lcd.print(l1, l2) / lcd.linha1(txt)
    setDados,                  // setDados(d1, d2) -> LEDs dos dois dados (0 a 7)
    tom,                       // await tom(freq, ms)
    botoes,                    // botoes.rolar === true enquanto pressionado
    leitor: {
      valor: valorLido,
      limpar: limparLeitores,
      modoSoma: (on) => { modoSoma = !!on; atualizarLeitura(); },
    },
    ligado: () => CB_estado.ligado,
  };
})();
