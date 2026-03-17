class WaveformPlayer {
  constructor(container, audioUrl, fileName, options) {
    this.container = container;
    this.audioUrl = audioUrl;
    this.fileName = fileName;
    this.options = options || {};
    this.audioCtx = null;
    this.audioBuffer = null;
    this.audio = null;
    this.canvas = null;
    this.ctx = null;
    this.animFrame = null;
    this.bars = 150;
    this.waveformData = null;
    this.dragging = false;

    // Trim state (0.0 to 1.0 normalized positions)
    this.trimStart = 0;
    this.trimEnd = 1;
    this.trimDragging = null; // 'start', 'end', or null
    this.trimChanged = false;

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
        <div class="wf-canvas-wrap">
          <canvas class="wf-canvas"></canvas>
          <div class="wf-trim-handle wf-trim-start" title="Drag to set start"></div>
          <div class="wf-trim-handle wf-trim-end" title="Drag to set end"></div>
        </div>
        <div class="wf-controls">
          <button class="wf-playpause">\u25B6</button>
          <div class="wf-time">
            <span class="wf-current">0:00</span>
            <span class="wf-separator">/</span>
            <span class="wf-duration">0:00</span>
          </div>
          <button class="wf-trim-btn" style="display:none;">Trim</button>
        </div>
        <audio class="wf-audio" preload="auto"></audio>
      </div>
    `;

    this.canvas = this.container.querySelector('.wf-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = this.container.querySelector('.wf-audio');
    this.trimStartHandle = this.container.querySelector('.wf-trim-start');
    this.trimEndHandle = this.container.querySelector('.wf-trim-end');
    this.trimBtn = this.container.querySelector('.wf-trim-btn');

    this.container.querySelector('.wf-close').onclick = () => this.destroy();
    this.container.querySelector('.wf-playpause').onclick = () => this.togglePlay();
    this.trimBtn.onclick = () => this.onTrimClick();

    this.audio.ontimeupdate = () => this.updateTime();
    this.audio.onended = () => this.onEnded();

    // Canvas click-to-seek (constrained to trim region)
    const canvasSeek = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = (clientX - rect.left) / rect.width;
      if (this.audio.duration) {
        const seekPos = Math.max(this.trimStart, Math.min(this.trimEnd, x));
        this.audio.currentTime = seekPos * this.audio.duration;
        this.drawWaveform();
      }
    };

    // Trim handle dragging
    const wrapEl = this.container.querySelector('.wf-canvas-wrap');

    const getTrimPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const onPointerDown = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = (clientX - rect.left) / rect.width;

      // Check if near a trim handle (within 3% of canvas width)
      const threshold = 0.03;
      if (Math.abs(x - this.trimStart) < threshold) {
        this.trimDragging = 'start';
        e.preventDefault();
        return;
      }
      if (Math.abs(x - this.trimEnd) < threshold) {
        this.trimDragging = 'end';
        e.preventDefault();
        return;
      }

      // Otherwise seek
      this.dragging = true;
      canvasSeek(e);
    };

    const onPointerMove = (e) => {
      if (this.trimDragging) {
        e.preventDefault();
        const pos = getTrimPos(e);
        if (this.trimDragging === 'start') {
          this.trimStart = Math.min(pos, this.trimEnd - 0.02);
        } else {
          this.trimEnd = Math.max(pos, this.trimStart + 0.02);
        }
        this.trimChanged = (this.trimStart > 0.005 || this.trimEnd < 0.995);
        this.updateTrimUI();
        this.drawWaveform();
      } else if (this.dragging) {
        canvasSeek(e);
      }
    };

    const onPointerUp = () => {
      this.trimDragging = null;
      this.dragging = false;
    };

    wrapEl.onmousedown = onPointerDown;
    window.addEventListener('mousemove', this._moveHandler = onPointerMove);
    window.addEventListener('mouseup', this._upHandler = onPointerUp);

    wrapEl.ontouchstart = (e) => { onPointerDown(e); };
    wrapEl.ontouchmove = (e) => { onPointerMove(e); };
    wrapEl.ontouchend = onPointerUp;

    this.resizeCanvas();
    window.addEventListener('resize', this._resizeHandler = () => this.resizeCanvas());
    this.updateTrimHandlePositions();
  }

  updateTrimUI() {
    this.trimBtn.style.display = this.trimChanged ? 'inline-block' : 'none';
    this.updateTrimHandlePositions();

    // Update time display to show trim region duration
    if (this.audio.duration) {
      const startTime = this.trimStart * this.audio.duration;
      const endTime = this.trimEnd * this.audio.duration;
      this.container.querySelector('.wf-current').textContent = this.formatTime(startTime);
      this.container.querySelector('.wf-duration').textContent = this.formatTime(endTime);
    }
  }

  updateTrimHandlePositions() {
    if (!this.trimStartHandle || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const wrapRect = this.container.querySelector('.wf-canvas-wrap').getBoundingClientRect();
    const offsetLeft = rect.left - wrapRect.left;

    this.trimStartHandle.style.left = (offsetLeft + this.trimStart * rect.width) + 'px';
    this.trimEndHandle.style.left = (offsetLeft + this.trimEnd * rect.width) + 'px';
  }

  onTrimClick() {
    if (!this.audio.duration || !this.trimChanged) return;

    const startTime = (this.trimStart * this.audio.duration).toFixed(3);
    const endTime = (this.trimEnd * this.audio.duration).toFixed(3);
    const trimDuration = (endTime - startTime).toFixed(1);

    if (!confirm(`Trim to ${trimDuration}s (${this.formatTime(startTime)} - ${this.formatTime(endTime)})? This will modify the file.`)) {
      return;
    }

    // Dispatch trim event for soundboard to handle
    this.container.dispatchEvent(new CustomEvent('waveform-trim', {
      detail: { start: startTime, end: endTime }
    }));
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = 1; // Keep at 1 for Pi performance
    this.canvas.width = rect.width * dpr;
    this.canvas.height = 80 * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = '80px';
    if (this.waveformData) this.drawWaveform();
    this.updateTrimHandlePositions();
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

      const barPos = (i + 0.5) / this.bars;
      const inTrimRegion = barPos >= this.trimStart && barPos <= this.trimEnd;

      if (!inTrimRegion) {
        // Dimmed bars outside trim region
        this.ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
      } else if (barPos <= progress) {
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
      // Start from trim start if before it
      if (this.audio.currentTime < this.trimStart * this.audio.duration) {
        this.audio.currentTime = this.trimStart * this.audio.duration;
      }
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
      // Stop at trim end
      if (this.audio.duration && this.audio.currentTime >= this.trimEnd * this.audio.duration) {
        this.audio.pause();
        this.audio.currentTime = this.trimEnd * this.audio.duration;
        this.container.querySelector('.wf-playpause').textContent = '\u25B6';
        this.stopAnimation();
        return;
      }
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
    if (!this.trimChanged) {
      this.container.querySelector('.wf-current').textContent =
        this.formatTime(this.audio.currentTime);
      if (this.audio.duration && !isNaN(this.audio.duration)) {
        this.container.querySelector('.wf-duration').textContent =
          this.formatTime(this.audio.duration);
      }
    }
  }

  onEnded() {
    this.container.querySelector('.wf-playpause').textContent = '\u25B6';
    this.stopAnimation();
    this.audio.currentTime = this.trimStart * (this.audio.duration || 0);
    this.drawWaveform();
  }

  formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    secs = parseFloat(secs);
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
    if (this._moveHandler) {
      window.removeEventListener('mousemove', this._moveHandler);
    }
    if (this._upHandler) {
      window.removeEventListener('mouseup', this._upHandler);
    }
    this.container.innerHTML = '';
    // Dispatch event so parent can clean up
    this.container.dispatchEvent(new Event('waveform-closed'));
  }
}
