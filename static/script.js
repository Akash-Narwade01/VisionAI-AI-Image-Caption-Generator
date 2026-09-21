/**
 * CaptionAI — Main Client Script
 * All Flask API calls use the /app/ prefix (NOT /api/) because the
 * Replit reverse proxy reserves /api/ for a separate Node.js artifact.
 */

/* ================================================================
   0. UTILITIES
   ================================================================ */

function showToast(message, type = 'success', duration = 3500) {
  const icons = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    info:    'fa-circle-info',
    warning: 'fa-triangle-exclamation',
  };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${icons[type] || 'fa-circle-info'} text-lg flex-shrink-0"></i>
    <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

async function copyText(text, label = 'Caption') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`, 'success');
  } catch {
    showToast('Copy failed — please try manually.', 'error');
  }
}

function typeText(el, text, speed = 18) {
  el.textContent = '';
  el.classList.remove('done');
  if (!text) { el.classList.add('done'); return; }
  let i = 0;
  const timer = setInterval(() => {
    el.textContent += text[i++];
    if (i >= text.length) {
      clearInterval(timer);
      el.classList.add('done');
    }
  }, speed);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const TONE_LABELS = {
  professional: 'Professional',
  funny:        'Funny',
  instagram:    'Instagram',
  creative:     'Creative',
};

const TONE_COLOURS = {
  professional: { text: '#4361ee', bg: 'rgba(67,97,238,0.12)' },
  funny:        { text: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  instagram:    { text: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
  creative:     { text: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
};

/* ================================================================
   1. DARK MODE
   ================================================================ */
(function initTheme() {
  const html = document.documentElement;
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) html.classList.add('dark');
})();

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('theme-toggle');
  const icon   = document.getElementById('theme-icon');
  const html   = document.documentElement;

  function syncIcon() {
    icon.className = html.classList.contains('dark')
      ? 'fa-solid fa-sun text-base'
      : 'fa-solid fa-moon text-base';
  }
  syncIcon();
  toggle.addEventListener('click', () => {
    html.classList.toggle('dark');
    localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
    syncIcon();
  });
});

/* ================================================================
   2. FLOATING PARTICLES
   ================================================================ */
(function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  const ctx    = canvas.getContext('2d');
  let particles = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', () => { resize(); buildParticles(); });

  function buildParticles() {
    const count = Math.min(60, Math.floor(window.innerWidth / 22));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2.5 + 0.8,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      opacity: Math.random() * 0.5 + 0.1,
    }));
  }
  buildParticles();

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const colour = document.documentElement.classList.contains('dark')
      ? '180,190,255' : '67,97,238';
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colour},${p.opacity})`;
      ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < -5)                p.x = canvas.width + 5;
      if (p.x > canvas.width + 5)  p.x = -5;
      if (p.y < -5)                p.y = canvas.height + 5;
      if (p.y > canvas.height + 5) p.y = -5;
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ================================================================
   3. MODEL STATUS POLLING
   NOTE: uses /app/status — NOT /api/status (proxy conflict)
   ================================================================ */
let modelReady = false;

function pollModelStatus() {
  const overlay = document.getElementById('model-loading-overlay');

  fetch('/app/status')
    .then(r => r.json())
    .then(data => {
      if (data.ready) {
        modelReady = true;
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
      } else if (data.error) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        showToast('Model failed to load: ' + data.error, 'error', 8000);
      } else {
        setTimeout(pollModelStatus, 3000);
      }
    })
    .catch(() => setTimeout(pollModelStatus, 4000));
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('model-loading-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
  pollModelStatus();
});

/* ================================================================
   4. FILE UPLOAD & DRAG-DROP
   ================================================================ */
let currentFile      = null;
let currentTone      = 'professional';
let lastResponseData = null;
let isGenerating     = false;   // guard against concurrent requests

document.addEventListener('DOMContentLoaded', () => {
  const dropZone   = document.getElementById('drop-zone');
  const fileInput  = document.getElementById('file-input');
  const dropIdle   = document.getElementById('drop-idle');
  const dropPrev   = document.getElementById('drop-preview');
  const previewImg = document.getElementById('preview-img');
  const fileInfo   = document.getElementById('file-info');
  const removeBtn  = document.getElementById('remove-image');
  const genBtn     = document.getElementById('generate-btn');
  const regenBtn   = document.getElementById('regenerate-btn');

  dropZone.addEventListener('click', e => {
    if (e.target === removeBtn || removeBtn.contains(e.target)) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); })
  );
  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    resetUpload();
  });

  function handleFile(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showToast('Unsupported file type. Please use JPG, PNG or WEBP.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large. Maximum size is 10 MB.', 'error');
      return;
    }
    currentFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      previewImg.src = ev.target.result;
      dropIdle.classList.add('hidden');
      dropPrev.classList.remove('hidden');
      dropPrev.classList.add('flex');
      fileInfo.textContent = `${file.name}  ·  ${formatBytes(file.size)}`;
    };
    reader.readAsDataURL(file);
    genBtn.disabled = false;
    genBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }

  function resetUpload() {
    currentFile = null;
    fileInput.value = '';
    previewImg.src  = '';
    dropIdle.classList.remove('hidden');
    dropPrev.classList.add('hidden');
    dropPrev.classList.remove('flex');
    genBtn.disabled = true;
    genBtn.classList.add('opacity-50', 'cursor-not-allowed');
    regenBtn.classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    lastResponseData = null;
  }

  genBtn.addEventListener('click', () => {
    if (!currentFile || isGenerating) return;
    if (!modelReady) {
      showToast('AI model is still loading. Please wait…', 'warning');
      return;
    }
    uploadAndGenerate(currentFile, currentTone);
  });

  // Regenerate: guarded by isGenerating so rapid clicks are ignored
  regenBtn.addEventListener('click', () => {
    if (!currentFile || isGenerating) return;
    uploadAndGenerate(currentFile, currentTone);
  });

  document.getElementById('tone-buttons').addEventListener('click', e => {
    const btn = e.target.closest('.tone-btn');
    if (!btn) return;
    document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTone = btn.dataset.tone;
    if (lastResponseData) {
      const match = lastResponseData.all_captions.find(c => c.tone === currentTone);
      if (match) updatePrimaryCaption(match.caption, currentTone);
    }
  });
});

/* ================================================================
   5. API CALL — UPLOAD & GENERATE
   NOTE: posts to /app/generate-caption — NOT /api/generate-caption
   ================================================================ */
function setGeneratingState(generating) {
  isGenerating = generating;
  const genBtn     = document.getElementById('generate-btn');
  const genBtnText = document.getElementById('generate-btn-text');
  const regenBtn   = document.getElementById('regenerate-btn');

  if (generating) {
    genBtn.disabled  = true;
    genBtn.classList.add('opacity-70', 'cursor-not-allowed');
    genBtnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Generating…';
    // Disable regenerate too — prevents concurrent server requests that crash the model
    regenBtn.disabled = true;
    regenBtn.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    genBtn.disabled  = false;
    genBtn.classList.remove('opacity-70', 'cursor-not-allowed');
    genBtnText.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-2"></i> Generate Caption';
    regenBtn.disabled = false;
    regenBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

function uploadAndGenerate(file, tone) {
  const progWrap  = document.getElementById('progress-wrap');
  const progBar   = document.getElementById('progress-bar');
  const progLabel = document.getElementById('progress-label');
  const progPct   = document.getElementById('progress-pct');

  setGeneratingState(true);
  progWrap.classList.remove('hidden');

  // Animated progress stages
  const stages = [
    { pct: 20, label: 'Uploading image…',     ms: 400  },
    { pct: 45, label: 'Preprocessing…',       ms: 800  },
    { pct: 70, label: 'Running AI model…',    ms: 2000 },
    { pct: 90, label: 'Generating captions…', ms: 600  },
  ];
  let si = 0;
  function advance() {
    if (si >= stages.length) return;
    const s = stages[si++];
    progBar.style.width   = s.pct + '%';
    progLabel.textContent = s.label;
    progPct.textContent   = s.pct + '%';
    if (si < stages.length) setTimeout(advance, s.ms);
  }
  advance();

  const form = new FormData();
  form.append('image', file);
  form.append('tone', tone);

  fetch('/app/generate-caption', { method: 'POST', body: form })
    .then(r => r.json())
    .then(data => {
      progBar.style.width   = '100%';
      progLabel.textContent = 'Done!';
      progPct.textContent   = '100%';
      setTimeout(() => progWrap.classList.add('hidden'), 600);

      if (data.error) {
        showToast(data.error, 'error', 6000);
      } else {
        lastResponseData = data;
        renderResults(data, tone);
        showToast('Caption generated successfully!', 'success');
        document.getElementById('regenerate-btn').classList.remove('hidden');
      }
    })
    .catch(err => {
      console.error(err);
      showToast('Network error — please try again.', 'error');
      progWrap.classList.add('hidden');
    })
    .finally(() => {
      setGeneratingState(false);
    });
}

/* ================================================================
   6. RENDER RESULTS
   ================================================================ */
function renderResults(data, tone) {
  const section = document.getElementById('results');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('result-img').src = data.image_data;

  setTimeout(() => {
    document.getElementById('confidence-bar').style.width     = data.confidence + '%';
    document.getElementById('confidence-score').textContent   = data.confidence + '%';
  }, 200);

  updatePrimaryCaption(data.caption, tone);

  // Tone variant cards
  const varContainer = document.getElementById('caption-variants');
  varContainer.innerHTML = '';
  for (const v of (data.all_captions || [])) {
    const col  = TONE_COLOURS[v.tone] || TONE_COLOURS.professional;
    const card = document.createElement('div');
    card.className       = 'variant-card' + (v.tone === tone ? ' selected' : '');
    card.dataset.tone    = v.tone;
    card.dataset.caption = v.caption;
    card.innerHTML = `
      <div class="variant-label" style="color:${col.text}">${TONE_LABELS[v.tone] || v.tone}</div>
      <div class="variant-caption">${escHtml(v.caption)}</div>`;
    card.addEventListener('click', () => {
      document.querySelectorAll('.variant-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      document.querySelectorAll('.tone-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tone === v.tone);
      });
      currentTone = v.tone;
      updatePrimaryCaption(v.caption, v.tone);
    });
    varContainer.appendChild(card);
  }

  // Emojis
  const emojiCon = document.getElementById('emoji-container');
  emojiCon.innerHTML = '';
  for (const emoji of (data.emojis || [])) {
    const btn = document.createElement('button');
    btn.className   = 'emoji-btn';
    btn.title       = 'Copy emoji';
    btn.textContent = emoji;
    btn.addEventListener('click', () => copyText(emoji, 'Emoji'));
    emojiCon.appendChild(btn);
  }

  // Hashtags
  const hashCon = document.getElementById('hashtags-container');
  hashCon.innerHTML = '';
  for (const tag of (data.hashtags || [])) {
    const pill = document.createElement('button');
    pill.className   = 'hashtag-pill';
    pill.textContent = tag;
    pill.title       = 'Copy hashtag';
    pill.addEventListener('click', () => copyText(tag, 'Hashtag'));
    hashCon.appendChild(pill);
  }

  loadHistory();
}

function updatePrimaryCaption(caption, tone) {
  const captionEl = document.getElementById('caption-text');
  const toneLabel = document.getElementById('active-tone-label');
  const wordCount = document.getElementById('word-count');
  const charCount = document.getElementById('char-count');

  toneLabel.textContent = (TONE_LABELS[tone] || tone) + ' Caption';
  typeText(captionEl, caption, 22);
  wordCount.textContent = caption.split(/\s+/).filter(Boolean).length + ' words';
  charCount.textContent = caption.length + ' chars';

  document.getElementById('copy-btn').onclick = () => copyText(caption);

  document.getElementById('voice-btn').onclick = () => {
    if (!window.speechSynthesis) {
      showToast('Voice readout not supported in this browser.', 'warning');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(caption);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
    showToast('Reading caption aloud…', 'info', 2000);
  };

  document.getElementById('instagram-btn').onclick = () => {
    if (!lastResponseData) return;
    const igCaption = (lastResponseData.all_captions || []).find(c => c.tone === 'instagram');
    const hashtags  = (lastResponseData.hashtags || []).join(' ');
    const emojis    = (lastResponseData.emojis   || []).join(' ');
    const text = `${igCaption ? igCaption.caption : caption}\n\n${emojis}\n\n${hashtags}`;
    copyText(text, 'Instagram caption');
  };

  document.getElementById('download-btn').onclick = () => {
    if (!lastResponseData) return;
    const lines = [
      'CaptionAI — Generated Caption',
      '================================',
      '',
      `Style: ${TONE_LABELS[tone] || tone}`,
      `Caption: ${caption}`,
      '',
      'All Styles:',
      ...(lastResponseData.all_captions || []).map(c => `  ${TONE_LABELS[c.tone]}: ${c.caption}`),
      '',
      'Hashtags:',
      (lastResponseData.hashtags || []).join(' '),
      '',
      'Emojis:',
      (lastResponseData.emojis || []).join(' '),
      '',
      `Generated: ${new Date().toLocaleString()}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'captionai-result.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Caption downloaded!', 'success');
  };
}

// Copy all hashtags button
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('copy-hashtags-btn').addEventListener('click', () => {
    if (!lastResponseData) return;
    copyText((lastResponseData.hashtags || []).join(' '), 'Hashtags');
  });
});

/* ================================================================
   7. HISTORY — uses /app/history and /app/clear-history
   ================================================================ */
function loadHistory() {
  const skeleton = document.getElementById('history-skeleton');
  const empty    = document.getElementById('history-empty');
  const grid     = document.getElementById('history-grid');
  const clearBtn = document.getElementById('clear-history-btn');

  skeleton.classList.remove('hidden');
  empty.classList.add('hidden');
  grid.classList.add('hidden');

  fetch('/app/history')
    .then(r => r.json())
    .then(data => {
      skeleton.classList.add('hidden');
      const history = data.history || [];

      if (history.length === 0) {
        empty.classList.remove('hidden');
        clearBtn.classList.add('hidden');
        return;
      }

      clearBtn.classList.remove('hidden');
      grid.innerHTML = '';

      for (const entry of history) {
        const col  = TONE_COLOURS[entry.tone] || TONE_COLOURS.professional;
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
          <div class="flex items-center justify-between mb-3">
            <span style="color:${col.text};background:${col.bg};padding:0.2rem 0.6rem;border-radius:9999px;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em">
              ${escHtml(TONE_LABELS[entry.tone] || entry.tone)}
            </span>
            <span class="text-xs text-gray-400">${escHtml(entry.timestamp)}</span>
          </div>
          <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3 line-clamp-3">${escHtml(entry.caption)}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold" style="color:${col.text}">${entry.confidence}% confidence</span>
            <button class="text-xs btn-ghost px-2.5 py-1 copy-history-btn" data-caption="${escAttr(entry.caption)}">
              <i class="fa-solid fa-copy mr-1"></i> Copy
            </button>
          </div>`;
        grid.appendChild(card);
      }

      grid.querySelectorAll('.copy-history-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          copyText(btn.dataset.caption);
        });
      });

      grid.classList.remove('hidden');
    })
    .catch(() => {
      document.getElementById('history-skeleton').classList.add('hidden');
      document.getElementById('history-empty').classList.remove('hidden');
    });
}

document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  document.getElementById('clear-history-btn').addEventListener('click', () => {
    fetch('/app/clear-history', { method: 'POST' })
      .then(() => { showToast('History cleared.', 'info'); loadHistory(); });
  });
});

/* ================================================================
   8. HELPERS
   ================================================================ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
