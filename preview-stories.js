/* Browser-only stories. Media stays in IndexedDB; no real circle members are contacted. */
window.createCirclesStories = ({ state, page, modal, render, toast, escapeHtml: e }) => {
  const icon = (name) => window.circlesIcon(name);
  let items = [],
    seen = [],
    activeId = null,
    paused = false,
    elapsed = 0,
    viewerUrl = null,
    timer = null,
    dbPromise,
    expiryTimer;
  const db = () =>
    (dbPromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('circles-preview-stories', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('stories', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  async function write(value, remove = false) {
    const database = await db();
    await new Promise((resolve, reject) => {
      const tx = database.transaction('stories', 'readwrite');
      const store = tx.objectStore('stories');
      remove ? store.delete(value) : store.put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  const members = () => state.circles.filter((c) => c[4]);
  const expires = (story) => Math.min(story.expiresAt, story.createdAt + 86400000);
  const active = (story) => story.createdAt <= Date.now() && expires(story) > Date.now();
  const visible = () => items.filter((s) => active(s) && members().some((c) => c[0] === s.circle));
  async function load() {
    try {
      const database = await db();
      items = await new Promise((resolve, reject) => {
        const req = database.transaction('stories').objectStore('stories').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const story of items.filter((s) => !active(s))) await write(story.id, true);
      items = items.filter(active).sort((a, b) => b.createdAt - a.createdAt);
      decorate();
    } catch {
      toast('Story storage unavailable. Enable browser storage and retry.');
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem('circles-preview-stories-seen') || '[]');
    seen = Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
  } catch {}
  function decorate() {
    clearTimeout(expiryTimer);
    const nextExpiry = Math.min(...items.filter(active).map(expires));
    if (Number.isFinite(nextExpiry))
      expiryTimer = setTimeout(
        () => {
          if (activeId && !visible().some((story) => story.id === activeId)) {
            document.querySelector('.modalDemo')?.remove();
            activeId = null;
            cleanup();
          }
          decorate();
        },
        Math.max(0, nextExpiry - Date.now()),
      );
    const wasExpanded = page.querySelector('.storyDisclosure')?.open;
    page.querySelector('.storyDisclosure')?.remove();
    page.querySelector('.storyTray')?.remove();
    if (!['home', 'circle'].includes(state.screen)) return;
    if (
      state.screen === 'circle' &&
      (state.circleTab !== 'posts' || !members().some((c) => c[0] === state.activeCircle))
    )
      return;
    const stories = visible().filter(
      (s) => state.screen !== 'circle' || s.circle === state.activeCircle,
    );
    const tray = document.createElement('section');
    tray.className = 'storyTray' + (stories.length ? '' : ' emptyStories');
    tray.innerHTML = `<div class="storyTitle"><h2>Circle stories</h2><span>24 hours</span></div><div class="storyRail"><button class="storyTile" data-story="create"><span class="storyRing storyAdd">＋</span><strong>Your story</strong></button>${stories.map((s) => `<button class="storyTile" data-story="view" data-id="${s.id}" aria-label="${seen.includes(s.id) ? 'Viewed' : 'New'} story in ${e(s.circle)}"><span class="storyRing storyActive ${seen.includes(s.id) ? 'seen' : ''}"><img src="${e(state.avatarUrl)}" alt=""></span><strong>You</strong><small>${e(s.circle)}</small></button>`).join('')}</div>${stories.length ? '' : '<p class="ex-hint">Share a photo or video with your circle for 24 hours.</p>'}`;
    if (!stories.length)
      tray.innerHTML =
        '<button class="emptyStoryButton" data-story="create"><span class="storyRing storyAdd">＋</span><strong>Add a story</strong><span>· 24 hours</span></button>';
    const anchor =
      state.screen === 'home' ? page.querySelector('.intro') : page.querySelector('.circleHeading');
    if (state.screen === 'circle' && stories.length) {
      const details = document.createElement('details');
      details.className = 'storyDisclosure communityDetails';
      details.open = Boolean(wasExpanded);
      const summary = document.createElement('summary');
      summary.textContent = `Circle stories · ${stories.length}`;
      details.append(summary, tray);
      anchor?.after(details);
    } else anchor?.after(tray);
  }
  let selectedFile = null,
    selectedKind = null,
    previewUrl = null,
    busy = false;
  function compose() {
    const circles = members();
    if (!circles.length) {
      toast('Join a circle before sharing a story.');
      return;
    }
    selectedFile = null;
    selectedKind = null;
    modal(
      'Share a story',
      `<form id="storyForm" class="ex-stack"><label class="ex-label">Visible to members of<select name="circle" class="demoInput">${circles.map((c) => `<option ${c[0] === state.activeCircle ? 'selected' : ''}>${e(c[0])}</option>`).join('')}</select></label><div id="storyAttachment"></div><div class="attachmentToolbar">${[
        ['photo', 'Choose photo'],
        ['video', 'Choose video'],
        ['cameraPhoto', 'Take photo'],
        ['cameraVideo', 'Record video'],
      ]
        .map(
          ([kind, label]) =>
            `<button type="button" class="demoChip" data-story="pick" data-kind="${kind}">${label}</button>`,
        )
        .join(
          '',
        )}</div><input id="storyFile" type="file" hidden><label class="ex-label">Caption (optional)<textarea name="caption" class="demoArea" maxlength="280"></textarea></label><p class="ex-hint">Photos up to 10 MB · Videos up to 60 seconds and 25 MB. Stored only in this preview.</p><p id="storyError" role="alert" class="storyError"></p><button class="demoButton" id="storyPublish" disabled>Share story</button></form>`,
    );
    const panel = document.querySelector('.modalPanel');
    panel.classList.add('storyCompose');
    const form = panel.querySelector('form');
    form.addEventListener('submit', publish);
    panel.querySelector('#storyFile').addEventListener('change', choose);
  }
  async function choose(event) {
    const originalForm = event.target.closest('form');
    const file = event.target.files[0];
    if (!file) return;
    const error = document.querySelector('#storyError');
    error.textContent = '';
    try {
      const kind = file.type.startsWith('video/') ? 'video' : 'image';
      const types =
        kind === 'image'
          ? ['image/jpeg', 'image/png', 'image/webp']
          : ['video/mp4', 'video/quicktime', 'video/webm'];
      if (!types.includes(file.type))
        throw Error('Choose a JPG, PNG, WebP, MP4, MOV or WebM file.');
      if (file.size > (kind === 'image' ? 10 : 25) * 1024 * 1024)
        throw Error(
          kind === 'image'
            ? 'Photos must be 10 MB or smaller.'
            : 'Videos must be 25 MB or smaller.',
        );
      const url = URL.createObjectURL(file);
      if (kind === 'video') {
        try {
          await new Promise((resolve, reject) => {
            const video = document.createElement('video');
            const timeout = setTimeout(() => {
              video.removeAttribute('src');
              video.load();
              reject(Error('Could not read this video.'));
            }, 10000);
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
              clearTimeout(timeout);
              const valid =
                Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 60;
              video.removeAttribute('src');
              video.load();
              valid ? resolve() : reject(Error('Choose a video up to 60 seconds long.'));
            };
            video.onerror = () => {
              clearTimeout(timeout);
              reject(Error('Could not read this video.'));
            };
            video.src = url;
          });
        } catch (err) {
          URL.revokeObjectURL(url);
          throw err;
        }
      }
      if (document.querySelector('#storyForm') !== originalForm) {
        URL.revokeObjectURL(url);
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      selectedFile = file;
      selectedKind = kind;
      document.querySelector('#storyAttachment').innerHTML =
        kind === 'image'
          ? `<img class="storyAttachment" src="${url}" alt="Story photo preview">`
          : `<video class="storyAttachment" src="${url}" controls playsinline></video>`;
      document.querySelector('#storyPublish').disabled = false;
    } catch (err) {
      error.textContent = err.message;
    }
  }
  async function publish(event) {
    event.preventDefault();
    if (busy || !selectedFile) return;
    const form = event.currentTarget;
    const circle = form.elements.circle.value;
    if (!members().some((c) => c[0] === circle)) {
      document.querySelector('#storyError').textContent = 'Join this circle before posting.';
      return;
    }
    busy = true;
    const submit = form.querySelector('#storyPublish');
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      await write({
        id: crypto.randomUUID(),
        circle,
        caption: form.elements.caption.value.trim(),
        kind: selectedKind,
        blob: selectedFile,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      if (form.isConnected) form.closest('.modalDemo')?.remove();
      await load();
      toast('Story shared for 24 hours.');
    } catch {
      form.querySelector('#storyError').textContent =
        'Could not save the story. Free some browser storage and retry.';
      submit.disabled = false;
      submit.textContent = 'Share story';
    } finally {
      busy = false;
    }
  }
  function cleanup() {
    clearInterval(timer);
    timer = null;
    if (viewerUrl) {
      URL.revokeObjectURL(viewerUrl);
      viewerUrl = null;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }
  function view(id) {
    cleanup();
    const list = visible(),
      story = list.find((s) => s.id === id);
    if (!story) {
      activeId = null;
      toast('This story has expired.');
      return;
    }
    activeId = id;
    paused = false;
    elapsed = 0;
    if (!seen.includes(id)) {
      seen.push(id);
      try {
        localStorage.setItem('circles-preview-stories-seen', JSON.stringify(seen.slice(-1000)));
      } catch {}
    }
    viewerUrl = URL.createObjectURL(story.blob);
    const index = list.findIndex((s) => s.id === id);
    modal(
      'Circle story',
      `<div class="storyViewer"><div class="storyTitle"><strong>${e(state.displayName)}</strong><span>${index + 1}/${list.length}</span></div><p class="ex-hint">${e(story.circle)} · Expires ${e(new Date(story.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</p><progress class="storyProgress" max="6" value="0" aria-label="Story progress"></progress><div class="storyStage">${story.kind === 'image' ? `<img src="${viewerUrl}" alt="${e(story.caption || 'Circle story')}">` : `<video src="${viewerUrl}" controls playsinline autoplay></video>`}</div>${story.caption ? `<p class="storyCaption">${e(story.caption)}</p>` : ''}<p class="storyError" role="alert"></p><div class="ex-row"><button class="iconButton" aria-label="Previous story" data-story="previous" ${index === 0 ? 'disabled' : ''}>${icon('back')}</button><button class="iconButton" aria-label="Pause story" data-story="pause">${icon('pause')}</button><button class="iconButton" data-story="next" aria-label="${index === list.length - 1 ? 'Finish stories' : 'Next story'}">${icon(index === list.length - 1 ? 'check' : 'forward')}</button><details class="storyOptions"><summary aria-label="Story options">${icon('more')}</summary><button class="demoChip storyDelete" data-story="delete">Delete story</button></details></div></div>`,
    );
    document.querySelector('.modalPanel').classList.add('storyViewerPanel');
    document.querySelector('.storyOptions').addEventListener('toggle', (event) => {
      if (event.currentTarget.open && !paused)
        document.querySelector('[data-story="pause"]').click();
    });
    const video = document.querySelector('.storyStage video');
    const picture = document.querySelector('.storyStage img');
    if (video) {
      video.addEventListener('ended', () => advance(1));
      video.play().catch(() => {});
    }
    document.querySelector('.storyStage img,.storyStage video').addEventListener('error', () => {
      paused = true;
      document.querySelector('.storyViewer .storyError').textContent =
        'Media unavailable. Close and reopen the story to retry.';
    });
    timer = setInterval(() => {
      if (Date.now() >= expires(story)) {
        document.querySelector('.modalDemo')?.remove();
        void load();
        return;
      }
      if (
        !paused &&
        !document.hidden &&
        picture?.complete &&
        picture.naturalWidth > 0 &&
        story.kind === 'image' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        elapsed += 0.25;
        const bar = document.querySelector('.storyProgress');
        if (bar) bar.value = elapsed;
        if (elapsed >= 6) advance(1);
      }
    }, 250);
    decorate();
  }
  function advance(delta) {
    const list = visible(),
      index = list.findIndex((s) => s.id === activeId),
      next = list[index + delta];
    if (next) view(next.id);
    else {
      document.querySelector('.modalDemo')?.remove();
      activeId = null;
      cleanup();
    }
  }
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-story]');
    if (!target) return;
    const action = target.dataset.story;
    if (action === 'create') compose();
    if (action === 'view') view(target.dataset.id);
    if (action === 'pick') {
      const input = document.querySelector('#storyFile');
      input.accept = target.dataset.kind.toLowerCase().includes('video')
        ? 'video/mp4,video/quicktime,video/webm'
        : 'image/jpeg,image/png,image/webp';
      if (target.dataset.kind.startsWith('camera')) input.setAttribute('capture', 'environment');
      else input.removeAttribute('capture');
      input.click();
    }
    if (action === 'next') advance(1);
    if (action === 'previous') advance(-1);
    if (action === 'pause') {
      paused = !paused;
      target.innerHTML = icon(paused ? 'play' : 'pause');
      target.setAttribute('aria-label', paused ? 'Play story' : 'Pause story');
      const video = document.querySelector('.storyStage video');
      if (video) {
        if (paused) video.pause();
        else video.play().catch(() => {});
      }
    }
    if (action === 'delete') {
      paused = true;
      const id = activeId;
      modal(
        'Delete this story?',
        `<p>This removes the story from your circle.</p><button class="demoChip" data-story="keep" data-id="${id}">Keep story</button><button class="demoButton storyDelete" data-story="confirmDelete" data-id="${id}">Delete story</button>`,
      );
    }
    if (action === 'keep') view(target.dataset.id);
    if (action === 'confirmDelete') {
      target.disabled = true;
      void write(target.dataset.id, true)
        .then(() => {
          document.querySelector('.modalDemo')?.remove();
          activeId = null;
          return load();
        })
        .catch(() => {
          target.disabled = false;
          toast('Could not delete the story. Try again.');
        });
    }
  });
  new MutationObserver(() => {
    if (!document.querySelector('.storyViewer') && timer) cleanup();
    if (!document.querySelector('#storyForm') && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }).observe(document.querySelector('.device'), { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      const video = document.querySelector('.storyStage video');
      if (video) {
        video.pause();
        paused = true;
        const toggle = document.querySelector('[data-story="pause"]');
        if (toggle) {
          toggle.innerHTML = icon('play');
          toggle.setAttribute('aria-label', 'Play story');
        }
      }
    } else {
      decorate();
    }
  });
  setInterval(() => {
    if (!document.hidden) void load();
  }, 60000);
  void load();
  return { decorate };
};
