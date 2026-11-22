/* =========================================================================
   Conta Blocos — convite para instalar o web app
   - Android (Chrome/Edge/Samsung): usa o evento "beforeinstallprompt" e abre
     o instalador do navegador ao tocar em "Instalar".
   - iPhone/iPad (Safari): não existe esse evento, então mostra o passo a passo.
   - Só aparece em celulares/tablets, fora do app instalado, e só uma vez:
     se a pessoa tocar em "Agora não" ou instalar, não aparece de novo.
   - Para ver o convite em qualquer aparelho: abra o site com ?instalar=1
   ========================================================================= */
(() => {
  "use strict";

  const CHAVE = "cb-instalar-dispensado";
  const forcar = /[?&]instalar=1/.test(location.search);

  const lerFlag = () => { try { return localStorage.getItem(CHAVE) === "1"; } catch (e) { return false; } };
  const gravarFlag = () => { try { localStorage.setItem(CHAVE, "1"); } catch (e) { /* sem armazenamento */ } };

  const jaInstalado = () =>
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    navigator.standalone === true;
  const eCelular = () => matchMedia("(pointer: coarse)").matches;
  const eIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (jaInstalado()) return;
  if (!forcar && (!eCelular() || lerFlag())) return;

  let evento = null;   // evento nativo de instalação (Android/Chrome)
  let cartao = null;

  function esconder() {
    if (cartao) { cartao.remove(); cartao = null; }
  }

  function mostrar(titulo, texto, botoes) {
    if (cartao) return;
    cartao = document.createElement("div");
    cartao.id = "instalar";
    cartao.setAttribute("role", "dialog");
    cartao.setAttribute("aria-label", "Instalar Conta Blocos");

    const img = document.createElement("img");
    img.src = "icons/icon-192.png";
    img.alt = "";

    const corpo = document.createElement("div");
    corpo.className = "inst-texto";
    const t = document.createElement("b");
    t.textContent = titulo;
    const p = document.createElement("span");
    p.textContent = texto;
    corpo.append(t, p);

    const acoes = document.createElement("div");
    acoes.className = "inst-acoes";
    botoes.forEach(({ rotulo, principal, acao }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = rotulo;
      if (principal) b.className = "inst-principal";
      b.addEventListener("click", acao);
      acoes.appendChild(b);
    });

    cartao.append(img, corpo, acoes);
    document.body.appendChild(cartao);
  }

  const dispensar = () => { gravarFlag(); esconder(); };

  async function instalar() {
    if (!evento) return dispensar();
    const e = evento;
    evento = null;
    esconder();
    try {
      e.prompt();
      await e.userChoice;      // aceitou ou recusou: em ambos os casos não insiste
    } catch (err) { /* ignora */ }
    gravarFlag();
  }

  function mostrarAndroid() {
    mostrar(
      "Instalar o Conta Blocos",
      "Use como aplicativo: abre em tela cheia e funciona sem internet.",
      [
        { rotulo: "Instalar", principal: true, acao: instalar },
        { rotulo: "Agora não", acao: dispensar },
      ]
    );
  }

  function mostrarIOS() {
    mostrar(
      "Instalar o Conta Blocos",
      "Toque em Compartilhar (quadrado com seta) e depois em “Adicionar à Tela de Início”.",
      [{ rotulo: "Entendi", principal: true, acao: dispensar }]
    );
  }

  function mostrarManual() {
    mostrar(
      "Instalar o Conta Blocos",
      "Abra o menu do navegador (⋮) e toque em “Instalar app” ou “Adicionar à tela inicial”.",
      [{ rotulo: "Entendi", principal: true, acao: dispensar }]
    );
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();          // segura o aviso do navegador para usarmos o nosso
    evento = e;
    setTimeout(mostrarAndroid, 1500);
  });

  window.addEventListener("appinstalled", () => { evento = null; dispensar(); });

  if (eIOS()) {
    setTimeout(mostrarIOS, 2000);
  } else if (forcar) {
    // pré-visualização: se o navegador não mandou o evento, mostra o texto manual
    setTimeout(() => { if (!evento) mostrarManual(); }, 2500);
  }
})();
