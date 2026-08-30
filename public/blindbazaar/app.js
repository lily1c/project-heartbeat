const launchBtn = document.getElementById('launch');
const chat = document.getElementById('chat');
const legend = document.getElementById('legend');
const agentList = document.getElementById('agent-list');
const sessionsListEl = document.getElementById('sessions-list');
const sessionsEmpty = document.getElementById('sessions-empty');
const tabAgents = document.getElementById('tab-agents');
const tabSessions = document.getElementById('tab-sessions');
const bubbleStage = document.getElementById('bubble-stage');
const bubbleChat = document.getElementById('bubble-chat');
const activityEmpty = document.getElementById('activity-empty');
const chatName = document.getElementById('chat-name');
const groupAvatarStack = document.getElementById('group-avatar-stack');
const liveDot = document.getElementById('live-dot');
const midnightResults = document.getElementById('midnight-results');
const mnFlow = document.getElementById('mn-flow');
const modesEl = document.getElementById('modes');
const progressBar = document.getElementById('progress-bar');
const briefInput = document.getElementById('campaign-brief');

const SESSIONS_KEY = 'blindBazaarSessions';
const MICROPAYMENT = 0.05;

let sellerCount = 1;
let lastLog = null;
let earnedTotals = {}; // sellerId -> $ earned this run
let currentThread = null; // { buyerId, sellerId }
let dealClosedForThread = false;

/* ---------- Tabs ---------- */

tabAgents.addEventListener('click', () => switchTab('agents'));
tabSessions.addEventListener('click', () => switchTab('sessions'));

function switchTab(which) {
  tabAgents.classList.toggle('active', which === 'agents');
  tabSessions.classList.toggle('active', which === 'sessions');
  agentList.style.display = which === 'agents' ? '' : 'none';
  sessionsListEl.style.display = which === 'sessions' ? '' : 'none';
  if (which === 'sessions') renderSessions();
}

/* ---------- Mode pills ---------- */

modesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-pill');
  if (!btn || btn.disabled) return;
  modesEl.querySelectorAll('.mode-pill').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  sellerCount = parseInt(btn.dataset.sellers, 10);
});

/* ---------- Launch flow ---------- */

launchBtn.addEventListener('click', maybeConfirmThenRun);

async function maybeConfirmThenRun() {
  if (lastLog) {
    const wantsSave = confirm('Save the previous auction log as a .txt file before starting a new one?');
    if (wantsSave) downloadLog(lastLog);
  }
  runAuction();
}

function downloadLog(text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blind-bazaar-log-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function chatNameFromBrief(brief) {
  if (!brief) return 'Auction chat';
  return brief
    .split(/\s+/)
    .slice(0, 5)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function runAuction() {
  launchBtn.disabled = true;
  launchBtn.textContent = 'Bidding...';
  liveDot.classList.add('on');
  progressBar.classList.add('active');
  chat.innerHTML = '';
  midnightResults.innerHTML = '';
  bubbleChat.innerHTML = '';
  activityEmpty.style.display = 'none';
  earnedTotals = {};
  dealClosedForThread = false;
  setFlowState('idle');

  const logLines = [];
  const brief = briefInput.value.trim();
  const name = chatNameFromBrief(brief);
  chatName.textContent = name;

  const buyer = { id: 'advertiser-1', maxBudget: 12, minQuality: 7, campaignBrief: brief };
  const allSellers = [
    { id: 'publisher-1', costFloor: 6, trueQuality: 8, reputation: 0.82 },
    { id: 'publisher-2', costFloor: 9, trueQuality: 9, reputation: 0.91 }
  ];
  const sellers = allSellers.slice(0, sellerCount);

  buildLegend(buyer, sellers);
  buildGroupAvatars(buyer, sellers);
  legend.classList.add('visible');
  switchTab('agents');

  try {
    const res = await fetch('/api/negotiate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { buyer, sellers } })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop();

      for (const chunk of chunks) {
        const line = chunk.replace(/^data: /, '').trim();
        if (!line) continue;
        handleEvent(JSON.parse(line), logLines, buyer.id);
      }
    }
  } catch (err) {
    const div = document.createElement('div');
    div.className = 'proof-card invalid';
    div.textContent = `Error: ${err.message}`;
    midnightResults.appendChild(div);
  } finally {
    launchBtn.disabled = false;
    launchBtn.textContent = 'Launch auction';
    liveDot.classList.remove('on');
    progressBar.classList.remove('active');
    removeTyping();
    lastLog = logLines.join('\n');
    addDownloadButton();
    saveSession(name, lastLog);
  }
}

/* ---------- Value extraction for bubble text ---------- */

function extractValues(text) {
  const dealMatch = text.match(/DEAL_ACCEPTED\s+price=([\d.]+)\s+quality=([\d.]+)/i);
  if (dealMatch) return { price: dealMatch[1], quality: dealMatch[2], deal: true };

  const priceMatch = text.match(/\$\s?(\d+(?:\.\d+)?)/);
  const qualityMatch =
    text.match(/quality[^0-9]{0,15}(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)[\s-]*quality/i);

  return {
    price: priceMatch ? priceMatch[1] : null,
    quality: qualityMatch ? qualityMatch[1] : null,
    deal: false
  };
}

function bubbleLabel(values) {
  if (values.deal) return `Deal: $${values.price} CPM \u00b7 Q${values.quality} \u2713`;
  const parts = [];
  if (values.price) parts.push(`$${values.price} CPM`);
  if (values.quality) parts.push(`Q${values.quality}`);
  return parts.length ? parts.join(' \u00b7 ') : '\u2026';
}

/* ---------- Event handling: bubble chat + full transcript + proofs ---------- */

function handleEvent(event, logLines, buyerId) {
  if (event.type === 'header') {
    currentThread = { buyerId: event.buyerId, sellerId: event.sellerId };
    dealClosedForThread = false;

    const header = document.createElement('div');
    header.className = 'seller-header';
    header.textContent = `${event.buyerId} \u2194 ${event.sellerId}`;
    chat.appendChild(header);
    logLines.push(`\n=== ${event.buyerId} vs ${event.sellerId} ===`);

    showTyping(event.buyerId, 'buyer');
  }

  if (event.type === 'line') {
    const role = event.speaker === buyerId ? 'buyer' : 'seller';
    removeTyping();

    const values = extractValues(event.text);
    appendBubble(role, event.speaker, bubbleLabel(values));

    const div = document.createElement('div');
    div.className = 'chat-line';
    div.innerHTML = `<span class="tag ${role}"></span><span class="text"><span class="speaker">${event.speaker}:</span> ${event.text}</span>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    logLines.push(`${event.speaker}: ${event.text}`);

    if (values.deal) {
      dealClosedForThread = true;
      showMidnightPending(event.sellerId);
      setFlowState('active');
    } else if (currentThread) {
      const nextSpeaker = role === 'buyer' ? currentThread.sellerId : currentThread.buyerId;
      const nextRole = role === 'buyer' ? 'seller' : 'buyer';
      showTyping(nextSpeaker, nextRole);
    }
  }

  if (event.type === 'proof') {
    removeTyping();
    removeMidnightPending(event.sellerId);
    renderProof(event);
    setFlowState(event.verification?.valid ? 'success' : 'error');

    if (event.verification?.valid) {
      earnedTotals[event.sellerId] = (earnedTotals[event.sellerId] || 0) + MICROPAYMENT;
      updateEarnedBadge(event.sellerId);
      appendSystemBubble(`\u2713 ${event.sellerId} selected \u2014 +$${MICROPAYMENT.toFixed(2)} micropayment`);
    } else {
      appendSystemBubble(`\u2717 ${event.sellerId}: no deal`);
    }

    logLines.push(
      event.verification
        ? `[${event.sellerId}] ${event.verification.valid ? 'VALID' : 'INVALID'} \u2014 price ${event.agreedPrice}, quality ${event.agreedQuality}`
        : `[${event.sellerId}] no deal reached`
    );
  }

  if (event.type === 'error') {
    removeTyping();
    const div = document.createElement('div');
    div.className = 'proof-card invalid';
    div.textContent = `Error: ${event.message}`;
    midnightResults.appendChild(div);
  }
}

/* ---------- Bubble chat rendering ---------- */

function appendBubble(role, sender, label) {
  const row = document.createElement('div');
  row.className = `bubble-row ${role}`;
  const senderLabel = role === 'seller' ? `<div class="bubble-sender">${sender}</div>` : '';
  row.innerHTML = `${senderLabel}<div class="bubble">${label}</div>`;
  bubbleChat.appendChild(row);
  bubbleStage.scrollTop = bubbleStage.scrollHeight;
}

function appendSystemBubble(text) {
  const row = document.createElement('div');
  row.className = 'bubble-row system';
  row.innerHTML = `<div class="bubble system">${text}</div>`;
  bubbleChat.appendChild(row);
  bubbleStage.scrollTop = bubbleStage.scrollHeight;
}

function showTyping(agentId, role) {
  removeTyping();
  const row = document.createElement('div');
  row.className = `bubble-row ${role}`;
  row.id = 'typing-row';
  row.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
  bubbleChat.appendChild(row);
  bubbleStage.scrollTop = bubbleStage.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-row');
  if (el) el.remove();
}

function buildGroupAvatars(buyer, sellers) {
  groupAvatarStack.innerHTML = '';
  const all = [buyer, ...sellers];
  all.slice(0, 3).forEach((a, i) => {
    const av = document.createElement('div');
    av.className = 'av';
    av.style.background = i === 0 ? 'var(--buyer)' : 'var(--seller)';
    groupAvatarStack.appendChild(av);
  });
}

/* ---------- Legend ---------- */

function buildLegend(buyer, sellers) {
  agentList.innerHTML = '';
  agentList.appendChild(agentRow(buyer.id, 'buyer', 'Advertiser', null));
  sellers.forEach((s) => {
    agentList.appendChild(agentRow(s.id, 'seller', 'Publisher', s.reputation));
  });
}

function agentRow(id, role, label, reputation) {
  const row = document.createElement('div');
  row.className = 'agent-row';
  row.id = `agent-row-${id}`;
  const ratingBar =
    reputation != null
      ? `<div class="rating-track"><div class="rating-fill ${role}" style="width:${Math.round(reputation * 100)}%"></div></div>`
      : '';
  row.innerHTML = `
    <span class="agent-shape ${role}"></span>
    <div class="agent-meta">
      <div class="agent-name">${id}</div>
      <div class="agent-role">${label}${reputation != null ? ' \u00b7 public reputation' : ''}</div>
      ${ratingBar}
      <div class="earned-badge" id="earned-${id}" style="display:none"></div>
    </div>`;
  return row;
}

function updateEarnedBadge(sellerId) {
  const badge = document.getElementById(`earned-${sellerId}`);
  if (!badge) return;
  badge.style.display = 'inline-block';
  badge.textContent = `+$${earnedTotals[sellerId].toFixed(2)} earned`;
}

/* ---------- Proof cards: real Midnight verification panel ---------- */

function truncateHash(hash) {
  if (!hash || hash.length < 14) return hash || '\u2014';
  return `${hash.slice(0, 6)}\u2026${hash.slice(-6)}`;
}

function checkRow(label, ok) {
  return `<div class="mn-check-row"><span>${label}</span><span class="mn-check ${ok ? 'ok' : 'no'}">${ok ? '\u2713' : '\u2717'}</span></div>`;
}

function hashRow(label, hash) {
  if (!hash) return '';
  return `<div class="mn-hash-row"><span>${label}</span><code class="mn-hash" title="${hash}">${truncateHash(hash)}</code></div>`;
}

function renderProof(event) {
  const div = document.createElement('div');
  const v = event.verification;

  if (!v) {
    div.className = 'proof-card invalid';
    div.textContent = `${event.sellerId}: no deal reached`;
    midnightResults.appendChild(div);
    return;
  }

  // Real Midnight result carries these fields. Older mock shape only had
  // { valid, reason, proofRef, txId } — support both so nothing breaks
  // if the mock is ever used as a fallback.
  const isRealShape = 'contractAddress' in v || 'fairnessValid' in v;

  div.className = `proof-card mn-panel ${v.valid ? 'valid' : 'invalid'}`;

  if (!v.valid) {
    div.innerHTML = `
      <div class="mn-header">\u2717 Midnight verification failed \u2014 ${event.sellerId}</div>
      <div class="mn-reason">Reason: ${v.reason || 'unspecified'}</div>`;
    midnightResults.appendChild(div);
    return;
  }

  if (isRealShape) {
    div.innerHTML = `
      <div class="mn-header">\u2713 Verified on Midnight \u2014 ${event.sellerId}</div>
      <div class="mn-checks">
        ${checkRow('Credential', v.credentialValid)}
        ${checkRow('Fair price', v.fairnessValid)}
        ${checkRow('Delivery quality', v.deliveryValid)}
      </div>
      <div class="mn-hashes">
        ${hashRow('Contract', v.contractAddress)}
        ${hashRow('Fairness tx', v.txId)}
        ${hashRow('Delivery tx', v.deliveryTxId)}
      </div>`;
  } else {
    // legacy mock shape fallback
    div.innerHTML = `
      <div class="mn-header">\u2713 ${event.sellerId} \u2014 VALID</div>
      <div class="mn-reason">Price ${event.agreedPrice} \u00b7 Quality ${event.agreedQuality}</div>
      ${hashRow('Proof', v.proofRef)}
      ${hashRow('Tx', v.txId)}`;
  }

  midnightResults.appendChild(div);
}

/* ---------- Pending state while the real ZK proof generates ---------- */

function setFlowState(state) {
  if (mnFlow) mnFlow.dataset.state = state;
}

function showMidnightPending(sellerId) {
  const div = document.createElement('div');
  div.className = 'proof-card mn-pending';
  div.id = `mn-pending-${sellerId}`;
  div.innerHTML = `
    <div class="mn-pending-row">
      <span class="mn-pending-dots"><span></span><span></span><span></span></span>
      Generating Midnight proof for ${sellerId}\u2026
    </div>
    <div class="mn-pending-note">This can take up to a minute or two on testnet.</div>`;
  midnightResults.appendChild(div);
}

function removeMidnightPending(sellerId) {
  const el = document.getElementById(`mn-pending-${sellerId}`);
  if (el) el.remove();
}

function addDownloadButton() {
  const existing = document.getElementById('log-actions');
  if (existing) existing.remove();
  if (!lastLog) return;

  const wrap = document.createElement('div');
  wrap.className = 'log-actions';
  wrap.id = 'log-actions';
  const btn = document.createElement('button');
  btn.className = 'download-btn';
  btn.textContent = 'Download this log (.txt)';
  btn.addEventListener('click', () => downloadLog(lastLog));
  wrap.appendChild(btn);
  chat.parentElement.appendChild(wrap);
}

/* ---------- Sessions (stored locally in the browser) ---------- */

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveSession(name, log) {
  const hadValidDeal = Object.keys(earnedTotals).length > 0;
  const sessions = loadSessions();
  sessions.unshift({
    id: Date.now(),
    name,
    timestamp: new Date().toLocaleString(),
    log,
    hadValidDeal
  });
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)));
}

function renderSessions() {
  const sessions = loadSessions();
  sessionsListEl.innerHTML = '';

  if (sessions.length === 0) {
    sessionsListEl.appendChild(sessionsEmpty);
    return;
  }

  sessions.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.innerHTML = `
      <div class="session-name">${s.name}</div>
      <div class="session-meta">
        <span class="session-dot ${s.hadValidDeal ? 'valid' : 'invalid'}"></span>
        ${s.timestamp}
      </div>`;
    item.addEventListener('click', () => loadSessionIntoLog(s));
    sessionsListEl.appendChild(item);
  });
}

function loadSessionIntoLog(session) {
  chat.innerHTML = `<p class="empty-note">Viewing saved session: ${session.name}</p>`;
  const pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontSize = '12px';
  pre.style.fontFamily = 'inherit';
  pre.textContent = session.log;
  chat.appendChild(pre);
  lastLog = session.log;
  addDownloadButton();

  bubbleChat.innerHTML = '';
  activityEmpty.style.display = 'block';
  activityEmpty.textContent = `Showing full transcript for "${session.name}" on the right \u2014 launch a new auction to see it live here.`;
  chatName.textContent = session.name;
}
