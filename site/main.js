// Página da Revoada, na linguagem da plumagem da AraraHQ: capa presa com a foto do bando, folha de papel que sobe por
// cima, capítulos com a conversa transcrita, a prancha de confiança e o fecho com os comandos de instalar.
(() => {
  'use strict';

  const raiz = document.documentElement;
  const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (id) => document.getElementById(id);
  const lim = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // Cada visita abre do topo; só uma âncora no endereço leva a outro ponto. Sai de cena no primeiro toque ou rolagem.
  if (!location.hash) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const ate = performance.now() + 1200;
    let mexeu = false;
    const proTopo = () => { if (!mexeu && performance.now() < ate && scrollY > 0) scrollTo({ top: 0, left: 0, behavior: 'instant' }); };
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((tipo) => addEventListener(tipo, () => { mexeu = true; }, { once: true, passive: true }));
    scrollTo({ top: 0, left: 0, behavior: 'instant' });
    ['scroll', 'pageshow', 'load'].forEach((tipo) => addEventListener(tipo, proTopo, { passive: true }));
  }

  // Grão: um ladrilho de ruído gerado na hora, parado
  (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    if (!x) return;
    const d = x.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = Math.random() * 30;
    }
    x.putImageData(d, 0, 0);
    raiz.style.setProperty('--grao', `url(${c.toDataURL()})`);
  })();

  // ---------- capa ----------

  const capa = el('topo');
  const meio = el('capa-meio');
  const fotoCapa = el('foto-capa');
  const nav = el('nav');
  const titulo = document.querySelector('.titulo');
  const quem = el('quem');

  // a letra ocupa a largura inteira; em tela de pé, vira duas linhas
  function ajustarTitulo() {
    if (!titulo || !innerWidth || !innerHeight) return;
    const duas = innerWidth / innerHeight < 1.15;
    titulo.classList.toggle('duas', duas);
    titulo.style.fontSize = '100px';
    const linhas = [...titulo.querySelectorAll('.ln > span')].map((s) => s.getBoundingClientRect().width);
    const largura = duas ? Math.max(...linhas) : linhas[0] + linhas[1] + 22;
    const cabe = ((meio.clientWidth - parseFloat(getComputedStyle(meio).paddingLeft) * 2) / largura) * 100;
    if (!(cabe > 0) || !isFinite(cabe)) { titulo.style.fontSize = ''; return; }
    titulo.style.fontSize = Math.min(cabe, innerHeight * (duas ? 0.2 : 0.28)).toFixed(1) + 'px';
  }

  // a linha de baixo passa pelas situações em que a conversa segue e para na primeira, a mesma do primeiro capítulo
  const FRASES = ['uma conta bate no limite.', 'a janela de cinco horas acaba.', 'você troca de agente no meio.'];
  async function girar() {
    if (!quem || calmo) return;
    await espera(2400);
    for (let trocas = 1; trocas <= FRASES.length; trocas++) {
      await espera(2600);
      if (capa.classList.contains('fora') || document.hidden) { trocas--; continue; }
      await quem.animate(
        [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-.25em)', filter: 'blur(8px)' }],
        { duration: 240, easing: 'ease-in', fill: 'forwards' },
      ).finished;
      quem.textContent = FRASES[trocas % FRASES.length];
      quem.animate(
        [{ opacity: 0, transform: 'translateY(.3em)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
        { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' },
      );
    }
  }

  // ponteiro: a foto e o título se deslocam um pouco em sentidos opostos
  const ponteiro = { x: 0.5, y: 0.5 };
  let fx = 0, fy = 0, quadroVivo = false;
  function quadro() {
    const ax = -(ponteiro.x - 0.5) * 26, ay = -(ponteiro.y - 0.5) * 18;
    if (capa.classList.contains('fora') || (Math.abs(ax - fx) < 0.02 && Math.abs(ay - fy) < 0.02)) { quadroVivo = false; return; }
    fx += (ax - fx) * 0.05;
    fy += (ay - fy) * 0.05;
    fotoCapa.style.setProperty('--bx', fx.toFixed(2));
    fotoCapa.style.setProperty('--by', fy.toFixed(2));
    meio.style.setProperty('--fx', (-fx * 0.16).toFixed(2));
    meio.style.setProperty('--fy', (-fy * 0.16).toFixed(2));
    requestAnimationFrame(quadro);
  }
  addEventListener('pointermove', (e) => {
    ponteiro.x = e.clientX / innerWidth;
    ponteiro.y = e.clientY / innerHeight;
    if (!calmo && !quadroVivo) { quadroVivo = true; requestAnimationFrame(quadro); }
  }, { passive: true });

  // rolagem: a capa escurece e recua enquanto a folha sobe; as outras pranchas deslizam devagar; a barra vira papel
  const pranchas = [...document.querySelectorAll('.prancha .foto')];
  let rolando = false;
  function aoRolar() {
    if (rolando) return;
    rolando = true;
    requestAnimationFrame(() => {
      rolando = false;
      const y = scrollY, h = capa.offsetHeight, tela = innerHeight;
      if (!h || !tela) return;
      capa.style.setProperty('--p', lim(y / h).toFixed(3));
      capa.classList.toggle('fora', y > h * 1.05);
      nav.classList.toggle('papel', y > h - 76);
      if (calmo) return;
      for (const f of pranchas) {
        const r = f.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > tela) continue;
        f.style.setProperty('--y', ((r.top + r.height / 2 - tela / 2) * -0.07).toFixed(1));
      }
    });
  }
  addEventListener('scroll', aoRolar, { passive: true });

  // ---------- capítulos: a conversa toca quando chega na tela ----------

  const caps = document.querySelectorAll('.cap');
  if (!calmo && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((itens) => itens.forEach((i) => {
      if (i.isIntersecting) { i.target.classList.add('dentro'); io.unobserve(i.target); }
    }), { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    caps.forEach((c) => io.observe(c));
  } else caps.forEach((c) => c.classList.add('dentro'));

  // ---------- perguntas: abrir uma fecha a outra; cada linha responde quando o ponteiro passa perto ----------

  const lista = document.querySelector('.perguntas');
  if (lista) {
    const itens = [...lista.querySelectorAll('details')];
    const fechar = (d) => { if (!d.classList.contains('aberta')) return; d.classList.remove('aberta'); if (calmo) d.open = false; };
    const abrir = (d) => { itens.forEach((outra) => { if (outra !== d) fechar(outra); }); d.open = true; void d.offsetWidth; d.classList.add('aberta'); };
    itens.forEach((d) => {
      const pergunta = d.querySelector('summary');
      const resposta = document.createElement('div');
      const dentro = document.createElement('div');
      const texto = document.createElement('span');
      texto.className = 'txt';
      while (pergunta.firstChild && pergunta.firstChild.nodeType === 3) texto.append(pergunta.firstChild);
      pergunta.prepend(texto);
      resposta.className = 'resposta';
      resposta.append(dentro);
      while (pergunta.nextSibling) dentro.append(pergunta.nextSibling);
      d.append(resposta);
      pergunta.addEventListener('click', (e) => { e.preventDefault(); d.classList.contains('aberta') ? fechar(d) : abrir(d); });
      resposta.addEventListener('transitionend', (e) => {
        if (e.target === resposta && e.propertyName === 'grid-template-rows' && !d.classList.contains('aberta')) d.open = false;
      });
      d.addEventListener('toggle', () => { if (d.open && !d.classList.contains('aberta')) abrir(d); });
    });

    if (!calmo && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const linhas = itens.map((d) => [d, d.querySelector('summary')]);
      let px = -9999, py = -9999, pedido = false;
      const medir = () => {
        pedido = false;
        for (const [d, pergunta] of linhas) {
          const r = pergunta.getBoundingClientRect();
          const dy = py - (r.top + r.height / 2);
          const dx = px < r.left ? r.left - px : px > r.right ? px - r.right : 0;
          const perto = Math.exp(-(dy * dy) / 4232) * Math.exp(-(dx * dx) / 39200);
          d.style.setProperty('--perto', perto < 0.02 ? 0 : perto.toFixed(3));
        }
      };
      const pedir = () => { if (!pedido) { pedido = true; requestAnimationFrame(medir); } };
      addEventListener('pointermove', (e) => { if (e.pointerType && e.pointerType !== 'mouse') return; px = e.clientX; py = e.clientY; pedir(); }, { passive: true });
      addEventListener('scroll', pedir, { passive: true });
      raiz.addEventListener('pointerleave', () => { px = py = -9999; pedir(); });
    }
  }

  // ---------- os dois sons do app, feitos na hora como lá ----------

  (() => {
    let audio = null;
    const SOM = { done: [[659.25, 0, 0.5], [987.77, 0.11, 0.7]], ask: [[880, 0, 0.16], [880, 0.24, 0.16], [1174.66, 0.48, 0.3]] };
    const toca = (notas) => {
      try {
        audio ||= new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const t0 = audio.currentTime + 0.02;
        notas.forEach(([freq, at, dur]) => {
          const osc = audio.createOscillator(), ganho = audio.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          ganho.gain.setValueAtTime(0, t0 + at);
          ganho.gain.linearRampToValueAtTime(0.14, t0 + at + 0.015);
          ganho.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
          osc.connect(ganho).connect(audio.destination);
          osc.start(t0 + at);
          osc.stop(t0 + at + dur + 0.05);
        });
      } catch { /* sem áudio, sem som */ }
    };
    document.querySelectorAll('[data-som]').forEach((b) => b.addEventListener('click', () => {
      toca(SOM[b.dataset.som]);
      b.classList.add('tocando');
      setTimeout(() => b.classList.remove('tocando'), 900);
    }));
  })();

  // ---------- copiar os comandos de instalar ----------

  (() => {
    const b = document.querySelector('[data-copiar]');
    const pre = document.querySelector('[data-comandos]');
    const rotulo = b && b.querySelector('[data-copiar-texto]');
    if (!b || !pre || !rotulo) return;
    let volta = 0;
    b.addEventListener('click', async () => {
      const texto = [...pre.querySelectorAll('code > span')].map((l) => l.textContent).join('\n') + '\n';
      let ok = true;
      try { await navigator.clipboard.writeText(texto); } catch {
        ok = false;
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      rotulo.textContent = ok ? 'Copiado' : 'Selecionado, use ⌘C';
      b.classList.toggle('feito', ok);
      clearTimeout(volta);
      volta = setTimeout(() => { rotulo.textContent = 'Copiar'; b.classList.remove('feito'); }, 2000);
    });
  })();

  // ---------- começo ----------

  let espelho;
  const reajustar = () => { ajustarTitulo(); aoRolar(); };
  const pedirReajuste = () => { clearTimeout(espelho); espelho = setTimeout(reajustar, 80); };
  addEventListener('resize', pedirReajuste);
  if ('ResizeObserver' in window) new ResizeObserver(pedirReajuste).observe(capa);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reajustar(); });
  const comecar = () => {
    reajustar();
    setTimeout(() => {
      capa.classList.add('entrou');
      girar();
      setTimeout(() => capa.classList.add('pronta'), 2000);
    }, 40);
  };
  if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, espera(1500)]).then(comecar);
  else comecar();
})();
