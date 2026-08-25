/**
 * Liquid Glass Effect — SVG Filter Based Implementation
 * Enhanced for the justEMT site. Base concept from @shuding/liquid-glass.
 *
 * 与 src/styles/global.css 的协作约定：
 *   - 作用于 .music-player / .music-room__now / .glass-dark（均已在 CSS 中设为独立合成层）
 *   - 通过 ResizeObserver 保证位移贴图快照与运行时尺寸一致
 *   - 尊重 prefers-reduced-motion（禁用位移与动画，仅保留静态玻璃材质）
 *   - 通过 WeakMap 去重，避免 View Transition 中 persist 元素被重复叠加滤镜
 *
 * 相比早期版本的可见度提升：
 *  1) 鼠标真正参与 shader —— 指针在玻璃面板上移动时，光标周围会形成跟手的“透镜气泡”，
 *     折射非常明显；
 *  2) 面板静止时也有持续低幅“流动”（波纹），玻璃面会像水一样轻微呼吸，不再停在边缘；
 *  3) 圆角边缘做“向内收拢”的包边折射，使边框立体地凹进去，最有玻璃质感；
 *  4) 通过归一化位移通道 + 动态 scale，保证不同尺寸/ DPR 下可见度稳定；
 *  5) 位移贴图在 CPU 端采样并限定上限（约 128px），GPU 逐帧重绘依然顺滑。
 */
(function () {
  'use strict';

  function smoothStep(a, b, x) {
    x = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  function length(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function roundedRectSDF(x, y, width, height, radius) {
    const qx = Math.abs(x) - width + radius;
    const qy = Math.abs(y) - height + radius;
    return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius;
  }

  function generateId() {
    return 'liquid-glass-' + Math.random().toString(36).substr(2, 9);
  }

  const prefersReducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class LiquidGlassFilter {
    constructor(element, options = {}) {
      this.element = element;
      this.id = generateId();

      // 贴图分辨率上限（CPU 端采样），SVG 放大显示，兼顾顺滑与性能
      this.maxRes = options.maxRes || 132;

      // 各折射分量的权重：可单独微调
      this.rim = options.rim ?? 0.6;      // 边缘向内包边
      this.bubble = options.bubble ?? 0.7; // 鼠标跟随透镜
      this.flow = options.flow ?? 0.35;   // 静止时的低幅流动

      this.mouse = { x: 0.5, y: 0.5 };
      this.time = 0;
      this._raf = 0;
      this._last = 0;
      this._ro = null;
      this._running = !prefersReducedMotion();

      this._init();
    }

    _init() {
      const rect = this.element.getBoundingClientRect();
      this.width = Math.max(2, Math.ceil(rect.width || this.element.clientWidth));
      this.height = Math.max(2, Math.ceil(rect.height || this.element.clientHeight));

      // ---- SVG 滤镜声明 ----
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      this.svg.setAttribute('width', '0');
      this.svg.setAttribute('height', '0');
      this.svg.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:-1;';

      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', this.id);
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('colorInterpolationFilters', 'sRGB');

      this.feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
      this.feImage.setAttribute('preserveAspectRatio', 'none');

      this.feDisplacementMap = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
      this.feDisplacementMap.setAttribute('in', 'SourceGraphic');
      this.feDisplacementMap.setAttribute('in2', this.id + '_map');
      this.feDisplacementMap.setAttribute('xChannelSelector', 'R');
      this.feDisplacementMap.setAttribute('yChannelSelector', 'G');

      filter.appendChild(this.feImage);
      filter.appendChild(this.feDisplacementMap);
      defs.appendChild(filter);
      this.svg.appendChild(defs);
      document.body.appendChild(this.svg);

      // ---- 画布 ----
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this._resizeCanvas();

      // 叠加滤镜，保留元素原有 filter（若有）
      const cur = this.element.style.filter || '';
      this.element.style.filter = (cur + ' url(#' + this.id + ')').trim();

      // ---- 事件 ----
      this.element.addEventListener('mousemove', this._onMove);
      this.element.addEventListener('mouseenter', this._onEnter);
      this.element.addEventListener('mouseleave', this._onLeave);
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this._onResize());
        this._ro.observe(this.element);
      }

      this._render();
      if (this._running) {
        document.addEventListener('visibilitychange', this._onVisibility);
        this._loop();
      }
    }

    _resizeCanvas() {
      const scale = Math.min(1, this.maxRes / Math.max(this.width, this.height));
      this.vw = Math.max(2, Math.round(this.width * scale));
      this.vh = Math.max(2, Math.round(this.height * scale));
      this.canvas.width = this.vw;
      this.canvas.height = this.vh;
    }

    _onMove = (e) => {
      const r = this.element.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
    };
    _onEnter = () => { this._hovering = true; };
    _onLeave = () => { this._hovering = false; this.mouse.x = 0.5; this.mouse.y = 0.5; };

    _onResize() {
      const r = this.element.getBoundingClientRect();
      if (Math.ceil(r.width) === this.width && Math.ceil(r.height) === this.height) return;
      this.width = Math.max(2, Math.ceil(r.width));
      this.height = Math.max(2, Math.ceil(r.height));
      this._resizeCanvas();
    }

    _onVisibility = () => {
      if (document.hidden) this._stop();
      else if (this._running) { this._last = 0; this._loop(); }
    };

    _loop() {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame((t) => {
        // ~24fps 限制：足够柔滑，也不烧 CPU
        if (t - this._last >= 40) {
          this._last = t;
          this.time += 0.016;
          this._render();
        }
        if (this._running) this._loop();
      });
    }

    _stop() {
      cancelAnimationFrame(this._raf);
    }

    /** 生成位移通道贴图：RG 通道编码归一化位移向量，蓝=0 */
    _render() {
      if (!this.ctx) return;
      const w = this.vw;
      const h = this.vh;
      const t = this.time;

      // 每个样本的位移向量（相对 uv 空间，[-1,1] 量纲）
      const dxArr = new Float32Array(w * h);
      const dyArr = new Float32Array(w * h);
      let max = 0;

      for (let j = 0; j < h; j++) {
        const y = j / h;
        const v = y - 0.5;
        for (let i = 0; i < w; i++) {
          const x = i / w;
          const u = x - 0.5;
          const k = j * w + i;

          // —— 圆角边缘向内收拢（包边折射）—— 中心 0，越靠边越大
          const sdf = roundedRectSDF(u, v, 0.45, 0.45, 0.1);
          const edge = smoothStep(0.06, -0.2, sdf);

          // —— 鼠标透镜（气泡）—— 靠近指针越明显
          const mdx = x - this.mouse.x;
          const mdy = y - this.mouse.y;
          const dl = length(mdx, mdy);
          const pole = smoothStep(0.4, 0.05, dl);

          // —— 持续流动（静止时的液态呼吸）——
          const f1 = 0.0065 * (Math.sin(x * 24 + t * 1.5) + Math.sin(y * 18 - t * 0.9));
          const f2 = 0.0065 * (Math.cos(y * 22 + t * 1.2) + Math.sin(x * 16 + t * 0.7));

          // 组合位移（uv 单位，最外沿往里收、向指针方向的凹口）
          const dx = u * edge * this.rim * -1.0 + mdx * pole * this.bubble * +1.0 + f1 * this.flow;
          const dy = v * edge * this.rim * -1.0 + mdy * pole * this.bubble * +1.0 + f2 * this.flow;

          // clamp 到 [-1,1]，随后归一化
          dxArr[k] = Math.max(-1, Math.min(1, dx));
          dyArr[k] = Math.max(-1, Math.min(1, dy));
          const a = Math.abs(dxArr[k]);
          const b = Math.abs(dyArr[k]);
          if (a > max) max = a;
          if (b > max) max = b;
        }
      }

      max = Math.max(max, 1e-4);
      const inv = 1 / max;

      const data = new Uint8ClampedArray(w * h * 4);
      for (let k = 0, p = 0; k < w * h; k++, p += 4) {
        data[p]     = Math.round((dxArr[k] * inv + 1) * 0.5 * 255);
        data[p + 1] = Math.round((dyArr[k] * inv + 1) * 0.5 * 255);
        data[p + 2] = 0;
        data[p + 3] = 255;
      }

      // feDisplacementMap 的“scale”对应像素级最大位移。通道被归一化后
      // 最大即 0.5 单位对应 scale，因此这里让 scale 与 max 挂钩并夹到安全区间。
      const scale = Math.max(4, Math.min(22, max * Math.min(this.width, this.height) * 0.12));
      this.feDisplacementMap.setAttribute('scale', String(scale.toFixed(1)));

      this.ctx.putImageData(new ImageData(data, w, h), 0, 0);
      this.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', this.canvas.toDataURL());
    }

    destroy() {
      this._stop();
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      this.element.removeEventListener('mousemove', this._onMove);
      this.element.removeEventListener('mouseenter', this._onEnter);
      this.element.removeEventListener('mouseleave', this._onLeave);
      this.svg?.remove();
      this.canvas?.remove();
      this.element.style.filter = (this.element.style.filter || '')
        .replace(new RegExp('url\\(' + this.id + '\\)'), '')
        .trim();
    }
  }

  const instances = new WeakMap();

  function applyLiquidGlass() {
    ['.music-player', '.music-room__now', '.glass-dark'].forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (instances.has(el)) return;
        instances.set(el, new LiquidGlassFilter(el));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLiquidGlass);
  } else {
    applyLiquidGlass();
  }
  document.addEventListener('astro:page-load', applyLiquidGlass);
})();