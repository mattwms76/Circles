/* Browser-only demo of community features. The mobile app uses Supabase RLS. */
window.createCirclesDepth = ({
  state,
  page,
  modal,
  render,
  toast,
  escapeHtml: e,
  openCircle,
  openReplies,
  openChat,
  getMedia,
  setMedia,
  mediaMarkup,
  updatePublishButton,
}) => {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('circles-preview-depth') || '{}');
  } catch {}
  const model = {
    mode: 'recommended',
    feed: {},
    hidden: [],
    posts: [],
    snapshots: {},
    collections: {},
    topics: {},
    chat: {},
    messages: {},
    muted: {},
    recognition: {},
    helpful: {},
    prompts: {},
    invites: [],
    checkpoint: Date.now() - 7 * 86400000,
    digest: false,
    ...saved,
  };
  const save = () => {
    try {
      localStorage.setItem('circles-preview-depth', JSON.stringify(model));
    } catch {
      toast('This browser could not save your changes.');
    }
  };
  const joined = (c) => state.circles.some((x) => x[0] === c && x[4]);
  const button = (text, action, attrs = '') =>
    `<button class="demoChip" data-depth="${action}" ${attrs}>${e(text)}</button>`;
  const field = (name, label, value = '', type = 'text') =>
    `<label class="ex-label">${e(label)}<input class="demoInput" name="${name}" type="${type}" value="${e(String(value))}" required></label>`;
  const circleFor = (article) =>
    article.querySelector('.meta')?.textContent.split(' · ')[0] || state.activeCircle;
  const postBy = (id) =>
    model.snapshots[id] ||
    model.posts.find((p) => p.id === id) ||
    Object.entries(state.circlePosts)
      .flatMap(([circle, posts]) => posts.map((p) => ({ ...p, circle })))
      .find((p) => p.id === id);
  const postMarkup = (p) =>
    `<article class="post" data-post-id="${p.id}"><div class="postMeta"><img src="${e(state.avatarUrl)}" alt=""><div><div class="author" data-own-author>${e(state.displayName)}</div><div class="meta">${e(p.circle)} · now</div></div></div><p class="body">${e(p.body)}</p><div class="postActions"><button class="demoChip" data-depth="reply" data-id="${p.id}">Reply</button></div></article>`;
  function persistDirect() {
    try {
      const stored = JSON.parse(localStorage.getItem('circles-preview-experience') || '{}');
      stored.messages = state.messages;
      localStorage.setItem('circles-preview-experience', JSON.stringify(stored));
    } catch {
      toast('Could not save messages in this browser.');
    }
  }
  let dbPromise;
  function db() {
    return (dbPromise ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('circles-community-depth', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  async function putBlob(id, blob) {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction('media', 'readwrite');
      tx.objectStore('media').put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  const urls = new Map();
  async function blobUrl(id) {
    if (urls.has(id)) return urls.get(id);
    const d = await db(),
      blob = await new Promise((resolve, reject) => {
        const r = d.transaction('media').objectStore('media').get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  }
  function drawPoll(article, p) {
    if (p.kind !== 'poll') return;
    const total = p.votes.reduce((a, b) => a + b, 0);
    article
      .querySelector('.body')
      ?.insertAdjacentHTML(
        'afterend',
        `<div class="depthPoll ex-stack">${p.options.map((o, i) => button(`${p.myVote === i ? '✓ ' : ''}${o} · ${total ? Math.round((p.votes[i] / total) * 100) : 0}%`, 'vote', `data-id="${p.id}" data-option="${i}" aria-pressed="${p.myVote === i}" ${p.expires <= Date.now() ? 'disabled' : ''}`)).join('')}<p class="ex-hint">${total} votes · ${p.expires > Date.now() ? 'Closes in 7 days' : 'Poll closed'}</p>${p.myVote !== undefined && p.expires > Date.now() ? button('Remove my vote', 'unvote', `data-id="${p.id}"`) : ''}</div>`,
      );
  }
  function decorate(screen) {
    if (screen === 'home') {
      const section = page.querySelector('.timeline');
      if (section) {
        section
          .querySelector('.sectionHead')
          ?.insertAdjacentHTML(
            'afterend',
            `<div class="depthControls feedToolbar"><div class="feedSegments" role="tablist" aria-label="Timeline order">${button('Recommended', 'mode', 'role="tab" data-mode="recommended" aria-selected="' + (model.mode === 'recommended') + '"')}${button('Latest', 'mode', 'role="tab" data-mode="latest" aria-selected="' + (model.mode === 'latest') + '"')}</div>${button('Timeline options', 'feed')}</div>`,
          );
        const timelineOptions = section.querySelector('[data-depth=feed]');
        timelineOptions.setAttribute('aria-label', 'Timeline options');
        timelineOptions.classList.add('iconButton');
        timelineOptions.innerHTML = window.circlesIcon('more');
        model.posts
          .filter((p) => joined(p.circle))
          .forEach((p) => section.insertAdjacentHTML('beforeend', postMarkup(p)));
        const articles = [...section.querySelectorAll('.post')];
        const postedAt = (article) =>
          Number(article.dataset.createdAt) ||
          model.posts.find((p) => p.id === article.dataset.postId)?.at ||
          0;
        for (const article of articles) {
          const c = circleFor(article),
            pref = model.feed[c] || {};
          article.hidden =
            !joined(c) ||
            model.hidden.includes(article.dataset.postId) ||
            (pref.snooze || 0) > Date.now();
        }
        if (model.mode === 'recommended')
          articles
            .sort((a, b) => {
              const score = (x) => {
                const pref = model.feed[circleFor(x)] || {};
                return (pref.favourite ? 40 : 0) - (pref.less ? 60 : 0) + postedAt(x) / 1e12;
              };
              return score(b) - score(a);
            })
            .forEach((a) => section.append(a));
        else
          articles
            .sort((a, b) => postedAt(b) - postedAt(a))
            .forEach((article) => section.append(article));
      }
    }
    if (screen === 'circle' && joined(state.activeCircle)) {
      const c = state.activeCircle,
        panel = page.querySelector('#circle-panel');
      circleSearch = page.querySelector('.postFilters');
      circleSearch?.remove();
      const tools = `<div class="depthControls circleToolsRoute">${button('Circle tools', 'tools')}</div>`;
      if (state.circleTab === 'posts') panel?.insertAdjacentHTML('afterbegin', tools);
      else panel?.insertAdjacentHTML('beforeend', tools);
      if (state.circleTab === 'posts') {
        const markup = model.posts
          .filter((p) => p.circle === c)
          .map(postMarkup)
          .join('');
        const firstPost = panel?.querySelector('.post');
        if (firstPost) firstPost.insertAdjacentHTML('beforebegin', markup);
        else panel?.insertAdjacentHTML('beforeend', markup);
      }
    }
    if (screen === 'inbox')
      page.querySelector('.inboxToolbar')?.insertAdjacentHTML(
        'afterend',
        `<section class="ex-section"><details><summary>Circle chats</summary><div class="ex-stack">${
          state.circles
            .filter((c) => c[4] && model.chat[c[0]]?.enabled)
            .map((c) =>
              button(
                c[0] + (model.muted[c[0]] ? ' · muted' : ''),
                'chat',
                `data-circle="${e(c[0])}"`,
              ),
            )
            .join('') || '<p class="ex-hint">Chats appear when a host enables them.</p>'
        }</div></details></section>`,
      );
    page.querySelectorAll('.post[data-post-id]').forEach((article) => {
      const p = model.posts.find((p) => p.id === article.dataset.postId);
      if (p) {
        drawPoll(article, p);
        if (p.kind === 'question')
          article
            .querySelector('.body')
            ?.insertAdjacentHTML('beforebegin', '<p class="ex-hint">Question for the circle</p>');
        if (p.topic)
          article
            .querySelector('.body')
            ?.insertAdjacentHTML('beforebegin', `<p class="ex-hint">${e(p.topic)}</p>`);
      }
      const badge =
        model.recognition[circleFor(article)]?.[article.querySelector('.author')?.textContent];
      if (badge)
        article
          .querySelector('.author')
          ?.insertAdjacentHTML('afterend', `<small class="depthBadge">✦ ${e(badge)}</small>`);
    });
  }
  function feed() {
    modal(
      'Timeline preferences',
      `<div class="ex-stack"><p class="ex-hint">${model.mode === 'recommended' ? 'Prioritises favourite circles, your interests, and recent conversations. Only circles you joined.' : 'Newest posts from your joined circles.'}</p>${button('Catch up', 'catchup')}<p>Manage timeline preferences</p>${state.circles
        .filter((c) => c[4])
        .map(
          (c) =>
            `<div class="ex-card"><strong>${e(c[0])}</strong>${button((model.feed[c[0]]?.favourite ? 'Unfavourite' : 'Favourite') + ' circle', 'pref', `data-circle="${e(c[0])}" data-pref="favourite"`)}${button('Restore normal visibility', 'restoreCircle', `data-circle="${e(c[0])}"`)}</div>`,
        )
        .join('')}${button('Restore hidden posts', 'restorePosts')}</div>`,
    );
  }
  function options(id) {
    const article = page.querySelector(`[data-post-id="${CSS.escape(id)}"]`),
      circle = article ? circleFor(article) : state.activeCircle;
    if (!joined(circle)) return;
    if (article) {
      model.snapshots[id] ||= {
        id,
        circle,
        body: article.querySelector('.body')?.textContent || 'Media post',
      };
      save();
    }
    const body = document.querySelector('.modalPanel .ex-stack');
    if (body && !body.querySelector('[data-depth]'))
      body.insertAdjacentHTML(
        'beforeend',
        `<h3>Timeline preferences</h3>${button('Add to circle collection', 'collect', `data-id="${e(id)}" data-circle="${e(circle)}"`)}${button('Favourite this circle', 'pref', `data-circle="${e(circle)}" data-pref="favourite"`)}${button('See less from this circle', 'pref', `data-circle="${e(circle)}" data-pref="less"`)}${button('Snooze circle for 7 days', 'pref', `data-circle="${e(circle)}" data-pref="snooze"`)}${button('Hide this post', 'hide', `data-id="${e(id)}"`)}<p class="ex-hint">Why this post? ${model.feed[circle]?.favourite ? 'From a favourite circle.' : 'A conversation in a circle you joined.'}</p>`,
      );
  }
  let circleSearch = null;
  function participate() {
    const c = state.activeCircle;
    if (!joined(c)) return;
    modal(
      'Ask your circle',
      `<form data-depth-form="participation" class="ex-stack"><label class="ex-label">Post type<select class="demoInput" name="kind"><option value="question">Question</option><option value="poll">Poll</option></select></label><label class="ex-label">Your question<textarea class="demoArea" name="body" maxlength="5000" required></textarea></label><label class="ex-label" data-poll-options hidden>Poll options (2–6, one per line)<textarea class="demoArea" name="options" maxlength="726"></textarea></label><label class="ex-label">Topic<select class="demoInput" name="topic"><option value="">No topic</option>${(model.topics[c] || []).map((t) => `<option>${e(t)}</option>`).join('')}</select></label><button class="demoButton" type="submit">Post to ${e(c)}</button></form>`,
    );
    if (!(model.topics[c] || []).length)
      document
        .querySelector('[data-depth-form="participation"] [name="topic"]')
        ?.closest('label')
        ?.remove();
  }
  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-depth-form="participation"] [name="kind"]')) return;
    const field = event.target.form.querySelector('[data-poll-options]');
    field.hidden = event.target.value !== 'poll';
    field.querySelector('textarea').required = !field.hidden;
  });
  function library(circle = state.activeCircle, postId) {
    if (!joined(circle)) return;
    modal(
      postId ? 'Choose a collection' : 'Circle library',
      `<div class="ex-stack">${
        Object.entries(model.collections[circle] || {})
          .map(([id, col]) =>
            button(
              col.name,
              postId ? 'addCollection' : 'openCollection',
              `data-circle="${e(circle)}" data-collection="${id}" ${postId ? `data-id="${e(postId)}"` : ''}`,
            ),
          )
          .join('') ||
        '<p class="ex-hint">Create a shared collection, then add posts using their options.</p>'
      }<form data-depth-form="collection" data-circle="${e(circle)}">${field('name', 'New collection name')}<button class="demoButton">Create collection</button></form><h3>Topics</h3>${(model.topics[circle] || []).map((t) => button(t, 'topic', `data-circle="${e(circle)}" data-topic="${e(t)}"`)).join('') || '<p class="ex-hint">No topics yet. Ask a host to add topics for this circle.</p>'}</div>`,
    );
  }
  function host() {
    const c = state.activeCircle;
    if (!joined(c)) return;
    const chat = model.chat[c] || {},
      prompt = model.prompts[c] || {};
    modal(
      'Community settings',
      `<div class="ex-stack"><p class="ex-hint">Host controls are simulated in this local preview. The mobile app enforces host/moderator permissions.</p><form data-depth-form="host"><h3>Circle chat</h3><label class="ex-check"><input type="checkbox" name="enabled" ${chat.enabled ? 'checked' : ''}>Enable circle chat</label>${field('slow', 'Minimum seconds between messages (0–300)', chat.slow || 0, 'number')}<h3>Optional weekly question</h3><label class="ex-check"><input type="checkbox" name="weekly" ${prompt.enabled ? 'checked' : ''}>Post a weekly question</label>${field('question', 'Weekly prompt', prompt.question || 'What did you learn this week?')}<label class="ex-label">Day (UTC)<select class="demoInput" name="day">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${i === (prompt.day ?? 1) ? 'selected' : ''}>${d}</option>`).join('')}</select></label><button class="demoButton">Save settings</button></form><form data-depth-form="topic">${field('name', 'New topic name')}<button class="demoButton">Add topic</button></form><form data-depth-form="recognition">${field('member', 'Member name', 'Mara Ellis')}${field('label', 'Recognition label', 'Helpful member')}<button class="demoButton">Recognise member</button></form>${Object.entries(
        model.recognition[c] || {},
      )
        .map(
          ([name, label]) =>
            `<p>${e(name)} · ${e(label)} ${button('Remove', 'revokeRecognition', `data-name="${e(name)}"`)}</p>`,
        )
        .join('')}</div>`,
    );
  }
  function invite() {
    const c = state.activeCircle;
    if (!joined(c)) return;
    modal(
      'Invite members',
      `<div class="ex-stack"><p class="ex-hint">Preview invitations stay in this browser. Connected mobile invitations use HTTPS, expire after 7 days, and preserve private-circle approval.</p>${button('Create local invitation', 'makeInvite')}${model.invites
        .filter((i) => i.circle === c)
        .map(
          (i) =>
            `<div class="ex-card"><strong>${e(c)}</strong><p>Expires ${e(new Date(i.expires).toLocaleDateString())}</p>${button('Preview invitation', 'viewInvite', `data-id="${i.id}"`)}${button('Revoke invitation', 'revokeInvite', `data-id="${i.id}"`)}</div>`,
        )
        .join('')}</div>`,
    );
  }
  function catchup() {
    const posts = model.posts.filter((p) => joined(p.circle) && p.at > model.checkpoint),
      questions = model.posts.filter(
        (p) => joined(p.circle) && p.kind === 'question' && !state.replies[p.id]?.length,
      );
    modal(
      'Your catch-up',
      `<div class="ex-stack"><p class="ex-hint">Since ${e(new Date(model.checkpoint).toLocaleString())}</p><h3>Unanswered questions · ${questions.length}</h3>${questions.map((p) => button(p.body, 'openPost', `data-id="${p.id}"`)).join('')}<h3>New conversations · ${posts.length}</h3>${posts.map((p) => button(p.body, 'openPost', `data-id="${p.id}"`)).join('')}<p class="ex-hint">Upcoming events and replies also appear here in the connected mobile app.</p>${button('Mark caught up', 'caughtUp')}</div>`,
    );
  }
  let chatTarget = null,
    recorder = null,
    stream = null,
    recordTimer,
    recordChunks = [],
    recordStarted = 0;
  async function hydrate() {
    for (const node of document.querySelectorAll('[data-depth-media]')) {
      const url = await blobUrl(node.dataset.depthMedia);
      if (node.isConnected && node.getAttribute('src') !== url) node.src = url;
    }
  }
  function chat(circle = state.activeCircle, direct = false) {
    if (!direct && !joined(circle)) return;
    chatTarget = { circle, direct };
    const key = (direct ? 'direct:' : 'circle:') + circle,
      config = model.chat[circle] || {},
      rows = direct
        ? (state.messages[circle] || []).map((m) => ({ ...m, at: m.createdAt }))
        : model.messages[key] || [];
    modal(
      direct ? circle : circle + ' · chat',
      `<div class="ex-stack"><p class="ex-hint">Local demo messages · 15-minute own deletion. Voice notes up to 60 seconds.</p>${!direct ? button(model.muted[circle] ? 'Unmute chat' : 'Mute chat', 'muteChat') : ''}${rows.map((m) => `<div class="ex-card"><strong>${e(m.author || state.displayName)}</strong><p>${e(m.body || '')}</p>${m.media ? (m.kind === 'voice' ? `<audio controls preload="metadata" data-depth-media="${m.id}"></audio>` : `<img class="postMedia" alt="Shared photo" data-depth-media="${m.id}">`) : ''}${Date.now() - m.at < 900000 ? button('Delete message', 'deleteChatMessage', `data-id="${m.id}"`) : ''}</div>`).join('')}${direct || config.enabled ? `<form data-depth-form="chat"><label class="ex-label">Message<textarea class="demoArea" name="body" maxlength="2000"></textarea></label><button class="demoButton">Send message</button></form><div class="ex-row"><label class="demoChip">Choose photo<input type="file" accept="image/jpeg,image/png,image/webp" id="depthChatPhoto" hidden></label>${button('Record voice note', 'recordVoice')}</div><div id="depthVoicePreview"></div>` : `<p class="ex-hint">The host has paused this chat. Earlier messages remain available.${state.circles.find((c) => c[0] === circle)?.[7] ? ' You can resume it in Circle tools → Host settings.' : ' Ask a host about reopening the chat.'}</p>`}</div>`,
    );
    const panel = document.querySelector('.modalPanel');
    panel?.classList.add('threadPanel');
    const stack = panel?.querySelector('.ex-stack');
    if (stack) {
      stack.classList.add('threadLayout');
      const messages = document.createElement('div');
      messages.className = 'threadMessages';
      stack.querySelectorAll(':scope > .ex-card').forEach((row) => messages.append(row));
      if (!messages.children.length) messages.innerHTML = '<p class="ex-hint">No messages yet.</p>';
      const form = stack.querySelector('form');
      if (form) {
        form.classList.add('threadComposer');
        stack.insertBefore(messages, form);
      } else stack.append(messages);
    }
    void hydrate();
  }
  async function attachBlob(file, kind) {
    if (!chatTarget) return;
    const target = { ...chatTarget };
    if (file.size > 10 * 1024 * 1024) throw Error('Choose media under 10 MB.');
    const id = crypto.randomUUID();
    await putBlob(id, file);
    const url = await blobUrl(id),
      slot = document.querySelector('#depthVoicePreview');
    if (!slot) return;
    slot.innerHTML = `<div class="ex-stack">${kind === 'voice' ? `<audio controls src="${e(url)}"></audio>` : `<img class="postMedia" alt="Attachment preview" src="${e(url)}">`}${button('Send attachment', 'sendChatMedia')}${button('Discard attachment', 'discardChatMedia')}</div>`;
    slot.pending = { id, kind, target };
  }
  function stopRecording() {
    if (recorder?.state === 'recording') recorder.stop();
    clearTimeout(recordTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  function composer() {
    const panel = document.querySelector('.composerScroll');
    if (!panel || panel.querySelector('.depthPublishing')) return;
    panel.insertAdjacentHTML(
      'beforeend',
      `<details class="depthPublishing"><summary>Photo carousel, cover and subtitles</summary><div class="ex-stack"><p class="ex-hint">Up to 10 photos, or one video. Browser trimming creates a new clip when video capture is supported.</p><label class="demoChip">Choose carousel photos<input id="depthPhotos" type="file" multiple accept="image/jpeg,image/png,image/webp" hidden></label><div id="depthPhotoOrder"></div><div class="depthVideoTools">${field('trimStart', 'Trim start (seconds)', 0, 'number')}${field('trimEnd', 'Trim end (seconds)', 10, 'number')}${button('Apply video trim', 'trimVideo')}${field('coverTime', 'Cover frame (seconds)', 0, 'number')}${button('Use frame as cover', 'videoCover')}<label class="ex-label">Subtitles (start - end | text)<textarea class="demoArea" id="depthSubtitles" placeholder="0 - 3 | Welcome to our circle"></textarea></label>${button('Save subtitles', 'subtitles')}</div><p class="ex-hint" id="depthMediaStatus" role="status"></p></div></details>`,
    );
  }
  const getNumber = (n) => Number(document.querySelector(`[name="${n}"]`)?.value);
  async function loadVideo() {
    const m = getMedia();
    if (m?.kind !== 'video') throw Error('Attach a video first.');
    const v = document.createElement('video');
    v.src = m.url;
    v.playsInline = true;
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => reject(Error('Could not read video.'));
    });
    return v;
  }
  async function seek(v, time) {
    if (time === v.currentTime) return;
    await new Promise((resolve, reject) => {
      v.onseeked = resolve;
      v.onerror = () => reject(Error('Could not seek video.'));
      v.currentTime = time;
    });
  }
  async function videoCover() {
    const m = getMedia(),
      v = await loadVideo(),
      time = getNumber('coverTime');
    if (!Number.isFinite(time) || time < 0 || time >= v.duration)
      throw Error('Choose a frame within this video.');
    await seek(v, time);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(960, v.videoWidth);
    canvas.height = (canvas.width * v.videoHeight) / v.videoWidth;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw Error('Could not create cover.');
    const url = URL.createObjectURL(blob);
    m.cover = url;
    document.querySelector('#mediaPreview video')?.setAttribute('poster', url);
    toast('Video cover selected.');
  }
  async function trimVideo() {
    const m = getMedia(),
      v = await loadVideo(),
      start = getNumber('trimStart'),
      end = getNumber('trimEnd');
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > v.duration ||
      end - start > 120
    )
      throw Error('Choose a valid range within the video.');
    if (!v.captureStream || !window.MediaRecorder)
      throw Error(
        'Video trimming needs browser video-capture support. Use the mobile app to trim this clip.',
      );
    const panel = document.querySelector('.composerPanel');
    await seek(v, start);
    const captured = v.captureStream();
    const recorder = new MediaRecorder(captured, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm',
      }),
      chunks = [];
    const status = document.querySelector('#depthMediaStatus');
    status.textContent = 'Creating trimmed video…';
    let timer;
    try {
      const blob = await new Promise((resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.onerror = () => reject(Error('Could not trim video.'));
        recorder.start();
        void v.play().catch(reject);
        timer = setInterval(() => {
          if (v.currentTime >= end || !panel.isConnected) {
            v.pause();
            if (recorder.state === 'recording') recorder.stop();
          }
        }, 100);
        v.onended = () => {
          if (recorder.state === 'recording') recorder.stop();
        };
      });
      if (!panel.isConnected) return;
      if (blob.size > 25 * 1024 * 1024)
        throw Error('Trimmed video exceeds 25 MB. Choose a shorter range.');
      const url = URL.createObjectURL(blob);
      setMedia({ kind: 'video', url, file: new File([blob], 'trimmed.webm', { type: blob.type }) });
      document.querySelector('#mediaPreview').innerHTML = mediaMarkup(getMedia());
      status.textContent = 'Trimmed video ready.';
    } finally {
      clearInterval(timer);
      v.pause();
      captured.getTracks().forEach((t) => t.stop());
    }
  }
  document.addEventListener(
    'click',
    async (event) => {
      const el = event.target.closest('[data-depth]');
      if (!el) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const action = el.dataset.depth,
        circle = el.dataset.circle || state.activeCircle,
        id = el.dataset.id;
      try {
        if (action === 'tools') {
          modal(
            'Circle tools',
            `<div class="settingsRows">${button('Ask or poll', 'participate')}${button('Circle library', 'library')}${button('Circle chat', 'chat')}<button class="demoButton soft" data-ex="circleMembers">Rules, members and host tools</button>${button('Invite members', 'invite')}${state.circles.find((c) => c[0] === circle)?.[7] ? button('Host settings and recognition', 'host') : ''}</div>`,
          );
          if (!circleSearch) {
            circleSearch = document.createElement('details');
            circleSearch.className = 'postFilters';
            circleSearch.innerHTML =
              '<summary>Search posts</summary><div class="ex-stack"><input class="demoInput" id="postSearch" aria-label="Search posts in this circle" placeholder="Search this circle"><select class="demoInput" id="postMediaFilter" aria-label="Filter posts by media"><option value="all">All posts</option><option value="image">Photos</option><option value="video">Videos</option></select><p id="postSearchCount" class="demoCopy" aria-live="polite"></p></div>';
          }
          if (circleSearch)
            document.querySelector('.modalPanel .settingsRows')?.prepend(circleSearch);
        }
        if (action === 'digestPrefs')
          modal(
            'Catch-up preferences',
            `<label class="ex-check"><input type="checkbox" data-depth-setting="digest" ${model.digest ? 'checked' : ''}>Optional weekly catch-up reminder</label><p class="ex-hint">Local demo preference. Device notifications are configured in the mobile app.</p>`,
          );
        if (action === 'mode') {
          model.mode = el.dataset.mode;
          save();
          render();
        }
        if (action === 'feed') feed();
        if (action === 'pref') {
          const p = (model.feed[circle] ||= {});
          if (el.dataset.pref === 'snooze') p.snooze = Date.now() + 7 * 86400000;
          else p[el.dataset.pref] = !p[el.dataset.pref];
          save();
          document.querySelector('.modalDemo')?.remove();
          render();
        }
        if (action === 'restoreCircle') {
          model.feed[circle] = {};
          save();
          render();
          feed();
        }
        if (action === 'restorePosts') {
          model.hidden = [];
          save();
          render();
          feed();
        }
        if (action === 'hide') {
          model.hidden.push(id);
          save();
          document.querySelector('.modalDemo')?.remove();
          render();
        }
        if (action === 'participate') participate();
        if (action === 'host') host();
        if (action === 'library') library();
        if (action === 'collect') library(circle, id);
        if (action === 'vote' || action === 'unvote') {
          const p = postBy(id);
          if (!p || p.expires <= Date.now()) throw Error('This poll has closed.');
          if (p.myVote !== undefined) p.votes[p.myVote]--;
          if (action === 'vote') {
            p.myVote = Number(el.dataset.option);
            p.votes[p.myVote]++;
          } else delete p.myVote;
          save();
          render();
        }
        if (action === 'openCollection' || action === 'topic') {
          const col = model.collections[circle]?.[el.dataset.collection],
            posts =
              action === 'topic'
                ? model.posts.filter((p) => p.circle === circle && p.topic === el.dataset.topic)
                : (col?.posts || []).map(postBy).filter(Boolean);
          modal(
            col?.name || el.dataset.topic,
            `<div class="ex-stack">${posts.map((p) => `<div class="ex-card"><p>${e(p.body)}</p>${button('Open post', 'openPost', `data-id="${p.id}"`)}</div>`).join('') || '<p class="ex-hint">No posts in this collection yet.</p>'}</div>`,
          );
        }
        if (action === 'addCollection') {
          const col = model.collections[circle]?.[el.dataset.collection];
          if (col && !col.posts.includes(id)) col.posts.push(id);
          save();
          toast('Post added to collection.');
        }
        if (action === 'revokeRecognition') {
          delete model.recognition[state.activeCircle]?.[el.dataset.name];
          save();
          host();
        }
        if (action === 'invite') invite();
        if (action === 'makeInvite') {
          model.invites.push({
            id: crypto.randomUUID(),
            circle,
            expires: Date.now() + 7 * 86400000,
          });
          save();
          invite();
        }
        if (action === 'revokeInvite') {
          model.invites = model.invites.filter((i) => i.id !== id);
          save();
          invite();
        }
        if (action === 'viewInvite') {
          const i = model.invites.find((i) => i.id === id && i.expires > Date.now());
          if (!i) throw Error('Invitation expired or revoked.');
          modal(
            'Circle invitation',
            `<p>${e(i.circle)}</p><p class="ex-hint">Local demonstration. Private circles require host approval.</p>${button('Open circle', 'openInvited', `data-circle="${e(i.circle)}"`)}`,
          );
        }
        if (action === 'openInvited') {
          document.querySelector('.modalDemo')?.remove();
          openCircle(circle);
        }
        if (action === 'catchup') catchup();
        if (action === 'caughtUp') {
          model.checkpoint = Date.now();
          save();
          document.querySelector('.modalDemo')?.remove();
          toast('You’re caught up.');
        }
        if (action === 'openPost' || action === 'reply') {
          document.querySelector('.modalDemo')?.remove();
          openReplies(id);
          const p = postBy(id);
          if (p?.kind === 'question') {
            document
              .querySelector('.modalPanel')
              ?.insertAdjacentHTML(
                'beforeend',
                button('Mark most recent reply helpful', 'helpful', `data-id="${id}"`),
              );
          }
        }
        if (action === 'helpful') {
          const replies = state.replies[id] || [];
          if (!replies.length) throw Error('Add a reply first.');
          model.helpful[id] = replies.at(-1).id;
          save();
          toast('Reply marked helpful in this preview.');
        }
        if (action === 'chat') chat(circle);
        if (action === 'directMedia') {
          chatTarget = { circle: state.activeChat, direct: true };
          modal(
            'Attachments',
            `<div class="attachmentToolbar"><label class="demoChip">Choose photo<input type="file" accept="image/jpeg,image/png,image/webp" id="depthChatPhoto" hidden></label>${button('Record voice note', 'recordVoice')}</div><p class="ex-hint">Photos up to 10 MB · Voice notes up to 60 seconds.</p><div id="depthVoicePreview"></div>`,
          );
          const panel = document.querySelector('.modalPanel'),
            close = panel.querySelector('[data-action="closeModal"]');
          close.removeAttribute('data-action');
          close.dataset.depth = 'backToDirect';
          panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              openChat(state.activeChat);
            }
          });
        }
        if (action === 'backToDirect') openChat(state.activeChat);
        if (action === 'muteChat') {
          model.muted[chatTarget.circle] = !model.muted[chatTarget.circle];
          save();
          chat(chatTarget.circle);
        }
        if (action === 'deleteChatMessage') {
          if (chatTarget.direct) {
            const message = state.messages[chatTarget.circle]?.find((m) => m.id === id);
            if (!message?.own || Date.now() - message.createdAt >= 900000)
              throw Error('The deletion window has ended.');
            state.messages[chatTarget.circle] = state.messages[chatTarget.circle].filter(
              (m) => m.id !== id,
            );
            persistDirect();
            openChat(chatTarget.circle);
            void hydrate();
            return;
          }
          const key = (chatTarget.direct ? 'direct:' : 'circle:') + chatTarget.circle,
            m = model.messages[key].find((m) => m.id === id);
          if (!m || Date.now() - m.at >= 900000) throw Error('The deletion window has ended.');
          model.messages[key] = model.messages[key].filter((m) => m.id !== id);
          save();
          chat(chatTarget.circle, chatTarget.direct);
        }
        if (action === 'sendChatMedia') {
          const pending = document.querySelector('#depthVoicePreview')?.pending;
          if (pending) {
            const key = (pending.target.direct ? 'direct:' : 'circle:') + pending.target.circle;
            model.messages[key] ||= [];
            model.messages[key].push({
              id: pending.id,
              media: true,
              kind: pending.kind,
              at: Date.now(),
            });
            if (pending.target.direct) {
              state.messages[pending.target.circle] ||= [];
              state.messages[pending.target.circle].push({
                id: pending.id,
                media: true,
                kind: pending.kind,
                body: '',
                own: true,
                createdAt: Date.now(),
              });
              persistDirect();
              openChat(pending.target.circle);
              void hydrate();
              return;
            }
            save();
            chat(pending.target.circle, pending.target.direct);
          }
        }
        if (action === 'discardChatMedia')
          document.querySelector('#depthVoicePreview').innerHTML = '';
        if (action === 'recordVoice') {
          if (recorder?.state === 'recording') {
            stopRecording();
            return;
          }
          if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
            throw Error('Voice recording needs microphone support.');
          const panel = el.closest('.modalPanel');
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!panel.isConnected) {
            stopRecording();
            return;
          }
          recordChunks = [];
          recordStarted = Date.now();
          recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => {
            if (e.data.size) recordChunks.push(e.data);
          };
          recorder.onstop = () => {
            if (panel.isConnected && Date.now() - recordStarted <= 61000)
              void attachBlob(new Blob(recordChunks, { type: recorder.mimeType }), 'voice').catch(
                (e) => toast(e.message),
              );
          };
          recorder.start();
          el.textContent = 'Stop recording';
          recordTimer = setTimeout(stopRecording, 60000);
        }
        if (action === 'photoUp' || action === 'photoRemove') {
          const m = getMedia(),
            items = [...(m.items || [])],
            index = Number(el.dataset.index);
          if (action === 'photoRemove') items.splice(index, 1);
          else [items[index - 1], items[index]] = [items[index], items[index - 1]];
          setMedia(items.length ? { ...items[0], items } : null);
          document.querySelector('#mediaPreview').innerHTML = mediaMarkup(getMedia());
          photoOrder();
        }
        if (action === 'videoCover') await videoCover();
        if (action === 'trimVideo') {
          el.disabled = true;
          try {
            await trimVideo();
          } finally {
            if (el.isConnected) el.disabled = false;
          }
        }
        if (action === 'subtitles') {
          const media = getMedia();
          if (media?.kind !== 'video') throw Error('Attach a video first.');
          const video = await loadVideo(),
            lines = document
              .querySelector('#depthSubtitles')
              .value.trim()
              .split(/\r?\n/)
              .filter(Boolean);
          let previous = 0;
          const cues = lines.map((line) => {
            const match = line.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\|\s*(.+)$/);
            if (!match) throw Error('Use 0 - 3 | Your subtitle');
            const c = { start: Number(match[1]), end: Number(match[2]), text: match[3] };
            if (
              c.start < previous ||
              c.end <= c.start ||
              c.end > video.duration ||
              c.text.length > 300
            )
              throw Error('Use ordered subtitle cues that fit inside the video.');
            previous = c.end;
            return c;
          });
          if (cues.length > 100) throw Error('Use up to 100 subtitle cues.');
          const time = (s) => {
            const ms = Math.round(s * 1000);
            return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
          };
          const vtt =
            'WEBVTT\n\n' +
            cues.map((c) => `${time(c.start)} --> ${time(c.end)}\n${c.text}`).join('\n\n');
          media.subtitles = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
          document.querySelector('#mediaPreview').innerHTML = mediaMarkup(media);
          toast('Subtitles saved.');
        }
      } catch (error) {
        window.circlesPreviewError(error.message || 'Please try again.');
      }
    },
    true,
  );
  function photoOrder() {
    const m = getMedia(),
      slot = document.querySelector('#depthPhotoOrder');
    if (slot)
      slot.innerHTML = (m?.items || [])
        .map(
          (x, i) =>
            `<div class="ex-row"><img src="${e(x.url)}" width="48" height="48" alt="Photo ${i + 1}"><span>Photo ${i + 1}</span>${i ? button('Move earlier', 'photoUp', `data-index="${i}"`) : ''}${button('Remove', 'photoRemove', `data-index="${i}"`)}</div>`,
        )
        .join('');
  }
  document.addEventListener('change', async (event) => {
    try {
      if (event.target.dataset.depthSetting === 'digest') {
        model.digest = event.target.checked;
        save();
      }
      if (event.target.id === 'depthChatPhoto' && event.target.files[0])
        await attachBlob(event.target.files[0], 'photo');
      if (event.target.id === 'depthPhotos') {
        const files = [...event.target.files];
        if (
          files.length > 10 ||
          files.some(
            (f) =>
              !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) ||
              f.size > 25 * 1024 * 1024,
          )
        )
          throw Error('Choose up to 10 JPG, PNG or WebP photos, each under 25 MB.');
        const items = files.map((file) => ({
          url: URL.createObjectURL(file),
          kind: 'image',
          file,
        }));
        setMedia(items.length ? { ...items[0], items } : null);
        document.querySelector('#mediaPreview').innerHTML = mediaMarkup(getMedia());
        photoOrder();
      }
    } catch (error) {
      window.circlesPreviewError(error.message);
    }
  });
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target.closest('[data-depth-form]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        const f = new FormData(form),
          kind = form.dataset.depthForm,
          c = state.activeCircle;
        if (kind === 'participation') {
          if (!joined(c)) throw Error('Join this circle first.');
          const options = String(f.get('options'))
              .split(/\r?\n/)
              .map((x) => x.trim())
              .filter(Boolean),
            body = String(f.get('body')).trim(),
            type = f.get('kind');
          if (body.length < 2 || body.length > 5000)
            throw Error('Write a question of 2–5,000 characters.');
          if (
            type === 'poll' &&
            (options.length < 2 ||
              options.length > 6 ||
              options.some((o) => o.length > 120) ||
              new Set(options.map((o) => o.toLowerCase())).size !== options.length)
          )
            throw Error('Add 2–6 different poll options.');
          model.posts.unshift({
            id: crypto.randomUUID(),
            circle: c,
            body,
            kind: type,
            topic: f.get('topic'),
            options,
            votes: options.map(() => 0),
            at: Date.now(),
            expires: Date.now() + 7 * 86400000,
          });
          document.querySelector('.modalDemo')?.remove();
          save();
          render();
        }
        if (kind === 'collection') {
          const circle = form.dataset.circle,
            name = String(f.get('name')).trim();
          if (name.length < 2 || name.length > 80)
            throw Error('Use a collection name of 2–80 characters.');
          model.collections[circle] ||= {};
          model.collections[circle][crypto.randomUUID()] = { name, posts: [] };
          save();
          library(circle);
        }
        if (kind === 'host') {
          const slow = Number(f.get('slow'));
          if (!Number.isInteger(slow) || slow < 0 || slow > 300)
            throw Error('Enter a delay from 0 to 300 seconds.');
          model.chat[c] = { enabled: f.has('enabled'), slow };
          model.prompts[c] = {
            enabled: f.has('weekly'),
            question: String(f.get('question')).trim(),
            day: Number(f.get('day')),
          };
          save();
          toast('Host settings saved locally.');
        }
        if (kind === 'topic') {
          const name = String(f.get('name')).trim();
          if (name.length < 2 || name.length > 40)
            throw Error('Use a topic name of 2–40 characters.');
          model.topics[c] ||= [];
          if (!model.topics[c].includes(name)) model.topics[c].push(name);
          save();
          host();
        }
        if (kind === 'recognition') {
          const name = String(f.get('member')).trim(),
            label = String(f.get('label')).trim();
          if (label.length < 2 || label.length > 40) throw Error('Use a label of 2–40 characters.');
          model.recognition[c] ||= {};
          model.recognition[c][name] = label;
          save();
          host();
        }
        if (kind === 'chat') {
          if (chatTarget.direct) {
            const body = String(f.get('body')).trim();
            if (!body) return;
            state.messages[chatTarget.circle] ||= [];
            state.messages[chatTarget.circle].push({
              id: crypto.randomUUID(),
              body,
              own: true,
              createdAt: Date.now(),
            });
            persistDirect();
            openChat(chatTarget.circle);
            void hydrate();
            return;
          }
          const key = (chatTarget.direct ? 'direct:' : 'circle:') + chatTarget.circle,
            body = String(f.get('body')).trim();
          if (!body) return;
          const messages = (model.messages[key] ||= []),
            last = messages.at(-1),
            slow = model.chat[chatTarget.circle]?.slow || 0;
          if (last && Date.now() - last.at < Math.max(1, slow) * 1000)
            throw Error('Please wait before sending again.');
          messages.push({ id: crypto.randomUUID(), body, at: Date.now() });
          model.messages[key] = messages;
          save();
          chat(chatTarget.circle, chatTarget.direct);
        }
      } catch (error) {
        window.circlesPreviewError(error.message);
      }
    },
    true,
  );
  new MutationObserver(() => {
    if (!document.querySelector('#depthVoicePreview') && recorder?.state === 'recording')
      stopRecording();
    const panel = document.querySelector('.messageThread');
    if (panel && !panel.querySelector('[data-depth="directMedia"]')) {
      const composer = panel.querySelector('.threadComposer');
      if (composer)
        composer.insertAdjacentHTML(
          'afterbegin',
          '<button type="button" class="attachmentTrigger" aria-label="Photo or voice note" data-depth="directMedia">＋</button>',
        );
    }
    if (document.querySelector('[data-depth-media]:not([src])')) void hydrate();
  }).observe(document.querySelector('.device'), { subtree: true, childList: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRecording();
  });
  const changePost = (id, body) => {
    if (body === null) {
      model.posts = model.posts.filter((p) => p.id !== id);
      delete model.snapshots[id];
    } else {
      const p = postBy(id);
      if (p) p.body = body;
    }
    save();
  };
  return { decorate, options, composer, changePost };
};
