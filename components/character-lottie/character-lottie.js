// Canvas 呼吸光环 —— 中心球体 + 多层光环扩散（Siri 风格）
Component({
  properties: {
    state: { type: String, value: 'idle' },
  },
  data: { canvasWidth: 180, canvasHeight: 180 },
  _liveEnergy: 0,
  _currentEnergy: 0,

  observers: {
    state(val) {
      if (this._running) this._currentState = val;
    },
  },

  lifetimes: {
    attached() { this._initCanvas(); },
    detached() {
      this._running = false;
      if (this._timer && this.canvas) {
        this.canvas.cancelAnimationFrame(this._timer);
        this._timer = null;
      }
    },
  },

  methods: {
    setLiveEnergy(value) {
      this._liveEnergy = Math.min(1, Math.max(0, value));
    },

    _hexToRgb(hex) {
      const v = parseInt(hex.slice(1), 16);
      return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    },

    _lerpColor(a, b, t) {
      return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
    },

    _rgba(c, a) { return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`; },

    _initCanvas() {
      setTimeout(() => {
        this.createSelectorQuery().select('#charCanvas').node((res) => {
          if (!res || !res.node) return;
          this.canvas = res.node;
          this.ctx = this.canvas.getContext('2d');
          this._curColor = { r: 0, g: 122, b: 255 };
          this._liveEnergy = 0;
          this._currentEnergy = 0;
          this._running = true;
          this._currentState = this.data.state;
          this._frame = 0;
          this._draw();
        }).exec();
      }, 100);
    },

    _draw() {
      if (!this._running) return;
      const ctx = this.ctx;
      const canvas = this.canvas;
      const w = canvas.width, h = canvas.height;
      const frame = this._frame;
      const state = this._currentState || 'idle';
      ctx.clearRect(0, 0, w, h);

      const t = frame * 0.015;
      const cx = w / 2, cy = h / 2;

      // === 状态 ===
      let colorHex, breatheSpeed, breatheAmp, size;
      switch (state) {
        case 'thinking':  colorHex = '#FF9500'; breatheSpeed = 0.5; breatheAmp = 0.02; size = 0.95; break;
        case 'speaking':  colorHex = '#34C759'; breatheSpeed = 1.2; breatheAmp = 0.03; size = 1.02; break;
        case 'happy':     colorHex = '#FFD60A'; breatheSpeed = 1.0; breatheAmp = 0.03; size = 1.04; break;
        case 'correcting': colorHex = '#AF52DE'; breatheSpeed = 0.6; breatheAmp = 0.02; size = 0.95; break;
        case 'listening': colorHex = '#5AC8FA'; breatheSpeed = 0.8; breatheAmp = 0.03; size = 1; break;
        default:          colorHex = '#007AFF'; breatheSpeed = 0.7; breatheAmp = 0.025; size = 1;
      }

      // === 颜色过渡 ===
      const target = this._hexToRgb(colorHex);
      this._curColor = this._lerpColor(this._curColor, target, 0.05);
      const c = this._curColor;

      // === 能量 ===
      this._currentEnergy += (this._liveEnergy - this._currentEnergy) * 0.15;
      const energy = this._currentEnergy || 0;

      // === 呼吸中心球 ===
      const breathe = 1 + Math.sin(t * breatheSpeed * Math.PI) * breatheAmp;
      const bounceY = state === 'happy' ? Math.sin(t * 2 * Math.PI) * 8 : 0;
      let finalScale;
      if (energy > 0.05) {
        finalScale = size * (1 + energy * 0.1);
      } else if (energy > 0.01) {
        const mix = (energy - 0.01) / 0.04;
        finalScale = size * (breathe * (1 - mix) + (1 + energy * 0.1) * mix);
      } else {
        finalScale = size * breathe;
      }

      ctx.save();
      ctx.translate(cx, cy + bounceY);
      ctx.scale(finalScale, finalScale);

      // === 光环（3层，相位错开，从内向外扩散） ===
      const ringSpeed = breatheSpeed * (1 + energy * 0.8);
      const ringCount = 3;
      for (let i = 0; i < ringCount; i++) {
        const phase = i * 0.33;
        // 环半径随时间循环：从 30 → 60 → 30
        const raw = Math.sin(t * ringSpeed * Math.PI + phase * Math.PI * 2);
        const ringR = 30 + (raw + 1) * 0.5 * 30;
        // 环透明度：中间最亮，两端渐隐
        const ringAlpha = Math.sin(raw * Math.PI) * 0.25;
        if (ringAlpha > 0.01) {
          ctx.strokeStyle = this._rgba(c, ringAlpha);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // === 中心光晕 ===
      const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 45);
      glow.addColorStop(0, this._rgba(c, 0.2));
      glow.addColorStop(1, this._rgba(c, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 45, 0, Math.PI * 2);
      ctx.fill();

      // === 中心球体 ===
      const grad = ctx.createLinearGradient(0, -28, 0, 28);
      grad.addColorStop(0, this._rgba(c, 0.95));
      grad.addColorStop(0.5, this._rgba(c, 0.7));
      grad.addColorStop(1, this._rgba(c, 0.5));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      ctx.fill();

      // === 高光 ===
      const hl = ctx.createRadialGradient(-10, -12, 2, -10, -12, 14);
      hl.addColorStop(0, 'rgba(255,255,255,0.5)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(-10, -12, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // === 星星（happy） ===
      if (state === 'happy') {
        ctx.fillStyle = '#FFD700';
        const starPos = [[-52, -48], [54, -42], [-38, 42], [48, 46]];
        for (const [sx, sy] of starPos) {
          const s = 3 + Math.sin(t * 2 + sx) * 1.5;
          ctx.font = `${s * 3}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('✦', cx + sx, cy + sy);
        }
      }

      // === thinking 气泡 ===
      if (state === 'thinking') {
        ctx.fillStyle = '#C7C7CC';
        const bubbles = [[-36, -52, 6], [-24, -64, 9], [-8, -76, 12]];
        for (const [bx, by, br] of bubbles) {
          ctx.beginPath();
          ctx.arc(cx + bx, cy + by, br, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      this._frame++;
      this._timer = this.canvas.requestAnimationFrame(() => this._draw());
    },
  },
});