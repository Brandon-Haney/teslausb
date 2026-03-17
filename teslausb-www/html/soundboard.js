class Soundboard {
  constructor(anchor, rootPath) {
    this.anchor = anchor;
    this.rootPath = rootPath || 'fs/Boombox';
    this.sounds = [];
    this.activeCategory = 'all';
    this.lockchimeMd5 = '';
    this.currentPlayingCard = null;
    this.waveformOverlay = null;
    this.waveformPlayer = null;
    this.selectMode = false;
    this.selectedSounds = new Set();
    this.hasFFmpeg = false;
    this.draggedSound = null;

    this.render();
    this.checkFFmpeg();
    this.loadShuffleState();
    this.loadSounds();
  }

  render() {
    this.anchor.innerHTML = `
      <div class="sb-container">
        <div class="sb-slots-row">
          <div class="sb-slot" id="sb-lockchime-slot" data-slot="lockchime">
            <div class="sb-slot-icon">\u{1F50A}</div>
            <div class="sb-slot-info">
              <div class="sb-slot-label">Lock Chime</div>
              <div class="sb-slot-name">Drop sound here</div>
              <div class="sb-slot-size"></div>
            </div>
          </div>
          <label class="sb-shuffle-toggle" title="Randomly pick a lock chime from sounds tagged 'Lock Chime' each drive session">
            <input type="checkbox" id="sb-shuffle-check">
            <span class="sb-shuffle-slider"></span>
            <span class="sb-shuffle-label">Shuffle</span>
          </label>
        </div>
        <div class="sb-toolbar" id="sb-toolbar">
          <div class="sb-toolbar-left">
            <button class="sb-toolbar-btn" id="sb-select-btn">Select</button>
            <button class="sb-toolbar-btn" id="sb-upload-btn">Upload</button>
            <input type="file" id="sb-file-input" multiple accept=".wav,.mp3,.m4a,.flac,.ogg" style="display:none;">
          </div>
          <div class="sb-toolbar-right">
            <button class="sb-toolbar-btn" id="sb-import-btn">Import Pack</button>
            <button class="sb-toolbar-btn sb-toolbar-export" id="sb-export-btn" style="display:none;">Export Selected</button>
            <button class="sb-toolbar-btn sb-toolbar-delete" id="sb-delete-selected-btn" style="display:none;">Delete</button>
          </div>
          <input type="file" id="sb-pack-input" accept=".zip" style="display:none;">
        </div>
        <div class="sb-categories" id="sb-categories"></div>
        <div class="sb-grid" id="sb-grid"></div>
        <div class="sb-upload-progress" id="sb-upload-progress">
          <div class="sb-upload-progress-bar">
            <div class="sb-upload-progress-fill" id="sb-upload-fill"></div>
          </div>
          <div class="sb-upload-progress-text" id="sb-upload-text"></div>
        </div>
        <div class="sb-waveform-host" id="sb-waveform-host"></div>
        <div class="sb-toast" id="sb-toast">
          <div class="sb-toast-spinner" id="sb-toast-spinner"></div>
          <span id="sb-toast-msg"></span>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const uploadBtn = this.anchor.querySelector('#sb-upload-btn');
    const fileInput = this.anchor.querySelector('#sb-file-input');

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => this.handleUpload(e.target.files);

    // Sound pack controls
    this.anchor.querySelector('#sb-select-btn').onclick = () => this.toggleSelectMode();
    this.anchor.querySelector('#sb-import-btn').onclick = () => this.anchor.querySelector('#sb-pack-input').click();
    this.anchor.querySelector('#sb-pack-input').onchange = (e) => this.importPack(e.target.files[0]);
    this.anchor.querySelector('#sb-export-btn').onclick = () => this.exportSelected();
    this.anchor.querySelector('#sb-delete-selected-btn').onclick = () => this.deleteSelected();

    // Drag-and-drop on slots (internal cards + external files)
    this.anchor.querySelectorAll('.sb-slot').forEach(slot => {
      slot.ondragover = (e) => { e.preventDefault(); slot.classList.add('sb-slot-droptarget'); };
      slot.ondragleave = () => { slot.classList.remove('sb-slot-droptarget'); };
      slot.ondrop = (e) => {
        e.preventDefault();
        slot.classList.remove('sb-slot-droptarget');
        if (this.draggedSound) {
          this.assignToSlot(this.draggedSound, slot.dataset.slot);
          this.draggedSound = null;
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.handleSlotFileDrop(e.dataTransfer.files[0]);
        }
      };
    });

    // Drag-and-drop on grid area for file uploads
    const grid = this.anchor.querySelector('#sb-grid');
    grid.ondragover = (e) => { e.preventDefault(); grid.classList.add('sb-grid-droptarget'); };
    grid.ondragleave = (e) => {
      if (!grid.contains(e.relatedTarget)) grid.classList.remove('sb-grid-droptarget');
    };
    grid.ondrop = (e) => {
      e.preventDefault();
      grid.classList.remove('sb-grid-droptarget');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleUpload(e.dataTransfer.files);
      }
    };
  }

  showToast(msg, spinning) {
    const toast = this.anchor.querySelector('#sb-toast');
    const spinner = this.anchor.querySelector('#sb-toast-spinner');
    const msgEl = this.anchor.querySelector('#sb-toast-msg');
    msgEl.textContent = msg;
    spinner.style.display = spinning ? 'block' : 'none';
    toast.classList.add('visible');
    // Clear any pending auto-hide
    if (this._toastTimer) clearTimeout(this._toastTimer);
  }

  hideToast(delay) {
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.anchor.querySelector('#sb-toast').classList.remove('visible');
    }, delay || 0);
  }

  toastDone(msg) {
    const spinner = this.anchor.querySelector('#sb-toast-spinner');
    const msgEl = this.anchor.querySelector('#sb-toast-msg');
    spinner.style.display = 'none';
    msgEl.textContent = msg || 'Done';
    this.hideToast(1500);
  }

  flushGadget(callback) {
    this.readfile({
      url: 'cgi-bin/flush-gadget.sh?/backingfiles/boombox_disk.bin',
      callback: (response) => {
        if (callback) callback();
      }
    });
  }

  checkFFmpeg() {
    this.readfile({
      url: 'cgi-bin/check-ffmpeg.sh',
      callback: (response) => {
        try {
          const data = JSON.parse(response);
          this.hasFFmpeg = data.available === true;
        } catch (e) {
          this.hasFFmpeg = false;
        }
      }
    });
  }

  loadShuffleState() {
    const checkbox = this.anchor.querySelector('#sb-shuffle-check');
    this.readfile({
      url: 'cgi-bin/shuffle-config.sh',
      callback: (response) => {
        try {
          const data = JSON.parse(response);
          checkbox.checked = data.enabled === true;
        } catch (e) {
          checkbox.checked = false;
        }
      }
    });
    checkbox.onchange = () => this.toggleShuffle(checkbox.checked);
  }

  toggleShuffle(enabled) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'cgi-bin/shuffle-config.sh');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
      this.showToast(enabled ? 'Shuffle enabled' : 'Shuffle disabled');
      this.hideToast(1500);
    };
    xhr.send(JSON.stringify({ enabled: enabled }));
  }

  assignToSlot(sound, slotType) {
    if (slotType === 'lockchime') {
      if (sound.ext === 'wav' && sound.size <= 1048576) {
        this.setLockChime(sound);
      } else if (this.hasFFmpeg) {
        // Handles both non-WAV files and WAV files over 1MB
        this.convertAndAssign(sound);
      } else {
        alert('Lock chime must be a .wav file under 1MB. Install ffmpeg for auto-conversion.');
      }
    }
  }

  convertAndAssign(sound) {
    const progressContainer = this.anchor.querySelector('#sb-upload-progress');
    const progressFill = this.anchor.querySelector('#sb-upload-fill');
    const progressText = this.anchor.querySelector('#sb-upload-text');

    progressContainer.classList.add('active');
    progressText.textContent = sound.ext === 'wav'
      ? `Compressing ${sound.name} for lock chime...`
      : `Converting ${sound.name} to WAV...`;
    progressFill.style.width = '50%';

    const sourcePath = encodeURIComponent('Boombox/' + sound.path);
    this.readfile({
      url: `cgi-bin/convert.sh?${this.rootPath}&${sourcePath}`,
      callback: (response) => {
        progressFill.style.width = '100%';
        try {
          const result = JSON.parse(response);
          if (result.status === 'ok') {
            progressText.textContent = `Converted! Setting as lock chime...`;
            // Now copy the converted file as LockChime.wav
            const convertedPath = encodeURIComponent('Boombox/' + (sound.dir ? sound.dir + '/' : '') + result.output);
            this.readfile({
              url: `cgi-bin/cp.sh?${this.rootPath}&${convertedPath}&Boombox/LockChime.wav`,
              callback: (cpResponse) => {
                progressText.textContent = 'Syncing to car...';
                this.flushGadget(() => {
                  setTimeout(() => {
                    progressContainer.classList.remove('active');
                    this.loadSounds();
                  }, 500);
                });
              }
            });
          } else {
            progressText.textContent = result.message || 'Conversion failed';
            setTimeout(() => progressContainer.classList.remove('active'), 2000);
          }
        } catch (e) {
          progressText.textContent = 'Conversion failed';
          setTimeout(() => progressContainer.classList.remove('active'), 2000);
        }
      }
    });
  }

  readfile({url, callback}) {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    request.onreadystatechange = function() {
      if (request.readyState === XMLHttpRequest.DONE) {
        if (request.status === 200) {
          if (callback) callback(request.responseText);
        } else {
          if (callback) callback(null);
        }
      }
    };
    request.send();
  }

  loadSounds() {
    const grid = this.anchor.querySelector('#sb-grid');
    grid.innerHTML = '<div class="sb-loading">Loading sounds...</div>';

    this.readfile({
      url: `cgi-bin/soundinfo.sh?${this.rootPath}&_=${Date.now()}`,
      callback: (response) => {
        if (!response) {
          grid.innerHTML = '<div class="sb-empty"><div class="sb-empty-icon">\u26A0\uFE0F</div><div class="sb-empty-text">Could not load sounds</div></div>';
          return;
        }
        try {
          const data = JSON.parse(response);
          this.lockchimeMd5 = data.lockchime_md5 || '';
          this.sounds = data.sounds || [];
          this.persistAutoCategories();
          this.renderCategories();
          this.renderGrid();
          this.renderActiveSlot();
        } catch (e) {
          grid.innerHTML = '<div class="sb-empty"><div class="sb-empty-icon">\u26A0\uFE0F</div><div class="sb-empty-text">Error parsing sound data</div></div>';
        }
      }
    });
  }

  persistAutoCategories() {
    // Build list of sounds needing category saves
    const toSave = [];
    for (const sound of this.sounds) {
      if (sound.name.toLowerCase() === 'lockchime.wav') continue;
      if (sound.category && sound.category !== '') continue;
      const cat = this.categorize(sound);
      if (cat && cat !== 'active') {
        toSave.push({ sound, cat });
      }
    }
    if (toSave.length === 0) return;

    // Clean stale entries, then save categories one at a time to avoid races
    this.readfile({
      url: `cgi-bin/cleanmeta.sh?${this.rootPath}`,
      callback: () => {
        const saveNext = (i) => {
          if (i >= toSave.length) return;
          const { sound, cat } = toSave[i];
          const body = JSON.stringify({ path: sound.path, category: cat, favorite: sound.favorite || false });
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `cgi-bin/savemeta.sh?${this.rootPath}`);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onload = () => {
            sound.category = cat;
            saveNext(i + 1);
          };
          xhr.onerror = () => saveNext(i + 1);
          xhr.send(body);
        };
        saveNext(0);
      }
    });
  }

  categorize(sound) {
    const name = sound.name.toLowerCase();

    if (name === 'lockchime.wav') return 'active';

    // User-assigned category takes priority
    if (sound.category && sound.category !== '') return sound.category;

    // Auto-detect from directory name
    const dir = sound.dir.toLowerCase();
    if (dir.indexOf('lock') >= 0 || dir.indexOf('chime') >= 0) return 'lock';
    if (dir.indexOf('horn') >= 0) return 'horn';
    if (dir.indexOf('sentry') >= 0) return 'sentry';

    // WAV files under 1MB are lock-chime eligible
    if (sound.ext === 'wav' && sound.size <= 1048576) return 'lock';

    return 'fun';
  }

  getCategoryCounts() {
    const counts = { all: 0, lock: 0, horn: 0, sentry: 0, fun: 0 };
    for (const sound of this.sounds) {
      const cat = this.categorize(sound);
      if (cat === 'active') continue; // Don't count LockChime.wav itself
      counts.all++;
      if (counts[cat] !== undefined) counts[cat]++;
    }
    return counts;
  }

  renderCategories() {
    const container = this.anchor.querySelector('#sb-categories');
    const counts = this.getCategoryCounts();

    const categories = [
      { id: 'all', label: 'All Sounds' },
      { id: 'lock', label: 'Lock Chime' },
      { id: 'horn', label: 'Horn' },
      { id: 'sentry', label: 'Sentry' },
      { id: 'fun', label: 'Custom' }
    ];

    container.innerHTML = categories.map(cat =>
      `<button class="sb-catbtn${this.activeCategory === cat.id ? ' active' : ''}" data-category="${cat.id}">
        ${cat.label}<span class="sb-catcount">${counts[cat.id]}</span>
      </button>`
    ).join('');

    container.querySelectorAll('.sb-catbtn').forEach(btn => {
      btn.onclick = () => {
        this.activeCategory = btn.dataset.category;
        container.querySelectorAll('.sb-catbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderGrid();
      };
    });
  }

  renderActiveSlot() {
    const slot = this.anchor.querySelector('#sb-lockchime-slot');
    const lockChime = this.sounds.find(s => s.name.toLowerCase() === 'lockchime.wav');

    if (lockChime) {
      slot.classList.add('sb-slot-filled');

      // Find the source sound by matching md5
      let sourceName = 'LockChime.wav';
      if (this.lockchimeMd5) {
        const source = this.sounds.find(s =>
          s.md5 === this.lockchimeMd5 && s.name.toLowerCase() !== 'lockchime.wav'
        );
        if (source) sourceName = source.name;
      }

      slot.querySelector('.sb-slot-name').textContent = sourceName;
      slot.querySelector('.sb-slot-size').textContent = this.formatSize(lockChime.size);

      // Remove existing buttons if any
      const existingPlay = slot.querySelector('.sb-slot-play');
      if (existingPlay) existingPlay.remove();
      const existingClear = slot.querySelector('.sb-slot-clear');
      if (existingClear) existingClear.remove();

      const playBtn = document.createElement('button');
      playBtn.className = 'sb-slot-play';
      playBtn.textContent = '\u25B6';
      playBtn.onclick = (e) => {
        e.stopPropagation();
        this.playSound('Boombox/LockChime.wav', 'LockChime.wav', playBtn);
      };
      slot.appendChild(playBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'sb-slot-clear';
      clearBtn.textContent = '\u2715';
      clearBtn.title = 'Remove lock chime';
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        this.clearLockChime();
      };
      slot.appendChild(clearBtn);
    } else {
      slot.classList.remove('sb-slot-filled');
      slot.querySelector('.sb-slot-name').textContent = 'Drop sound here';
      slot.querySelector('.sb-slot-size').textContent = '';
      const existingPlay = slot.querySelector('.sb-slot-play');
      if (existingPlay) existingPlay.remove();
      const existingClear = slot.querySelector('.sb-slot-clear');
      if (existingClear) existingClear.remove();
    }
  }

  clearLockChime() {
    if (!confirm('Remove the active lock chime?')) return;
    this.showToast('Removing lock chime...', true);
    const encodedPath = encodeURIComponent('Boombox/LockChime.wav');
    this.readfile({
      url: `cgi-bin/rm.sh?${this.rootPath}&${encodedPath}`,
      callback: () => {
        this.showToast('Syncing to car...', true);
        this.flushGadget(() => {
          this.toastDone('Lock chime removed');
          this.loadSounds();
        });
      }
    });
  }

  renderGrid() {
    const grid = this.anchor.querySelector('#sb-grid');

    const filtered = this.sounds.filter(s => {
      const cat = this.categorize(s);
      if (cat === 'active') return false; // Hide LockChime.wav from grid
      if (this.activeCategory === 'all') return true;
      return cat === this.activeCategory;
    });

    // Pin favorites to the top
    filtered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="sb-empty" id="sb-empty-state">
          <div class="sb-empty-icon">\u{1F3B5}</div>
          <div class="sb-empty-text">No sounds yet</div>
          <div class="sb-empty-sub">Drop files here or tap to browse</div>
          <div class="sb-empty-sub">.wav, .mp3, .m4a, .flac, .ogg</div>
        </div>`;
      const emptyState = grid.querySelector('#sb-empty-state');
      emptyState.onclick = () => this.anchor.querySelector('#sb-file-input').click();
      return;
    }

    grid.innerHTML = '';
    for (const sound of filtered) {
      grid.appendChild(this.createCard(sound));
    }
  }

  createCard(sound) {
    const card = document.createElement('div');
    card.className = 'sb-card';

    // Check if this is the active lock chime
    const isActive = this.lockchimeMd5 && sound.md5 === this.lockchimeMd5 &&
                     sound.name.toLowerCase() !== 'lockchime.wav';
    if (isActive) card.classList.add('is-active-chime');
    if (sound.favorite) card.classList.add('sb-favorite');

    const isLockEligible = sound.name.toLowerCase() !== 'lockchime.wav' &&
                           ((sound.ext === 'wav' && sound.size <= 1048576) || this.hasFFmpeg);

    const isSelected = this.selectedSounds.has(sound.path);
    const currentCat = this.categorize(sound);
    const catLabels = { lock: 'Lock Chime', horn: 'Horn', sentry: 'Sentry', fun: 'Custom' };

    card.innerHTML = `
      ${this.selectMode ? `<div class="sb-card-checkbox ${isSelected ? 'checked' : ''}"></div>` : ''}
      <button class="sb-card-play">\u25B6</button>
      <div class="sb-card-info">
        <div class="sb-card-name">${this.escapeHtml(sound.name)}</div>
        <div class="sb-card-meta">
          <span class="sb-card-badge ${sound.ext}">${sound.ext}</span>
          ${this.formatSize(sound.size)}
          ${sound.dir ? ' \u2022 ' + this.escapeHtml(sound.dir) : ''}
        </div>
      </div>
      <div class="sb-card-actions">
        ${!this.selectMode ? `<button class="sb-card-star" title="Favorite">${sound.favorite ? '\u2605' : '\u2606'}</button>` : ''}
        ${!this.selectMode ? `<select class="sb-card-category" title="Assign category">
          ${Object.keys(catLabels).map(k =>
            `<option value="${k}"${currentCat === k ? ' selected' : ''}>${catLabels[k]}</option>`
          ).join('')}
        </select>` : ''}
        ${!this.selectMode && this.hasFFmpeg && sound.ext !== 'wav' ?
          `<button class="sb-card-convert" title="Convert to WAV">WAV</button>` : ''}
        ${isLockEligible && !this.selectMode ?
          `<button class="sb-card-assign">${isActive ? '\u2713 Active' : 'Set Lock'}</button>` :
          ''}
      </div>
    `;

    // Make card draggable for slot assignment
    if (!this.selectMode) {
      card.draggable = true;
      card.ondragstart = (e) => {
        this.draggedSound = sound;
        e.dataTransfer.effectAllowed = 'copy';
        card.classList.add('sb-dragging');
      };
      card.ondragend = () => {
        card.classList.remove('sb-dragging');
        this.draggedSound = null;
      };
    }

    // Click filename to rename
    const nameEl = card.querySelector('.sb-card-name');
    if (!this.selectMode) {
      nameEl.onclick = (e) => {
        e.stopPropagation();
        this.startRename(sound, nameEl);
      };
    }

    // Category select
    const catSelect = card.querySelector('.sb-card-category');
    if (catSelect) {
      catSelect.onclick = (e) => e.stopPropagation();
      catSelect.onchange = (e) => {
        e.stopPropagation();
        this.saveCategory(sound, catSelect.value);
      };
    }

    // Star/favorite button
    const starBtn = card.querySelector('.sb-card-star');
    if (starBtn) {
      starBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleFavorite(sound);
      };
    }

    // Convert button
    const convertBtn = card.querySelector('.sb-card-convert');
    if (convertBtn) {
      convertBtn.onclick = (e) => {
        e.stopPropagation();
        this.convertSound(sound);
      };
    }

    if (this.selectMode) {
      card.onclick = () => {
        if (this.selectedSounds.has(sound.path)) {
          this.selectedSounds.delete(sound.path);
        } else {
          this.selectedSounds.add(sound.path);
        }
        this.renderGrid();
        this.updateToolbar();
      };
      if (isSelected) card.classList.add('sb-selected');
    }

    // Play button
    const playBtn = card.querySelector('.sb-card-play');
    playBtn.onclick = (e) => {
      e.stopPropagation();
      this.playSound('Boombox/' + sound.path, sound.name, playBtn);
    };

    // Assign button
    const assignBtn = card.querySelector('.sb-card-assign');
    if (assignBtn && !isActive) {
      assignBtn.onclick = (e) => {
        e.stopPropagation();
        this.assignToSlot(sound, 'lockchime');
      };
    }

    return card;
  }

  playSound(path, name, triggerBtn) {
    // Close existing waveform player
    this.closeWaveform();

    // Update card button state
    if (this.currentPlayingCard) {
      this.currentPlayingCard.classList.remove('playing');
      this.currentPlayingCard.textContent = '\u25B6';
    }
    this.currentPlayingCard = triggerBtn;
    if (triggerBtn) {
      triggerBtn.classList.add('playing');
      triggerBtn.textContent = '\u23F8';
    }

    // Create waveform overlay
    const overlay = document.createElement('div');
    overlay.className = 'sb-waveform-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeWaveform(); };

    const playerContainer = document.createElement('div');
    overlay.appendChild(playerContainer);
    document.body.appendChild(overlay);
    this.waveformOverlay = overlay;

    const audioUrl = this.rootPath + '/' + encodeURIComponent(path) + '?t=' + Date.now();
    this.waveformPlayer = new WaveformPlayer(playerContainer, audioUrl, name);

    playerContainer.addEventListener('waveform-closed', () => this.closeWaveform());
    playerContainer.addEventListener('waveform-trim', (e) => {
      this.trimSound(path, e.detail.start, e.detail.end);
    });
  }

  trimSound(path, start, end) {
    this.closeWaveform();
    this.showToast('Trimming audio...', true);
    const encodedPath = encodeURIComponent(path);
    const url = `cgi-bin/trim.sh?${this.rootPath}&${encodedPath}&${start}&${end}`;
    this.readfile({
      url: url,
      callback: (response) => {
        try {
          const result = JSON.parse(response);
          if (result.status === 'ok') {
            this.showToast('Syncing to car...', true);
            this.flushGadget(() => {
              this.toastDone('Trimmed');
              this.loadSounds();
            });
          } else {
            this.toastDone(result.message || 'Trim failed');
          }
        } catch (e) {
          this.toastDone('Trim failed');
        }
      }
    });
  }

  closeWaveform() {
    const player = this.waveformPlayer;
    this.waveformPlayer = null;
    if (player) {
      player.destroy();
    }
    if (this.waveformOverlay) {
      this.waveformOverlay.remove();
      this.waveformOverlay = null;
    }
    if (this.currentPlayingCard) {
      this.currentPlayingCard.classList.remove('playing');
      this.currentPlayingCard.textContent = '\u25B6';
    }
    this.currentPlayingCard = null;
  }

  setLockChime(sound) {
    this.showToast('Setting lock chime...', true);
    const encodedPath = encodeURIComponent('Boombox/' + sound.path);
    this.readfile({
      url: `cgi-bin/cp.sh?${this.rootPath}&${encodedPath}&Boombox/LockChime.wav`,
      callback: (response) => {
        if (response && response.trim() === 'OK') {
          this.showToast('Syncing to car...', true);
          this.flushGadget(() => {
            this.toastDone('Lock chime set');
            this.loadSounds();
          });
        } else {
          this.toastDone('Failed to set lock chime');
          alert('Failed to set lock chime. Please try again.');
        }
      }
    });
  }

  handleSlotFileDrop(file) {
    const validExts = ['wav', 'mp3', 'm4a', 'flac', 'ogg'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (validExts.indexOf(ext) < 0) {
      alert('Unsupported format. Use .wav, .mp3, .m4a, .flac, or .ogg files.');
      return;
    }

    this.showToast('Uploading ' + file.name + '...', true);
    const destPath = 'Boombox/' + file.name;
    const url = `cgi-bin/upload.sh?${this.rootPath}&${encodeURIComponent(destPath)}`;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.onload = () => {
      // assignToSlot handles all cases: direct copy, conversion, compression
      const sound = { name: file.name, path: file.name, ext: ext, size: file.size, dir: '', md5: '' };
      if ((ext === 'wav' && file.size <= 1048576) || this.hasFFmpeg) {
        this.assignToSlot(sound, 'lockchime');
      } else {
        this.toastDone('Uploaded (needs ffmpeg to convert)');
        this.loadSounds();
      }
    };
    xhr.onerror = () => { this.toastDone('Upload failed'); };
    xhr.send(file);
  }

  handleUpload(files) {
    if (!files || files.length === 0) return;

    const progressContainer = this.anchor.querySelector('#sb-upload-progress');
    const progressFill = this.anchor.querySelector('#sb-upload-fill');
    const progressText = this.anchor.querySelector('#sb-upload-text');

    progressContainer.classList.add('active');
    let completed = 0;
    const total = files.length;

    const uploadNext = (index) => {
      if (index >= total) {
        progressText.textContent = 'Syncing to car...';
        this.flushGadget(() => {
          progressContainer.classList.remove('active');
          this.anchor.querySelector('#sb-file-input').value = '';
          this.loadSounds();
        });
        return;
      }

      const file = files[index];
      progressText.textContent = `Uploading ${file.name} (${index + 1}/${total})`;
      progressFill.style.width = ((index / total) * 100) + '%';

      const destPath = 'Boombox/' + file.name;
      const url = `cgi-bin/upload.sh?${this.rootPath}&${encodeURIComponent(destPath)}`;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Length', file.size);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const fileProgress = (e.loaded / e.total);
          const totalProgress = ((index + fileProgress) / total) * 100;
          progressFill.style.width = totalProgress + '%';
        }
      };

      xhr.onload = () => {
        completed++;
        uploadNext(index + 1);
      };

      xhr.onerror = () => {
        progressText.textContent = `Error uploading ${file.name}`;
        setTimeout(() => uploadNext(index + 1), 1000);
      };

      xhr.send(file);
    };

    uploadNext(0);
  }

  convertSound(sound) {
    const progressContainer = this.anchor.querySelector('#sb-upload-progress');
    const progressFill = this.anchor.querySelector('#sb-upload-fill');
    const progressText = this.anchor.querySelector('#sb-upload-text');

    progressContainer.classList.add('active');
    progressText.textContent = `Converting ${sound.name} to WAV...`;
    progressFill.style.width = '50%';

    const sourcePath = encodeURIComponent('Boombox/' + sound.path);
    this.readfile({
      url: `cgi-bin/convert.sh?${this.rootPath}&${sourcePath}`,
      callback: (response) => {
        progressFill.style.width = '100%';
        try {
          const result = JSON.parse(response);
          if (result.status === 'ok') {
            progressText.textContent = `Created ${result.output} (${this.formatSize(result.size)})`;
          } else {
            progressText.textContent = result.message || 'Conversion failed';
          }
        } catch (e) {
          progressText.textContent = 'Conversion failed';
        }
        this.flushGadget(() => {
          setTimeout(() => {
            progressContainer.classList.remove('active');
            this.loadSounds();
          }, 500);
        });
      }
    });
  }

  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    this.selectedSounds.clear();
    const btn = this.anchor.querySelector('#sb-select-btn');
    btn.textContent = this.selectMode ? 'Cancel' : 'Select';
    btn.classList.toggle('active', this.selectMode);
    this.updateToolbar();
    this.renderGrid();
  }

  updateToolbar() {
    const exportBtn = this.anchor.querySelector('#sb-export-btn');
    const deleteBtn = this.anchor.querySelector('#sb-delete-selected-btn');
    const hasSelection = this.selectedSounds.size > 0;
    exportBtn.style.display = (this.selectMode && hasSelection) ? 'inline-block' : 'none';
    deleteBtn.style.display = (this.selectMode && hasSelection) ? 'inline-block' : 'none';
    if (hasSelection) {
      exportBtn.textContent = `Export (${this.selectedSounds.size})`;
      deleteBtn.textContent = `Delete (${this.selectedSounds.size})`;
    }
  }

  exportSelected() {
    if (this.selectedSounds.size === 0) return;

    // Build URL for downloadzip.sh using existing CGI
    const params = [this.rootPath];
    for (const path of this.selectedSounds) {
      params.push('Boombox/' + path);
    }
    const url = 'cgi-bin/downloadzip.sh?' + params.map(p => encodeURIComponent(p)).join('&');

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soundpack.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  importPack(file) {
    if (!file) return;

    const progressContainer = this.anchor.querySelector('#sb-upload-progress');
    const progressFill = this.anchor.querySelector('#sb-upload-fill');
    const progressText = this.anchor.querySelector('#sb-upload-text');

    progressContainer.classList.add('active');
    progressText.textContent = 'Importing sound pack...';
    progressFill.style.width = '50%';

    const url = `cgi-bin/soundpack-import.sh?${this.rootPath}&Boombox`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        progressFill.style.width = ((e.loaded / e.total) * 80) + '%';
      }
    };

    xhr.onload = () => {
      progressFill.style.width = '100%';
      try {
        const result = JSON.parse(xhr.responseText);
        progressText.textContent = `Imported ${result.count} sound(s)`;
      } catch (e) {
        progressText.textContent = 'Import complete';
      }
      progressText.textContent = 'Syncing to car...';
      this.flushGadget(() => {
        setTimeout(() => {
          progressContainer.classList.remove('active');
          this.anchor.querySelector('#sb-pack-input').value = '';
          this.loadSounds();
        }, 500);
      });
    };

    xhr.onerror = () => {
      progressText.textContent = 'Import failed';
      setTimeout(() => progressContainer.classList.remove('active'), 2000);
    };

    xhr.send(file);
  }

  deleteSelected() {
    if (this.selectedSounds.size === 0) return;
    const count = this.selectedSounds.size;
    if (!confirm(`Delete ${count} sound(s)?`)) return;

    this.showToast(`Deleting ${count} sound(s)...`, true);
    let remaining = count;
    for (const path of this.selectedSounds) {
      const encodedPath = encodeURIComponent('Boombox/' + path);
      this.readfile({
        url: `cgi-bin/rm.sh?${this.rootPath}&${encodedPath}`,
        callback: () => {
          remaining--;
          if (remaining === 0) {
            this.selectedSounds.clear();
            this.selectMode = false;
            this.anchor.querySelector('#sb-select-btn').textContent = 'Select';
            this.anchor.querySelector('#sb-select-btn').classList.remove('active');
            this.updateToolbar();
            this.showToast('Syncing to car...', true);
            this.flushGadget(() => {
              this.toastDone(`${count} sound(s) deleted`);
              this.loadSounds();
            });
          }
        }
      });
    }
  }

  startRename(sound, nameEl) {
    const baseName = sound.name.replace(/\.[^.]+$/, '');
    const ext = sound.name.substring(baseName.length);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sb-rename-input';
    input.value = baseName;

    const commit = () => {
      const newBase = input.value.trim();
      if (!newBase || newBase === baseName) {
        nameEl.textContent = sound.name;
        return;
      }
      const newName = newBase + ext;
      this.renameSound(sound, newName);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = sound.name; }
    };
    input.onblur = commit;
    input.onclick = (e) => e.stopPropagation();

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
  }

  renameSound(sound, newName) {
    const oldPath = 'Boombox/' + sound.path;
    const newPath = 'Boombox/' + (sound.dir ? sound.dir + '/' : '') + newName;
    const url = `cgi-bin/rename.sh?${this.rootPath}&${encodeURIComponent(oldPath)}&${encodeURIComponent(newPath)}`;

    this.showToast('Renaming...', true);
    this.readfile({
      url: url,
      callback: (response) => {
        if (response && response.trim() === 'OK') {
          // Update metadata if category was assigned
          if (sound.category) {
            const newRelPath = (sound.dir ? sound.dir + '/' : '') + newName;
            this.saveCategory({ path: newRelPath }, sound.category);
          }
          this.showToast('Syncing to car...', true);
          this.flushGadget(() => {
            this.toastDone('Renamed');
            this.loadSounds();
          });
        } else if (response && response.trim() === 'EXISTS') {
          this.toastDone('A file with that name already exists');
        } else {
          this.toastDone('Rename failed');
        }
      }
    });
  }

  saveCategory(sound, category) {
    const body = JSON.stringify({ path: sound.path, category: category, favorite: sound.favorite || false });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `cgi-bin/savemeta.sh?${this.rootPath}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
      sound.category = category;
      this.showToast('Category updated', false);
      this.hideToast(1000);
      this.renderCategories();
      this.renderGrid();
    };
    xhr.onerror = () => {
      this.showToast('Failed to save category', false);
      this.hideToast(1500);
    };
    xhr.send(body);
  }

  toggleFavorite(sound) {
    const newFav = !sound.favorite;
    const body = JSON.stringify({
      path: sound.path,
      category: sound.category || this.categorize(sound),
      favorite: newFav
    });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `cgi-bin/savemeta.sh?${this.rootPath}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
      sound.favorite = newFav;
      this.renderGrid();
    };
    xhr.onerror = () => {
      this.showToast('Failed to save favorite', false);
      this.hideToast(1500);
    };
    xhr.send(body);
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
