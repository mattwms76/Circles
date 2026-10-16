/* Local prototype counterpart of the native experience. No backend requests. */
window.createCirclesExperience = ({
  state,
  icon,
  page,
  modal,
  render,
  toast,
  escapeHtml: e,
  openComposer,
  openCircle,
  renderLive,
  giftCatalog,
  canDelete,
  deleteControl,
}) => {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('circles-preview-experience') || '{}');
  } catch {}
  const model = {
    interests: ['Film', 'Gardening'],
    drafts: {},
    replyTo: {},
    muted: {},
    rules: {},
    roles: {},
    circleNotifications: {},
    events: {},
    rooms: [],
    favourites: [],
    activity: [],
    onboarded: false,
    ...saved,
  };
  if (saved.following) state.following = new Set(saved.following);
  if (saved.requestedCircles) state.requestedCircles = new Set(saved.requestedCircles);
  if (saved.memberships)
    state.circles.forEach((c) => {
      if (c[0] in saved.memberships) c[4] = saved.memberships[c[0]];
    });
  state.messages = saved.messages || state.messages;
  state.replies = saved.replies || state.replies;
  const save = () => {
    document.querySelectorAll('[data-ex=activity]').forEach((el) => {
      if (el.textContent.startsWith('Activity ·'))
        el.textContent = `Activity · ${model.activity.filter((a) => !a.read).length} unread`;
    });
    try {
      localStorage.setItem(
        'circles-preview-experience',
        JSON.stringify({
          ...model,
          messages: state.messages,
          replies: state.replies,
          following: [...state.following],
          requestedCircles: [...state.requestedCircles],
          memberships: Object.fromEntries(state.circles.map((c) => [c[0], c[4]])),
        }),
      );
    } catch {
      toast('Browser storage is full; changes may not survive a reload.');
    }
  };
  const button = (label, action, extra = '', soft = true) =>
    `<button class="demoButton ${soft ? 'soft' : ''}" data-ex="${action}" ${extra}>${e(label)}</button>`;
  const field = (label, name, value = '', type = 'text') =>
    `<label class="ex-label">${e(label)}<input class="demoInput" name="${name}" type="${type}" value="${e(value)}" aria-label="${e(label)}" required></label>`;
  const seedActivity = () => {
    if (model.activity.length || model.activitySeeded) return;
    model.activitySeeded = true;
    model.activity = [
      {
        id: crypto.randomUUID(),
        kind: 'messages',
        target: 'Mara Ellis',
        title: 'New messages from Mara',
        body: 'Your next photo walk is taking shape.',
        at: Date.now(),
        read: false,
      },
      {
        id: crypto.randomUUID(),
        kind: 'messages',
        target: 'Mara Ellis',
        title: 'New messages from Mara',
        body: 'Coffee before the photo walk?',
        at: Date.now() - 60000,
        read: false,
      },
    ];
    save();
  };
  seedActivity();
  let discovery = { privacy: 'all', sort: 'recommended', active: false },
    chatSearch = '',
    unreadOnly = false,
    inboxQuery = '',
    activityUnread = false,
    onboardStep = 0,
    editingRoom = null,
    giftTier = 'all';
  const count = (n) => parseFloat(n) * (n.endsWith('k') ? 1000 : 1);
  const composerWidths = new WeakMap();
  const composerObserver = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      if (composerWidths.get(target) === contentRect.width) continue;
      composerWidths.set(target, contentRect.width);
      target.style.height = 'auto';
      target.style.height = Math.min(128, Math.max(52, target.scrollHeight)) + 'px';
    }
  });
  const decorate = (screen) => {
    if (page.querySelector('#activitySlot')) {
      const unread = model.activity.filter((a) => !a.read).length;
      page.querySelector('#activitySlot').innerHTML =
        `<button class="iconButton" data-ex="activity" aria-label="Activity, ${unread} unread">${icon('bell')}${unread ? `<span class="unreadBadge">${unread}</span>` : ''}</button>`;
      page.querySelector('.timeline .eyebrow')?.remove();
      const timelineTitle = page.querySelector('.timeline h2');
      if (timelineTitle) timelineTitle.textContent = 'Your timeline';
      page.querySelector('.timeline .link')?.remove();
    }
    if (screen === 'circles') {
      page
        .querySelector('#circleList')
        ?.insertAdjacentHTML(
          'afterend',
          button(model.onboarded ? 'Find more people' : 'Find your people', 'onboarding'),
        );
      page
        .querySelector('.demoFilters')
        ?.insertAdjacentHTML(
          'afterend',
          `<div class="discoveryDetails">${button('Filters · ' + (Number(discovery.privacy !== 'all') + Number(discovery.sort !== 'recommended') + Number(discovery.active)) + ' active', 'discoveryFilters')}</div>`,
        );
      page.querySelectorAll('.demoCircle').forEach((card) => {
        const c = state.circles.find((c) => c[0] === card.dataset.name);
        if (c)
          card.insertAdjacentHTML(
            'beforeend',
            `<p class="ex-hint">${e(model.interests.includes(c[1]) ? `Matches your interest in ${c[1].toLowerCase()}` : c[6] ? 'Private community · host approval required' : `Explore ${c[1].toLowerCase()} together`)}</p>`,
          );
      });
      filter();
    }
    if (screen === 'circle') {
      const c = state.circles.find((c) => c[0] === state.activeCircle),
        panel = page.querySelector('#circle-panel');
      if (c?.[4] && state.circleTab === 'about')
        panel.innerHTML = `<img class="editorialCover" src="${page.querySelector('.circleCover .circleIdentity img')?.src || ''}" alt="${e(c[0])} cover"><div class="ex-stack"><h2 class="ex-title">A little about us</h2><p class="ex-body">${e(c[2])}</p><div class="ex-card"><h3>Circle rules</h3><p>${e(model.rules[c[0]] || 'Be kind, respect privacy, and keep conversations relevant.')}</p></div>${button(model.circleNotifications[c[0]] === false ? 'Turn on circle notifications' : 'Turn off circle notifications', 'circleMute')}<button class="demoChip" data-action="leaveCircle" data-name="${e(c[0])}">Leave circle</button></div>`;
      if (c?.[4] && state.circleTab === 'events')
        panel.innerHTML = `<div class="ex-stack"><h2 class="ex-title">Upcoming events</h2>${
          (model.events[c[0]] || [])
            .filter((event) => event.at > Date.now())
            .map(
              (event) =>
                `<div class="ex-card"><strong>${e(event.title)}</strong><p>${e(new Date(event.at).toLocaleString())}</p>${button(event.going ? 'Going · cancel RSVP' : 'Join event', 'rsvp', `data-id="${event.id}"`)}${button('Add to calendar', 'calendar', `data-title="${e(event.title)}" data-at="${event.at}"`)}</div>`,
            )
            .join('') ||
          '<div class="ex-empty"><h3>Time for something together</h3><p>Plan a get-together for your circle.</p></div>'
        }${c[7] ? button('Schedule an event', 'circleTools', '', false) : '<p class="ex-hint">Your host can plan the first event.</p>'}</div>`;
    }
    if (screen === 'live') {
      page.insertAdjacentHTML(
        'beforeend',
        `<section class="ex-section"><div class="ex-card"><h2 class="ex-title">Upcoming rooms</h2>${button('Schedule a live room', 'scheduleRoom', '', false)}${
          model.rooms
            .filter((r) => !r.cancelled)
            .map(roomCard)
            .join('') || '<p class="ex-hint">Give your people time to join you.</p>'
        }</div></section>`,
      );
    }
    if (screen === 'inbox') {
      page
        .querySelector('.screenHead')
        ?.insertAdjacentHTML(
          'afterend',
          `<div class="ex-section inboxToolbar"><label class="ex-label">Find a conversation<input id="exInboxSearch" class="demoInput" value="${e(inboxQuery)}" placeholder="Search people"></label><div class="ex-row">${button('All conversations', 'unreadInbox', `data-filter="all" aria-pressed="${!unreadOnly}"`)}${button('Unread', 'unreadInbox', `data-filter="unread" aria-pressed="${unreadOnly}"`)}</div></div>`,
        );
      filterInbox();
    }
    if (screen === 'profile') {
      page
        .querySelector('.screenHead')
        ?.insertAdjacentHTML(
          'afterend',
          `<div class="ex-section profileToolbar">${button('Activity', 'activity')}${button('Settings and privacy', 'settings')}</div>`,
        );
    }
    if (screen === 'profile') {
      const edit = page.querySelector('[data-action="editProfile"]');
      const oldCard = edit?.closest('.demoCard');
      if (edit) {
        edit.classList.remove('soft');
        const stats = page.querySelector('.profileStats');
        if (stats) stats.before(edit);
        else page.querySelector('.screenHead').append(edit);
      }
      oldCard?.remove();
      const wallet = page.querySelector('.walletDemo');
      if (wallet) page.append(wallet);
    }
    labelFields();
  };
  function labelFields() {
    document
      .querySelectorAll(
        '.modalPanel input:not([type=checkbox]):not([type=file]),.modalPanel textarea',
      )
      .forEach((input) => {
        if (input.closest('label')) return;
        const label = document.createElement('label');
        label.className = 'ex-label';
        label.textContent = input.getAttribute('aria-label') || input.placeholder || 'Your text';
        input.before(label);
        label.append(input);
      });
  }
  function discoveryFilters() {
    modal(
      'Circle filters',
      `<div class="ex-section ex-stack"><label class="ex-label">Membership<select id="exPrivacy" class="demoInput"><option value="all">Any circle</option><option value="public">Public</option><option value="private">Private</option></select></label><label class="ex-label">Sort circles<select id="exSort" class="demoInput"><option value="recommended">For you</option><option value="active">Recently active</option><option value="popular">Popular</option><option value="newest">New</option></select></label><label class="ex-row"><input type="checkbox" id="exActive"> Active in the last 7 days</label>${button('Clear search and filters', 'clearDiscovery')}</div>`,
    );
    document.querySelector('#exPrivacy').value = discovery.privacy;
    document.querySelector('#exSort').value = discovery.sort;
    document.querySelector('#exActive').checked = discovery.active;
  }
  function filter() {
    const summary = page.querySelector('.discoveryDetails button');
    if (summary)
      summary.textContent = `Filters · ${Number(discovery.privacy !== 'all') + Number(discovery.sort !== 'recommended') + Number(discovery.active)} active`;
    const query = (document.querySelector('#circleSearch')?.value || '').toLowerCase();
    const interest = document.querySelector('[data-filter].on')?.dataset.filter || 'For you';
    let matches = state.circles.filter(
      (c) =>
        (interest === 'For you' || interest === 'All' || c[1] === interest) &&
        `${c[0]} ${c[1]} ${c[2]}`.toLowerCase().includes(query) &&
        (discovery.privacy === 'all' || Boolean(c[6]) === (discovery.privacy === 'private')) &&
        (!discovery.active || Boolean(state.circlePosts[c[0]]?.length)),
    );
    matches.sort((a, b) =>
      discovery.sort === 'popular'
        ? count(b[3]) - count(a[3])
        : discovery.sort === 'recommended'
          ? Number(model.interests.includes(b[1])) - Number(model.interests.includes(a[1]))
          : discovery.sort === 'newest'
            ? state.circles.indexOf(a) - state.circles.indexOf(b)
            : (state.circlePosts[b[0]]?.length || 0) - (state.circlePosts[a[0]]?.length || 0),
    );
    const cards = [...page.querySelectorAll('.demoCircle')];
    cards.forEach(
      (card) =>
        (card.style.display = matches.some((c) => c[0] === card.dataset.name) ? '' : 'none'),
    );
    const parent = cards[0]?.parentNode;
    for (const c of matches) {
      const card = cards.find((x) => x.dataset.name === c[0]);
      if (card) parent.append(card);
    }
    document.querySelector('#circleCount').textContent = `${matches.length} circles to explore`;
    page.querySelector('#exNoResults')?.remove();
    if (!matches.length)
      parent?.insertAdjacentHTML(
        'beforeend',
        `<div id="exNoResults" class="ex-empty"><p>No matching circles. Try a broader interest or clear the filters.</p>${button('Clear search and filters', 'clearDiscovery')}</div>`,
      );
  }
  function filterInbox() {
    inboxQuery = document.querySelector('#exInboxSearch')?.value || '';
    const q = inboxQuery.trim().toLowerCase();
    let visible = 0;
    page.querySelectorAll('[data-action=openChat]').forEach((el) => {
      const name = el.dataset.name;
      const unread = model.activity.filter(
        (a) => a.kind === 'messages' && a.target === name && !a.read,
      ).length;
      el.classList.toggle('hasUnread', unread > 0);
      const badge = el.querySelector('.inboxUnread');
      if (badge) {
        badge.hidden = !unread;
        badge.textContent = unread > 99 ? '99+' : String(unread);
      }
      const latest = state.messages[name]?.at(-1);
      if (latest) el.querySelector('.grow .demoCopy').textContent = latest.body;
      el.hidden = !(
        name.toLowerCase().includes(q) &&
        (!unreadOnly ||
          model.activity.some((a) => a.kind === 'messages' && a.target === name && !a.read))
      );
      if (!el.hidden) visible++;
    });
    page.querySelector('.inboxEmpty')?.remove();
    if (!visible)
      page
        .querySelector('.inboxList')
        ?.insertAdjacentHTML(
          'beforeend',
          '<p class="ex-empty inboxEmpty" role="status">No conversations match. Clear your search or select All conversations.</p>',
        );
  }
  function content(kind, key) {
    return (kind === 'message' ? state.messages : state.replies)[key] || [];
  }
  function entryMarkup(item, kind, key) {
    const parent = content(kind, key).find((m) => m.id === item.replyToId);
    const selected = item.reactions || [];
    if (kind === 'message')
      return `<div class="message ${item.own ? 'mine' : ''}" data-entry="${item.id}" ${!item.body.toLowerCase().includes(chatSearch.toLowerCase()) ? 'hidden' : ''}>
      <button class="messageOpen" data-ex="messageOptions" data-id="${item.id}" aria-label="Message options: ${e(item.body || 'Attachment')}">
      ${item.replyToId ? `<span class="ex-quote">Replying to ${e(parent?.body || 'Original message unavailable')}</span>` : ''}
      <span class="messageBody">${e(item.body)}</span><small class="messageTime">${e(new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small></button>
      ${item.media ? (item.kind === 'voice' ? `<audio controls preload="metadata" data-depth-media="${e(item.id)}"></audio>` : `<img class="postMedia" alt="Shared photo" data-depth-media="${e(item.id)}">`) : ''}
      ${selected.length ? `<div class="messageSelectedReactions">${selected.map((emoji) => button(`${emoji} 1`, 'react', `data-id="${item.id}" data-emoji="${emoji}" aria-pressed="true"`)).join('')}</div>` : ''}</div>`;

    return `<div class="message ${item.own ? 'mine' : ''} ${item.replyToId ? 'isReply' : ''}" data-entry="${item.id}" ${kind === 'message' && !item.body.toLowerCase().includes(chatSearch.toLowerCase()) ? 'hidden' : ''}>${item.replyToId ? `<div class="ex-quote"><small>Replying to ${parent?.own ? 'yourself' : e(key)}</small><p>${e(parent?.body || 'Original message unavailable')}</p></div>` : ''}<p>${e(item.body)}</p><small class="messageTime">${e(new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small><div class="entryControls"><div class="ex-reactions">${selected.map((emoji) => button(`${emoji} 1`, 'react', `data-id="${item.id}" data-emoji="${emoji}" aria-pressed="true"`)).join('')}<details class="reactionPicker"><summary aria-label="Add reaction">${icon('plus')}</summary><div class="reactionChoices">${['❤️', '👍', '😂', '🎉', '😮'].map((emoji) => button(emoji, 'react', `data-id="${item.id}" data-emoji="${emoji}" aria-label="${selected.includes(emoji) ? 'Remove' : 'Add'} ${emoji} reaction" aria-pressed="${selected.includes(emoji)}"`)).join('')}</div></details></div><details class="entryMenu"><summary aria-label="Message actions">•••</summary><div class="ex-row">${button('Reply', 'replyTo', `data-id="${item.id}"`)}${deleteControl(item, kind)}</div></details></div></div>`;
  }
  let activeKind = 'message',
    activeKey = '';
  function chat(name, draft) {
    model.activity
      .filter((a) => a.kind === 'messages' && a.target === name)
      .forEach((a) => (a.read = true));
    state.activeChat = name;
    activeKind = 'message';
    activeKey = name;
    state.messages[name] ||= [
      'I saved you a seat for the photo walk tomorrow 📷',
      'Would love that. What time are you heading out?',
      'Around 9, coffee first?',
    ].map((body, i) => ({
      id: crypto.randomUUID(),
      body,
      own: i === 1,
      createdAt: Date.now() - 1200000,
    }));
    if (draft) model.drafts[`message:${name}`] = draft;
    thread('message', name);
  }
  function replies(id, draft) {
    state.activeReplyPost = id;
    activeKind = 'comment';
    activeKey = id;
    state.replies[id] ||= [];
    if (draft) model.drafts[`comment:${id}`] = draft;
    thread('comment', id);
  }
  function thread(kind, key) {
    const draftKey = `${kind}:${key}`,
      items = content(kind, key),
      parent = items.find((m) => m.id === model.replyTo[draftKey]);
    if (model.replyTo[draftKey] && !parent) delete model.replyTo[draftKey];
    modal(
      kind === 'message' ? `Chat with ${e(key)}` : 'Replies',
      `<div class="ex-stack">${kind === 'message' ? `<label class="ex-label">Search this conversation<input id="exMessageSearch" class="demoInput" value="${e(chatSearch)}" placeholder="Search all messages"></label>${button(model.muted[key] ? 'Unmute conversation' : 'Mute conversation', 'muteChat')}` : ''}<p class="ex-hint">Your draft is saved on this device. You can delete your own ${kind === 'message' ? 'messages' : 'comments'} for 15 minutes.</p><div id="chatMessages" class="ex-stack">${items.map((m) => entryMarkup(m, kind, key)).join('') || `<p class="ex-empty">${kind === 'message' ? 'No messages to show.' : 'No comments yet. Start the conversation.'}</p>`}</div>${parent ? `<div class="ex-quote"><p>Replying to: ${e(parent.body)}</p>${button('Cancel reply', 'cancelReply')}</div>` : ''}<form data-form="ex-thread" class="ex-stack"><label class="ex-label">${kind === 'message' ? 'Message' : 'Comment'}<textarea class="demoArea" name="message" maxlength="${kind === 'message' ? 4000 : 2000}" required>${e(model.drafts[draftKey] || '')}</textarea></label><button class="demoButton" type="submit" ${model.drafts[draftKey]?.trim() ? '' : 'disabled'}>Send</button></form></div>`,
    );
    const panel = document.querySelector('.modalPanel');
    panel.classList.add('threadPanel');
    panel.classList.toggle('commentThread', kind === 'comment');
    panel.classList.toggle('emptyThread', !items.length);
    panel.classList.toggle('messageThread', kind === 'message');
    if (kind === 'message') {
      panel.querySelector('.modalHead h2').textContent = key;
      const note = document.createElement('p');
      note.className = 'chatPeerStatus';
      note.textContent = model.muted[key] ? 'Notifications muted' : 'Following each other';
      panel.querySelector('.modalHead').after(note);
    }
    const stack = panel.querySelector('.ex-stack');
    stack.classList.add('threadLayout');
    const messages = stack.querySelector('#chatMessages');
    messages.classList.add('threadMessages');
    const composer = stack.querySelector('form');
    composer.classList.add('threadComposer');
    const options = document.createElement('details');
    options.className = 'threadOptions';
    options.innerHTML =
      kind === 'message'
        ? '<summary>Conversation options</summary>'
        : '<summary>About replies</summary>';
    while (stack.firstElementChild !== messages) options.append(stack.firstElementChild);
    stack.prepend(options);
    if (kind === 'message') {
      const summary = options.querySelector('summary');
      summary.textContent = '•••';
      summary.setAttribute('aria-label', 'Conversation options');
      const body = document.createElement('div');
      body.className = 'conversationToolsBody';
      [...options.children]
        .filter((child) => child !== summary)
        .forEach((child) => body.append(child));
      body.hidden = !options.open;
      stack.prepend(body);
      options.addEventListener('toggle', () => {
        body.hidden = !options.open;
      });
      panel
        .querySelector('.modalHead')
        .insertBefore(options, panel.querySelector('[data-action="closeModal"]'));
      const textarea = composer.querySelector('textarea');
      textarea.setAttribute('aria-label', 'Message');
      textarea.placeholder = 'Write a message…';
      textarea.rows = 1;
      composerObserver.disconnect();
      composerObserver.observe(textarea);
      const label = textarea.closest('label');
      [...label.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .forEach((child) => child.remove());
      textarea.style.height = Math.min(128, Math.max(52, textarea.scrollHeight)) + 'px';
    }
    if (kind === 'message' && chatSearch) options.open = true;
    if (kind === 'message' && !chatSearch) messages.scrollTop = messages.scrollHeight;
    if (kind === 'comment')
      messages.querySelectorAll('.message').forEach((entry, i) => {
        const author = document.createElement('strong');
        author.className = 'commentAuthor';
        author.textContent = items[i].own ? state.displayName : items[i].author || 'Circle member';
        entry.prepend(author);
      });
    save();
  }
  function roomCard(room) {
    return `<div class="ex-card"><strong>${e(room.title)}</strong><p>${e(new Date(room.at).toLocaleString())}</p><p class="ex-hint">${e(room.circle || 'Open room')} · ${room.started ? 'Live in this preview' : 'Scheduled'}</p><div class="ex-row">${button('Add to calendar', 'calendar', `data-title="${e(room.title)}" data-at="${room.at}"`)}${button(room.reminded ? 'Reminder on · turn off' : 'Remind me', 'remind', `data-id="${room.id}"`)}<details class="hostActions"><summary>Host actions</summary>${button(room.started ? 'Open room' : 'Start room now', 'startRoom', `data-id="${room.id}"`)}${!room.started ? button('Edit schedule', 'editRoom', `data-id="${room.id}"`) + button('Cancel room', 'cancelRoom', `data-id="${room.id}"`) : ''}</details></div></div>`;
  }
  function schedule(room) {
    editingRoom = room?.id || null;
    const date = room
      ? new Date(room.at - new Date(room.at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '';
    modal(
      room ? 'Edit scheduled room' : 'Schedule a live room',
      `<form data-form="ex-room" class="ex-stack">${field('Room title', 'title', room?.title || '')}${field('Local date and time', 'date', date, 'datetime-local')}<p class="ex-hint">${e(Intl.DateTimeFormat().resolvedOptions().timeZone)} · reminders appear 15 minutes before.</p><label class="ex-label">Audience<select class="demoInput" name="circle"><option value="">Everyone</option>${state.circles
        .filter((c) => c[4])
        .map((c) => `<option ${room?.circle === c[0] ? 'selected' : ''}>${e(c[0])}</option>`)
        .join('')}</select></label><button class="demoButton">Save scheduled room</button></form>`,
    );
  }
  function activity() {
    const groups = new Map();
    for (const a of model.activity.filter((a) => !activityUnread || !a.read)) {
      const key = `${a.kind}:${a.target}:${new Date(a.at).toDateString()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    modal(
      'Your activity',
      `<div class="ex-stack">${button(activityUnread ? 'Show all activity' : 'Show unread activity', 'activityFilter', `aria-pressed="${activityUnread}"`)}${[...groups.values()].map((items) => `<div class="ex-card"><span class="${items.some((a) => !a.read) ? 'ex-unread' : 'ex-hint'}">${items.some((a) => !a.read) ? '● Unread' : 'Read'}</span><strong>${e(items[0].title)}${items.length > 1 ? ` · ${items.length} updates` : ''}</strong><p>${e(items[0].body)}</p>${button('Open ' + (items[0].kind === 'messages' ? 'conversation' : items[0].kind === 'live' ? 'room' : 'circle'), 'openActivity', `data-id="${items[0].id}"`)}</div>`).join('') || '<p class="ex-empty">You’re all caught up.</p>'}</div>`,
    );
  }
  function onboarding() {
    modal(
      ['Make yourself at home', 'Find your first circles', 'Your next conversation'][onboardStep],
      `<div class="ex-stack"><p class="ex-hint">WELCOME · ${onboardStep + 1} OF 3</p>${
        onboardStep === 0
          ? `<p>Choose a few interests to find your people.</p><div class="ex-row">${['Film', 'Gardening', 'Art', 'Cooking', 'Music', 'Slow living'].map((i) => button(`${model.interests.includes(i) ? '✓ ' : ''}${i}`, 'interest', `data-interest="${i}" aria-pressed="${model.interests.includes(i)}"`)).join('')}</div>${button('Find my circles', 'onboardNext', '', false)}`
          : onboardStep === 1
            ? `<p>Public circles let you join immediately. Private requests wait for the host’s approval.</p>${state.circles
                .filter((c) => model.interests.includes(c[1]))
                .map(
                  (c) =>
                    `<div class="ex-card"><strong>${e(c[0])}</strong><p>${e(c[2])}</p>${button(c[4] ? 'Joined' : state.requestedCircles.has(c[0]) ? 'Request pending' : c[6] ? 'Request to join' : 'Join', 'onboardJoin', `data-name="${e(c[0])}" ${c[4] || state.requestedCircles.has(c[0]) ? 'disabled' : ''}`)}</div>`,
                )
                .join('')}${button('Continue · meet people', 'onboardNext', '', false)}`
            : `<h3>Meet your people</h3>${['Mara Ellis', 'Noah Kim', 'Cleo James'].map((name) => `<div class="ex-card"><strong>${name}</strong>${button(state.following.has(name) ? 'Following' : 'Follow', 'onboardFollow', `data-name="${name}" ${state.following.has(name) ? 'disabled' : ''}`)}</div>`).join('')}<h3>Start a conversation</h3><p>${state.requestedCircles.size ? 'Your private requests are pending. You can start in a public circle while you wait.' : 'Introduce yourself, ask a question, or share something you love.'}</p>${button('Introduce yourself', 'introduce', state.circles.some((c) => c[4]) ? '' : 'disabled', false)}${button('Explore at my own pace', 'finishOnboarding')}`
      }${onboardStep ? button('Back', 'onboardBack') : ''}</div>`,
    );
  }
  function circleTools(membersOnly = false) {
    const name = state.activeCircle;
    const canManage = !!state.circles.find((c) => c[0] === name)?.[7];
    model.roles[name] ||= {
      [state.displayName]: canManage ? 'owner' : 'member',
      'Mara Ellis': 'moderator',
      'Noah Kim': 'member',
    };
    if (!canManage || membersOnly) {
      modal(
        'Rules and members',
        `<div class="ex-stack"><h3>Circle rules</h3><p>${e(model.rules[name] || 'Be kind, respect privacy, and keep conversations relevant.')}</p><h3>Members</h3>${Object.entries(
          model.roles[name],
        )
          .map(
            ([member, role]) =>
              `<div class="ex-card"><strong>${e(member)}</strong><p>${e(role)}</p></div>`,
          )
          .join(
            '',
          )}${canManage ? button('Open permitted host tools', 'circleTools') : '<p class="ex-hint">Only hosts can edit rules, manage roles or schedule events.</p>'}</div>`,
      );
      return;
    }
    modal(
      state.circleTab === 'events' ? 'Plan an event' : 'Circle tools',
      `<div class="ex-stack">${
        state.circleTab !== 'events'
          ? `<form data-form="ex-rules"><label class="ex-label">Circle rules<textarea name="rules" class="demoArea" maxlength="3000">${e(model.rules[name] || 'Be kind, respect privacy, and keep conversations relevant.')}</textarea></label><button class="demoButton">Save rules</button></form><h3>Members and roles</h3><p class="ex-hint">Owner view in this local demo. Native role changes are restricted to the circle owner.</p>${Object.entries(
              model.roles[name],
            )
              .map(
                ([member, role]) =>
                  `<div class="ex-card"><strong>${e(member)}</strong><span>${role}</span>${role !== 'owner' ? button(role === 'moderator' ? 'Remove moderator role' : 'Make moderator', 'role', `data-name="${e(member)}"`) : ''}</div>`,
              )
              .join('')}`
          : ''
      }${state.circleTab === 'events' ? `<h3>Upcoming events</h3>${(model.events[name] || []).map((event) => `<div class="ex-card"><strong>${e(event.title)}</strong><p>${e(new Date(event.at).toLocaleString())}</p>${button(event.going ? 'Going · cancel RSVP' : 'Join event', 'rsvp', `data-id="${event.id}"`)}${button('Add to calendar', 'calendar', `data-title="${e(event.title)}" data-at="${event.at}"`)}${button('Cancel event', 'cancelEvent', `data-id="${event.id}"`)}</div>`).join('')}<form data-form="ex-event" class="ex-stack">${field('Event title', 'title')}${field('Local date and time', 'date', '', 'datetime-local')}<button class="demoButton">Schedule event</button></form>` : ''}</div>`,
    );
  }
  function preferences() {
    modal(
      'Notification preferences',
      `<div class="ex-stack"><p>Choose which circles and conversations can notify you.</p>${state.circles
        .filter((c) => c[4])
        .map(
          (c) =>
            `<label class="ex-row"><input type="checkbox" role="switch" data-circle-pref="${e(c[0])}" ${model.circleNotifications[c[0]] !== false ? 'checked' : ''}>${e(c[0])}</label>`,
        )
        .join(
          '',
        )}${['Mara Ellis', 'Noah Kim', 'Cleo James'].map((name) => `<label class="ex-row"><input type="checkbox" role="switch" data-chat-pref="${name}" ${!model.muted[name] ? 'checked' : ''}>Messages from ${name}</label>`).join('')}<p class="ex-hint">These settings affect this local prototype. The native app saves them to your account.</p></div>`,
    );
  }
  function gifts() {
    const grid = document.querySelector('.giftGridPreview');
    if (!grid) return;
    grid.before(
      Object.assign(document.createElement('div'), {
        className: 'ex-toolbar',
        innerHTML: `<label class="ex-label">Gift category<select class="demoInput" id="exGiftTier"><option value="all">All gifts</option><option value="favourites">Favourites</option><option value="tiny">Tiny · under 25 coins</option><option value="small">Small · 25–99 coins</option><option value="medium">Medium · 100–499 coins</option><option value="large">Large · 500+ coins</option></select></label>`,
      }),
    );
    const filters = document.createElement('details');
    filters.className = 'giftFilters';
    filters.innerHTML = '<summary>Search and filters</summary>';
    const compact =
      (document.querySelector('.device').dataset.textSize !== 'normal' &&
        !!document.querySelector('.device').dataset.textSize) ||
      document.querySelector('.device').clientWidth < 360;
    filters.open = state.giftFiltersOpen ?? !compact;
    filters.addEventListener('toggle', () => {
      state.giftFiltersOpen = filters.open;
    });
    const search = document.querySelector('#giftSearch');
    const toolbar = grid.previousElementSibling;
    filters.append(search.closest('label') || search, toolbar);
    grid.before(filters);
    document.querySelector('#exGiftTier').value = giftTier;
    grid.innerHTML = giftCatalog
      .map(
        (g) =>
          `<div class="giftChoice" data-gift-card="${g.id}"><button class="selectGift" data-action="selectGift" data-id="${g.id}" aria-pressed="${state.selectedGiftId === g.id}"><span class="giftArt">${g.emoji}</span><strong>${e(g.name)}</strong><span>${g.coins.toLocaleString()} coins</span></button><button class="giftFavourite" data-ex="favourite" data-id="${g.id}" aria-label="${model.favourites.includes(g.id) ? 'Remove' : 'Add'} ${e(g.name)} ${model.favourites.includes(g.id) ? 'from' : 'to'} favourites" aria-pressed="${model.favourites.includes(g.id)}">${window.circlesIcon('star')}<span>Favourite</span></button></div>`,
      )
      .join('');
    const selected = giftCatalog.find((g) => g.id === state.selectedGiftId);
    grid.insertAdjacentHTML(
      'afterend',
      `<footer class="giftFooter"><div><strong>${selected ? e(selected.name) + ' · ' + selected.coins + ' coins' : 'Choose a gift'}</strong><p class="demoCopy">Balance · ${state.coins} coins</p><p class="inlineNotice" id="giftFeedback" hidden></p></div><button class="demoButton" data-action="gift" ${selected ? `data-cost="${selected.coins}" data-gift="${e(selected.emoji + ' ' + selected.name)}"` : 'disabled'}>Send</button></footer>`,
    );
    filterGifts();
  }
  function filterGifts() {
    document.querySelectorAll('[data-gift-card]').forEach((el) => {
      const g = giftCatalog.find((g) => g.id === el.dataset.giftCard),
        tier = g.coins < 25 ? 'tiny' : g.coins < 100 ? 'small' : g.coins < 500 ? 'medium' : 'large';
      el.hidden = !(
        g.name.toLowerCase().includes(state.giftSearch) &&
        (giftTier === 'all' ||
          (giftTier === 'favourites' && model.favourites.includes(g.id)) ||
          giftTier === tier)
      );
    });
  }
  document.addEventListener(
    'click',
    (event) => {
      const el = event.target.closest('[data-ex]');
      if (!el) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const action = el.dataset.ex,
        id = el.dataset.id,
        name = el.dataset.name;
      if (action === 'calendar') {
        const start = new Date(Number(el.dataset.at));
        const stamp = (date) =>
          date
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d{3}Z$/, 'Z');
        const title = el.dataset.title.replace(/[\r\n]/g, ' ').replace(/[,;\\]/g, '\\$&');
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Circles//Preview//EN',
          'BEGIN:VEVENT',
          `UID:${crypto.randomUUID()}@circles`,
          `DTSTAMP:${stamp(new Date())}`,
          `DTSTART:${stamp(start)}`,
          `DTEND:${stamp(new Date(start.getTime() + 3600000))}`,
          `SUMMARY:${title}`,
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');
        const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'circles-event.ics';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (action === 'messageOptions') {
        const item = state.messages[state.activeChat]?.find((x) => x.id === id);
        if (!item) return;
        modal(
          'Message options',
          `<p class="demoCopy">${e(item.body || 'Attachment')}</p><div class="settingsRows">${button('Reply', 'replyTo', `data-id="${id}"`)}${deleteControl(item, 'message')}</div><div class="ex-row">${['❤️', '👍', '😂', '🎉', '😮'].map((emoji) => button(emoji, 'react', `data-id="${id}" data-emoji="${emoji}" aria-label="${item.reactions?.includes(emoji) ? 'Remove' : 'Add'} ${emoji} reaction"`)).join('')}</div>`,
        );
        const panel = document.querySelector('.modalPanel'),
          close = panel.querySelector('[data-action="closeModal"]');
        close.removeAttribute('data-action');
        close.dataset.ex = 'backToThread';
        panel.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            thread(activeKind, activeKey);
          }
        });
      } else if (action === 'backToThread') {
        thread(activeKind, activeKey);
      } else if (action === 'settings') {
        modal(
          'Settings and privacy',
          `<div class="settingsRows">${button('Notifications', 'preferences')}${button('Safety and account', 'safetyPreview')}${button('Find circles for my interests', 'onboarding')}<button class="demoButton soft" data-depth="digestPrefs">Catch-up preferences</button><button class="demoButton soft" data-action="buyCoins">Add coins · ${state.coins} coins</button></div>`,
        );
      } else if (action === 'safetyPreview') {
        modal(
          'Safety and account',
          `<div class="ex-stack"><p class="inlineNotice">Simulated preview · no account or moderation changes are sent.</p><h3>Blocked members</h3><p>No blocked members. Blocking controls appear on member profiles.</p>${button('Review sign-in screen', 'authPreview')}${button('Review moderation workspace', 'moderationPreview')}</div>`,
        );
      } else if (action === 'authPreview') {
        modal(
          'Sign in · simulated',
          `<form data-simulated="auth" class="ex-stack"><p class="inlineNotice">Design preview only. Do not enter real credentials.</p><label>Email<input class="demoInput" type="email" autocomplete="off" placeholder="you@example.com" required></label><label>Password<input class="demoInput" type="password" autocomplete="off" required></label><button class="demoButton">Preview sign in</button><p role="status"></p></form>`,
        );
      } else if (action === 'moderationPreview') {
        modal(
          'Moderation · simulated',
          `<div class="ex-stack"><p class="inlineNotice">Sample report · no production data.</p><h3>Reported conversation</h3><p>Reason: Unkind language</p><p>Review the conversation and community rules before deciding.</p>${button('Review removal confirmation', 'moderationConfirm')}${button('Dismiss sample report', 'moderationDone')}</div>`,
        );
      } else if (action === 'moderationConfirm') {
        modal(
          'Remove content? · simulated',
          `<p>This preview shows the confirmation step available to permitted moderators.</p><div class="ex-stack">${button('Cancel', 'moderationPreview')}${button('Simulate removal', 'moderationDone')}</div>`,
        );
      } else if (action === 'moderationDone') {
        modal(
          'Moderation · simulated',
          '<p role="status">Sample report resolved. No production changes were made.</p>',
        );
      } else if (action === 'activity') activity();
      else if (action === 'activityFilter') {
        activityUnread = !activityUnread;
        activity();
      } else if (action === 'openActivity') {
        const a = model.activity.find((a) => a.id === id);
        if (!a) return;
        model.activity
          .filter((i) => i.kind === a.kind && i.target === a.target)
          .forEach((i) => (i.read = true));
        save();
        if (a.kind === 'messages') {
          chatSearch = '';
          chat(a.target);
        } else if (a.kind === 'live') {
          document.querySelector('.modalDemo')?.remove();
          render('live');
        } else {
          document.querySelector('.modalDemo')?.remove();
          openCircle(a.target);
        }
      } else if (action === 'discoveryFilters') discoveryFilters();
      else if (action === 'clearDiscovery') {
        discovery = { privacy: 'all', sort: 'recommended', active: false };
        render('circles');
      } else if (action === 'unreadInbox') {
        unreadOnly = el.dataset.filter === 'unread';
        render('inbox');
      } else if (action === 'muteChat') {
        model.muted[activeKey] = !model.muted[activeKey];
        save();
        thread(activeKind, activeKey);
      } else if (action === 'replyTo') {
        model.replyTo[`${activeKind}:${activeKey}`] = id;
        save();
        thread(activeKind, activeKey);
      } else if (action === 'cancelReply') {
        delete model.replyTo[`${activeKind}:${activeKey}`];
        save();
        thread(activeKind, activeKey);
      } else if (action === 'react') {
        const entry = content(activeKind, activeKey).find((m) => m.id === id);
        if (entry) {
          entry.reactions ||= [];
          entry.reactions = entry.reactions.includes(el.dataset.emoji)
            ? entry.reactions.filter((x) => x !== el.dataset.emoji)
            : [...entry.reactions, el.dataset.emoji];
          save();
          thread(activeKind, activeKey);
        }
      } else if (action === 'scheduleRoom') schedule();
      else if (action === 'editRoom') schedule(model.rooms.find((r) => r.id === id));
      else if (action === 'remind') {
        const room = model.rooms.find((r) => r.id === id);
        room.reminded = !room.reminded;
        save();
        render('live');
      } else if (action === 'cancelRoom') {
        if (!confirm('Cancel this scheduled room?')) return;
        model.rooms = model.rooms.filter((r) => r.id !== id);
        model.activity = model.activity.filter((a) => a.target !== id);
        save();
        render('live');
      } else if (action === 'startRoom') {
        const room = model.rooms.find((r) => r.id === id);
        room.started = true;
        save();
        state.liveSession = {
          title: room.title,
          host: state.displayName,
          seats: [state.displayName],
          requests: [],
          hostMode: true,
          giftsOpen: false,
        };
        renderLive(true);
      } else if (action === 'onboarding') {
        onboardStep = 0;
        onboarding();
      } else if (action === 'interest') {
        const i = el.dataset.interest;
        model.interests = model.interests.includes(i)
          ? model.interests.filter((x) => x !== i)
          : [...model.interests, i];
        save();
        onboarding();
      } else if (action === 'onboardNext') {
        if (!model.interests.length) {
          toast('Choose at least one interest.');
          return;
        }
        onboardStep++;
        onboarding();
      } else if (action === 'onboardBack') {
        onboardStep--;
        onboarding();
      } else if (action === 'onboardJoin') {
        const c = state.circles.find((c) => c[0] === name);
        if (c[6]) state.requestedCircles.add(name);
        else c[4] = true;
        save();
        onboarding();
      } else if (action === 'onboardFollow') {
        state.following.add(name);
        save();
        onboarding();
      } else if (action === 'introduce' || action === 'finishOnboarding') {
        model.onboarded = true;
        save();
        document.querySelector('.modalDemo')?.remove();
        if (action === 'introduce') openComposer(state.circles.find((c) => c[4])?.[0]);
        else render('circles');
      } else if (action === 'circleMembers') circleTools(true);
      else if (action === 'circleTools') circleTools();
      else if (action === 'role') {
        if (!state.circles.find((c) => c[0] === state.activeCircle)?.[7]) return;
        const roles = model.roles[state.activeCircle];
        roles[name] = roles[name] === 'moderator' ? 'member' : 'moderator';
        save();
        circleTools();
      } else if (action === 'circleMute') {
        const name = state.activeCircle;
        model.circleNotifications[name] = model.circleNotifications[name] === false;
        save();
        render('circle');
      } else if (action === 'rsvp') {
        const entry = model.events[state.activeCircle].find((x) => x.id === id);
        entry.going = !entry.going;
        save();
        if (document.querySelector('.modalDemo')) circleTools();
        else render('circle');
      } else if (action === 'cancelEvent') {
        if (!state.circles.find((c) => c[0] === state.activeCircle)?.[7]) return;
        if (!confirm('Cancel this circle event?')) return;
        model.events[state.activeCircle] = model.events[state.activeCircle].filter(
          (x) => x.id !== id,
        );
        save();
        circleTools();
      } else if (action === 'preferences') preferences();
      else if (action === 'favourite') {
        model.favourites = model.favourites.includes(id)
          ? model.favourites.filter((x) => x !== id)
          : [...model.favourites, id];
        save();
        el.setAttribute(
          'aria-label',
          `${model.favourites.includes(id) ? 'Remove' : 'Add'} ${giftCatalog.find((g) => g.id === id)?.name} ${model.favourites.includes(id) ? 'from' : 'to'} favourites`,
        );
        el.setAttribute('aria-pressed', String(model.favourites.includes(id)));
        filterGifts();
      }
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!form.dataset.form?.startsWith('ex-')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const data = new FormData(form);
      if (form.dataset.form === 'ex-thread') {
        const body = String(data.get('message') || '').trim();
        if (!body) return;
        const key = `${activeKind}:${activeKey}`;
        content(activeKind, activeKey).push({
          id: crypto.randomUUID(),
          body,
          own: true,
          createdAt: Date.now(),
          replyToId: model.replyTo[key],
        });
        delete model.replyTo[key];
        model.drafts[key] = '';
        chatSearch = '';
        save();
        thread(activeKind, activeKey);
      } else if (form.dataset.form === 'ex-room' || form.dataset.form === 'ex-event') {
        if (
          form.dataset.form === 'ex-event' &&
          !state.circles.find((c) => c[0] === state.activeCircle)?.[7]
        )
          return;
        const title = String(data.get('title') || '').trim(),
          at = Date.parse(String(data.get('date') || ''));
        if (title.length < 2 || title.length > 120 || !Number.isFinite(at) || at <= Date.now()) {
          window.circlesPreviewError('Use a title of 2–120 characters and a future date.');
          return;
        }
        if (form.dataset.form === 'ex-room') {
          const old = model.rooms.find((r) => r.id === editingRoom);
          model.rooms = model.rooms.filter((r) => r.id !== editingRoom);
          model.rooms.push({
            ...old,
            id: editingRoom || crypto.randomUUID(),
            title,
            at,
            circle: String(data.get('circle') || ''),
            reminded: old?.reminded || false,
          });
          model.rooms.sort((a, b) => a.at - b.at);
          save();
          document.querySelector('.modalDemo')?.remove();
          render('live');
        } else {
          (model.events[state.activeCircle] ||= []).push({
            id: crypto.randomUUID(),
            title,
            at,
            going: false,
          });
          save();
          circleTools();
        }
      } else if (form.dataset.form === 'ex-rules') {
        model.rules[state.activeCircle] = String(data.get('rules') || '').slice(0, 3000);
        save();
        toast('Circle rules saved in this preview.');
        circleTools();
      }
    },
    true,
  );
  document.addEventListener('input', (event) => {
    if (event.target.closest('[data-form=ex-thread]')) {
      if (event.target.tagName === 'TEXTAREA') {
        event.target.style.height = 'auto';
        event.target.style.height = Math.min(128, Math.max(52, event.target.scrollHeight)) + 'px';
      }
      model.drafts[`${activeKind}:${activeKey}`] = event.target.value;
      event.target.closest('form').querySelector('[type=submit]').disabled =
        !event.target.value.trim();
      save();
    }
    if (event.target.id === 'exMessageSearch') {
      chatSearch = event.target.value;
      document.querySelectorAll('[data-entry]').forEach((el) => {
        const item = content(activeKind, activeKey).find((m) => m.id === el.dataset.entry);
        el.hidden = !item.body.toLowerCase().includes(chatSearch.toLowerCase());
      });
    }
    if (event.target.id === 'circleSearch') filter();
    if (event.target.id === 'giftSearch') filterGifts();
    if (event.target.id === 'exInboxSearch') filterInbox();
  });
  document.addEventListener('change', (event) => {
    if (['exPrivacy', 'exSort', 'exActive'].includes(event.target.id)) {
      discovery = {
        privacy: document.querySelector('#exPrivacy').value,
        sort: document.querySelector('#exSort').value,
        active: document.querySelector('#exActive').checked,
      };
      filter();
    }
    if (event.target.dataset.circlePref) {
      model.circleNotifications[event.target.dataset.circlePref] = event.target.checked;
      save();
    }
    if (event.target.dataset.chatPref) {
      model.muted[event.target.dataset.chatPref] = !event.target.checked;
      save();
    }
    if (event.target.id === 'exGiftTier') {
      giftTier = event.target.value;
      filterGifts();
    }
  });
  setInterval(() => {
    document.querySelectorAll('[data-expires]').forEach((el) => {
      const seconds = Math.max(0, Math.ceil((Number(el.dataset.expires) - Date.now()) / 1000));
      el.textContent = `Delete · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    });
    let added = false;
    for (const r of model.rooms) {
      if (
        r.reminded &&
        !r.started &&
        !r.cancelled &&
        r.at > Date.now() &&
        r.at - Date.now() <= 900000 &&
        !model.activity.some((a) => a.reminder === r.id)
      ) {
        model.activity.unshift({
          id: crypto.randomUUID(),
          kind: 'live',
          target: r.id,
          reminder: r.id,
          title: 'Your room starts soon',
          body: r.title,
          at: Date.now(),
          read: false,
        });
        added = true;
      }
    }
    if (added) save();
  }, 1000);
  return { decorate, chat, replies, gifts, labelFields, filter };
};

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-simulated]');
  if (!form) return;
  event.preventDefault();
  form.querySelector('[role="status"]').textContent =
    form.dataset.simulated === 'auth'
      ? 'Simulated sign-in complete. No credentials were sent or saved.'
      : 'Simulated report received. No report was sent.';
});
