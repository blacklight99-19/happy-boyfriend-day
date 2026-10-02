/* ==========================================================
   game.js — all game logic and drawing.

   Sections:
     1. CONFIG            numbers you can tweak
     2. SETUP & STATE
     3. SOUND
     4. INPUT
     5. GAME LOGIC        update(), die(), finish()
     6. DRAWING           sky, pipes, bird, screens
     7. GAME LOOP

   Game states:  'ready'  -> waiting to start
                 'play'   -> running
                 'over'   -> crashed
                 'finish' -> cleared FINISH_SCORE pillars
                             (shown as an HTML overlay, not on the canvas —
                             see showFinishOverlay() / hideFinishOverlay())
   ========================================================== */

   (() => {
    // ==========================================================
    // 1. CONFIG
    // ==========================================================
    const W = 360, H = 540, GROUND = 84;   // canvas size and ground height
    const GRAVITY = 1500;                  // how fast the bird falls (px/s²)
    const FLAP = -430;                     // upward push per flap (px/s)
    const SPEED = 135;                     // how fast pipes move (px/s)
    const PIPE_W = 58;                     // pipe width
    const GAP = 148;                       // space between top and bottom pipe
    const SPAWN_EVERY = 1.6;               // seconds between pipes
    const CAP_H = 22;                      // height of the pipe cap
    const FINISH_SCORE = 10;                // pillars to clear before the finish state — set back to 25 when done testing
    const TEXT_DURATION = 3;               // seconds the "You did it baby!" text shows before the gif appears
    const FONT = '"Silkscreen", ui-monospace, Menlo, Consolas, monospace';
  
    // ==========================================================
    // 2. SETUP & STATE
    // ==========================================================
    const canvas = document.getElementById('c');        // <canvas id="c"> in index.html
    const gameEl = document.getElementById('game');      // <div id="game"> in index.html
    const ctx = canvas.getContext('2d');
  
    // Sharper rendering on high-density screens
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  
    let state = 'ready';
    let bird, pipes, score, spawnT, pipesSpawned;
    let overT = 0, finishT = 0, t = 0;
    let groundX = 0, hillX = 0, flash = 0, shake = 0;
  
    let best = 0;
    try { best = parseInt(localStorage.getItem('flappy-best'), 10) || 0; } catch (e) {}
  
    const clouds = Array.from({ length: 5 }, () => ({
      x: Math.random() * W,
      y: 50 + Math.random() * 190,
      s: 0.7 + Math.random() * 0.8,
      v: 6 + Math.random() * 8
    }));
    const stars = Array.from({ length: 26 }, () => ({
      x: Math.random() * W,
      y: Math.random() * 190,
      a: 0.35 + Math.random() * 0.5
    }));
  
    function reset() {
      bird = { x: 96, y: 236, vy: 0, r: 22, rot: 0 };
      pipes = [];
      score = 0;
      pipesSpawned = 0;
      spawnT = 0.7;
      finishT = 0;
      hideFinishOverlay();
    }
  
    // ==========================================================
    // 3. SOUND (tiny synthesized beeps, no audio files needed)
    // ==========================================================
    let audio;
    function blip(freq, dur, type = 'square', vol = 0.05) {
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, audio.currentTime);
        o.frequency.exponentialRampToValueAtTime(freq * 1.6, audio.currentTime + dur);
        g.gain.setValueAtTime(vol, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
        o.connect(g); g.connect(audio.destination);
        o.start(); o.stop(audio.currentTime + dur);
      } catch (e) {}
    }
  
    // ==========================================================
    // 4. INPUT
    // ==========================================================
    function press() {
      if (state === 'ready') {
        state = 'play';
        bird.vy = FLAP;
        blip(420, 0.09);
      } else if (state === 'play') {
        bird.vy = FLAP;
        blip(420, 0.09);
      } else if (state === 'over' && overT > 0.6) {
        reset();
        state = 'ready';
      } else if (state === 'finish' && finishT > 0.8) {
        reset();
        state = 'ready';
      }
    }
  
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (!e.repeat) press();
      }
    });
  
    gameEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      gameEl.focus({ preventScroll: true });
      press();
    });
  
    // ==========================================================
    // 5. GAME LOGIC
    // ==========================================================
    function saveBest() {
      if (score > best) {
        best = score;
        try { localStorage.setItem('flappy-best', String(best)); } catch (e) {}
      }
    }
  
    // Called when the bird crashes
    function die() {
      state = 'over';
      overT = 0;
      flash = 1;
      shake = 0.28;
      blip(160, 0.3, 'sawtooth', 0.07);
      saveBest();
    }
  
    // Called when the player clears FINISH_SCORE pillars.
    function finish() {
      state = 'finish';
      finishT = 0;
      bird.vy = 0;
      saveBest();
      blip(523, 0.15, 'triangle', 0.07);
      setTimeout(() => blip(659, 0.15, 'triangle', 0.07), 150);
      setTimeout(() => blip(784, 0.3, 'triangle', 0.07), 300);
      showFinishOverlay();
    }
  
    function spawnPipe() {
      const min = 96, max = H - GROUND - 96 - GAP / 2;
      const gapY = min + GAP / 2 + Math.random() * (max - min - GAP / 2);
      pipes.push({ x: W + 10, gapY, passed: false });
      pipesSpawned++;
    }
  
    function update(dt) {
      t += dt;
  
      // Clouds drift in every state
      clouds.forEach(c => {
        c.x -= c.v * dt;
        if (c.x < -90) { c.x = W + 60; c.y = 50 + Math.random() * 190; }
      });
  
      // ---- ready: bird bobs, world scrolls ----
      if (state === 'ready') {
        bird.y = 236 + Math.sin(t * 4) * 7;
        bird.rot = 0;
        groundX = (groundX + SPEED * dt) % 24;
        hillX += SPEED * 0.25 * dt;
        return;
      }
  
      // ---- play ----
      if (state === 'play') {
        groundX = (groundX + SPEED * dt) % 24;
        hillX += SPEED * 0.25 * dt;
  
        bird.vy += GRAVITY * dt;
        bird.y += bird.vy * dt;
        bird.rot = Math.max(-0.45, Math.min(1.35, bird.vy / 520));
  
        // Ceiling
        if (bird.y - bird.r < 0) { bird.y = bird.r; bird.vy = 0; }
  
        // Spawn pipes, but stop once we've spawned enough to reach FINISH_SCORE
        spawnT -= dt;
        if (spawnT <= 0 && pipesSpawned < FINISH_SCORE) {
          spawnPipe();
          spawnT = SPAWN_EVERY;
        }
  
        for (const p of pipes) {
          p.x -= SPEED * dt;
  
          // Score when the bird passes a pipe
          if (!p.passed && p.x + PIPE_W < bird.x - bird.r) {
            p.passed = true;
            score++;
            blip(760, 0.08, 'triangle', 0.06);
            if (score >= FINISH_SCORE) { finish(); break; }
          }
  
          // Collision with pipes
          const overlapX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + PIPE_W;
          if (overlapX && (bird.y - bird.r < p.gapY - GAP / 2 || bird.y + bird.r > p.gapY + GAP / 2)) {
            die();
            break;
          }
        }
        pipes = pipes.filter(p => p.x + PIPE_W > -12);
  
        // Ground
        if (state === 'play' && bird.y + bird.r >= H - GROUND) {
          bird.y = H - GROUND - bird.r;
          die();
        }
        return;
      }
  
      // ---- over: bird falls, screen flashes ----
      if (state === 'over') {
        overT += dt;
        if (bird.y + bird.r < H - GROUND) {
          bird.vy += GRAVITY * dt;
          bird.y += bird.vy * dt;
          bird.rot = Math.min(1.5, bird.rot + 6 * dt);
          if (bird.y + bird.r > H - GROUND) bird.y = H - GROUND - bird.r;
        }
        flash = Math.max(0, flash - dt * 3.5);
        shake = Math.max(0, shake - dt);
        return;
      }
  
      // ---- finish: bird glides safely, world keeps scrolling ----
      if (state === 'finish') {
        finishT += dt;
        groundX = (groundX + SPEED * dt) % 24;
        hillX += SPEED * 0.25 * dt;
        pipes.forEach(p => { p.x -= SPEED * dt; });                 // leftover pipes slide off
        pipes = pipes.filter(p => p.x + PIPE_W > -12);
        const targetY = 236 + Math.sin(t * 3) * 10;
        bird.y += (targetY - bird.y) * Math.min(1, dt * 4);         // ease to a gentle bob
        bird.rot += (0 - bird.rot) * Math.min(1, dt * 6);
      }
    }
  
    // ==========================================================
    // 6. DRAWING
    // ==========================================================
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  
    function outlinedText(text, x, y, size, fill = '#fff', stroke = '#2a2140') {
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size / 5);
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    }
  
    // ---- Background ----
    function drawSky() {
      const g = ctx.createLinearGradient(0, 0, 0, H - GROUND);
      g.addColorStop(0, '#2b2668');
      g.addColorStop(0.45, '#7d4a9c');
      g.addColorStop(0.8, '#e5748a');
      g.addColorStop(1, '#f9a56f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
  
      stars.forEach(s => {
        ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(t * 2 + s.x));
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
      });
      ctx.globalAlpha = 1;
  
      // Low sun
      ctx.fillStyle = '#ffd08a';
      ctx.beginPath(); ctx.arc(262, H - GROUND - 92, 38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 208, 138, 0.25)';
      ctx.beginPath(); ctx.arc(262, H - GROUND - 92, 58, 0, Math.PI * 2); ctx.fill();
    }
  
    function drawClouds() {
      clouds.forEach(c => {
        ctx.fillStyle = 'rgba(255, 220, 230, 0.55)';
        const w = 54 * c.s, h = 16 * c.s;
        roundRect(c.x, c.y, w, h, h / 2); ctx.fill();
        roundRect(c.x + w * 0.2, c.y - h * 0.7, w * 0.5, h, h / 2); ctx.fill();
      });
    }
  
    function drawHills() {
      const base = H - GROUND;
      const layer = (color, amp, freq, speed, lift) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, base);
        for (let x = 0; x <= W; x += 4) {
          const o = x + hillX * speed;
          const y = base - lift - (Math.sin(o * freq) * amp + Math.sin(o * freq * 2.3 + 1) * amp * 0.4);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, base);
        ctx.closePath();
        ctx.fill();
      };
      layer('#6a3f8c', 22, 0.013, 0.5, 34);   // far hills
      layer('#432a6b', 16, 0.02, 1, 12);      // near hills
    }
  
    // ---- Pipes ----
    function drawPipe(p) {
      const topH = p.gapY - GAP / 2;
      const botY = p.gapY + GAP / 2;
      const botH = H - GROUND - botY;
  
      const body = (x, y, w, h) => {
        ctx.fillStyle = '#2f9e8a'; ctx.fillRect(x, y, w, h);              // main color
        ctx.fillStyle = '#5fd0b8'; ctx.fillRect(x + 4, y, 8, h);          // highlight
        ctx.fillStyle = '#1f6f61'; ctx.fillRect(x + w - 10, y, 10, h);    // shadow
        ctx.strokeStyle = '#16463e'; ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);                   // outline
      };
  
      body(p.x, -4, PIPE_W, topH + 4);                  // top pipe
      body(p.x - 4, topH - CAP_H, PIPE_W + 8, CAP_H);   // top cap
      body(p.x, botY, PIPE_W, botH);                    // bottom pipe
      body(p.x - 4, botY, PIPE_W + 8, CAP_H);           // bottom cap
    }
  
    // ---- Ground ----
    function drawGround() {
      const y = H - GROUND;
      ctx.fillStyle = '#b6e36b'; ctx.fillRect(0, y, W, 10);
      ctx.fillStyle = '#7fb83d'; ctx.fillRect(0, y + 10, W, 6);
      ctx.fillStyle = '#d9b877'; ctx.fillRect(0, y + 16, W, GROUND - 16);
      ctx.fillStyle = '#c29c5c';
      for (let x = -24 + (-groundX); x < W + 24; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, y + 16); ctx.lineTo(x + 12, y + 16);
        ctx.lineTo(x + 2, y + GROUND); ctx.lineTo(x - 10, y + GROUND);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#16463e'; ctx.fillRect(0, y - 2, W, 3);
    }
  
    // ---- Bird (image sprite) ----
    const birdImg = new Image();
    birdImg.src = 'mylove.png';   // must sit next to index.html, game.js, style.css
  
    let birdImgReady = false;
    birdImg.onload = () => { birdImgReady = true; };
    birdImg.onerror = () => { console.error('Could not load mylove.png — check the filename and that it is in the same folder as index.html'); };
  
    const BIRD_SIZE = 52;   // on-screen height in pixels; width follows the image's own aspect ratio
  
    function drawBird() {
      if (!birdImgReady) return;   // draw nothing until the image has actually loaded
  
      const h = BIRD_SIZE;
      const w = h * (birdImg.naturalWidth / birdImg.naturalHeight);
  
      ctx.save();
      ctx.translate(bird.x, bird.y);
      ctx.rotate(bird.rot);
      ctx.scale(-1, 1);
      ctx.imageSmoothingEnabled = false;   // keeps pixel art crisp; set true if your image isn't pixel art
      ctx.drawImage(birdImg, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  
    // ---- Finish screen overlay (real HTML elements, not drawn on canvas) ----
    // The gif only animates if it's a visible <img> on the page, so instead of
    // drawing it onto the canvas, we show/hide a real overlay in index.html.
    // See the #finishOverlay / #finishText / #finishGifImg elements there.
    const finishOverlay = document.getElementById('finishOverlay');
    let finishTextTimer = null;
  
    const finishGifImg = document.getElementById('finishGifImg');

    function showFinishOverlay() {
      finishOverlay.classList.add('visible', 'show-text');
      finishOverlay.classList.remove('show-gif');
      clearTimeout(finishTextTimer);
      finishTextTimer = setTimeout(() => {
        finishOverlay.classList.remove('show-text');
        finishOverlay.classList.add('show-gif');
        // Reload the gif so it restarts from frame 1 instead of showing
        // wherever it happened to be after playing quietly in the background
        finishGifImg.src = 'meetcute.gif?t=' + Date.now();
      }, TEXT_DURATION * 1000);
    }
  
    function hideFinishOverlay() {
      finishOverlay.classList.remove('visible', 'show-text', 'show-gif');
      clearTimeout(finishTextTimer);
    }
  
    // Now that showFinishOverlay/hideFinishOverlay exist, it's safe to set up initial state.
    reset();
  
    // ---- Game over screen (after a crash) ----
    function drawGameOverScreen() {
      const w = 220, h = 150, x = (W - w) / 2, y = 150;
      ctx.fillStyle = '#2a2140';
      roundRect(x - 3, y - 3, w + 6, h + 6, 10); ctx.fill();
      ctx.fillStyle = '#f7ecd0';
      roundRect(x, y, w, h, 8); ctx.fill();
  
      outlinedText('Game over', W / 2, y + 30, 22, '#ff6b4a');
  
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#6d5a3a';
      ctx.font = `400 13px ${FONT}`;
      ctx.fillText('Score', x + w * 0.28, y + 68);
      ctx.fillText('Best', x + w * 0.72, y + 68);
      ctx.fillStyle = '#2a2140';
      ctx.font = `700 32px ${FONT}`;
      ctx.fillText(String(score), x + w * 0.28, y + 98);
      ctx.fillText(String(best), x + w * 0.72, y + 98);
  
      if (overT > 0.6) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
        ctx.fillStyle = '#2a2140';
        ctx.font = `700 13px ${FONT}`;
        ctx.fillText('Tap to play again', W / 2, y + 132);
        ctx.globalAlpha = 1;
      }
    }
  
    // ---- Draw everything for the current frame ----
    function draw() {
      ctx.save();
      if (shake > 0) {
        const k = 8 * (shake / 0.28);
        ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      }
  
      drawSky();
      drawClouds();
      drawHills();
      pipes.forEach(drawPipe);
      drawGround();
      drawBird();
  
      if (state === 'play') {
        outlinedText(String(score), W / 2, 62, 46);
      } else if (state === 'ready') {
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 4);
        outlinedText('Tap to start', W / 2, 330, 16);
        ctx.globalAlpha = 1;
        if (best > 0) outlinedText('Best ' + best, W / 2, 360, 13, '#ffeaa0');
      } else if (state === 'over') {
        drawGameOverScreen();
      }
      // 'finish' state draws nothing extra here — the HTML overlay sits on top
      // of the canvas instead (see showFinishOverlay()).
  
      ctx.restore();
  
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.7})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  
    // ==========================================================
    // 7. GAME LOOP
    // ==========================================================
    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.033);   // cap dt so tab-switching doesn't break physics
      last = now;
      update(dt);
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();
