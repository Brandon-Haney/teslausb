class WaveformPlayer {
  constructor(container, audioUrl, fileName) {
    this.container = container;
    this.audioUrl = audioUrl;
    this.fileName = fileName;
    this.audioCtx = null;
    this.audioBuffer = null;
    this.audio = null;
    this.canvas = null;
    this.ctx = null;
    this.animFrame = null;
    this.bars = 150;
    this.waveformData = null;
    this.dragging = false;

    this.render();
    this.loadAudio();
  }

  render() {
    this.container.innerHTML = `
      <div class="wf-player">
        <div class="wf-header">
          <div class="wf-title">${this.escapeHtml(this.fileName)}</div>
          <button class="wf-close">\u2715</button>
        </div>
        <canvas class="wf-canvas"></canvas>
        <div class="wf-controls">
          <button class="wf-playpause">\u25B6</button>
          <div class="wf-time">
            <span class="wf-current">0:00</span>
            <span class="wf-separator">/</span>
            <span class="wf-duration">0:00</span>
          </div>
        </div>
        <audio class="wf-audio" preload="auto"></audio>
      </div>
    `;

    this.canvas = this.container.querySelector('.wf-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = this.container.querySelector('.wf-audio');

    this.container.querySelector('.wf-close').onclick = () => this.destroy();
    this.container.querySelector('.wf-playpause').onclick = () => this.togglePlay();

    this.audio.ontimeupdate = () => this.updateTime();
    this.audio.onended = () => this.onEnded();

    // Canvas click-to-seek
    const canvasEvents = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = (clientX - rect.left) / rect.width;
      if (this.audio.duration) {
        this.audio.currentTime = x * this.audio.duration;
        this.drawWaveform();
      }
    };

    this.canvas.onmousedown = (e) => { this.dragging = true; canvasEvents(e); };
    this.canvas.onmousemove = (e) => { if (this.dragging) canvasEvents(e); };
    this.canvas.onmouseup = () => { this.dragging = false; };
    this.canvas.onmouseleave = () => { this.dragging = false; };

    this.canvas.ontouchstart = (e) => { this.dragging = true; canvasEvents(e); e.preventDefault(); };
    this.canvas.ontouchmove = (e) => { if (this.dragging) canvasEvents(e); e.preventDefault(); };
    this.canvas.ontouchend = () => { this.dragging = false; };

    this.resizeCanvas();
    window.addEventListener('resize', this._resizeHandler = () => this.resizeCanvas());
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = 1; // Keep at 1 for Pi performance
    this.canvas.width = rect.width * dpr;
    this.canvas.height = 80 * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = '80px';
    if (this.waveformData) this.drawWaveform();
  }

  loadAudio() {
    this.audio.src = this.audioUrl;

    // Try Web Audio API for waveform extraction
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const request = new XMLHttpRequest();
      request.open('GET', this.audioUrl, true);
      request.responseType = 'arraybuffer';

      request.onload = () => {
        this.audioCtx.decodeAudioData(request.response, (buffer) => {
          this.audioBuffer = buffer;
          this.extractWaveform(buffer);
          this.container.querySelector('.wf-duration').textContent =
            this.formatTime(buffer.duration);
        }, () => {
          this.drawFallbackWaveform();
        });
      };

      request.onerror = () => this.drawFallbackWaveform();
      request.send();
    } catch (e) {
      this.drawFallbackWaveform();
    }
  }

  extractWaveform(buffer) {
    const channelData = buffer.getChannelData(0);
    const samples = channelData.length;
    const blockSize = Math.floor(samples / this.bars);
    this.waveformData = new Float32Array(this.bars);

    for (let i = 0; i < this.bars; i++) {
      let sum = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[start + j]);
      }
      this.waveformData[i] = sum / blockSize;
    }

    // Normalize
    const max = Math.max(...this.waveformData) || 1;
    for (let i = 0; i < this.bars; i++) {
      this.waveformData[i] /= max;
    }

    this.drawWaveform();
  }

  drawFallbackWaveform() {
    // Generate a placeholder waveform
    this.waveformData = new Float32Array(this.bars);
    for (let i = 0; i < this.bars; i++) {
      this.waveformData[i] = 0.15 + Math.random() * 0.2;
    }
    this.drawWaveform();
  }

  drawWaveform() {
    if (!this.waveformData || !this.ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const barWidth = Math.max(1, (w / this.bars) - 1);
    const gap = 1;
    const progress = this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;

    this.ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < this.bars; i++) {
      const x = i * (barWidth + gap);
      const barHeight = Math.max(2, this.waveformData[i] * h * 0.85);
      const y = (h - barHeight) / 2;

      const barProgress = (i + 0.5) / this.bars;
      if (barProgress <= progress) {
        this.ctx.fillStyle = '#1a73e8';
      } else {
        this.ctx.fillStyle = '#ccc';
      }

      this.ctx.beginPath();
      const radius = Math.min(barWidth / 2, 2);
      this.roundRect(this.ctx, x, y, barWidth, barHeight, radius);
      this.ctx.fill();
    }
  }

  roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  togglePlay() {
    const btn = this.container.querySelector('.wf-playpause');
    if (this.audio.paused) {
      this.audio.play();
      btn.textContent = '\u23F8';
      this.startAnimation();
    } else {
      this.audio.pause();
      btn.textContent = '\u25B6';
      this.stopAnimation();
    }
  }

  startAnimation() {
    const animate = () => {
      this.drawWaveform();
      this.animFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  stopAnimation() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.drawWaveform();
  }

  updateTime() {
    this.container.querySelector('.wf-current').textContent =
      this.formatTime(this.audio.currentTime);
    if (this.audio.duration && !isNaN(this.audio.duration)) {
      this.container.querySelector('.wf-duration').textContent =
        this.formatTime(this.audio.duration);
    }
  }

  onEnded() {
    this.container.querySelector('.wf-playpause').textContent = '\u25B6';
    this.stopAnimation();
    this.audio.currentTime = 0;
    this.drawWaveform();
  }

  formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  destroy() {
    this.stopAnimation();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    this.container.innerHTML = '';
    // Dispatch event so parent can clean up
    this.container.dispatchEvent(new Event('waveform-closed'));
  }
}
