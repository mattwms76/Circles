(() => {
  const icon = (name) => {
    const paths = {
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
      edit: '<path d="m4 16 12-12 4 4-12 12-5 1zM13 7l4 4"/>',
      plus: '<path d="M12 4v16M4 12h16"/>',
      photo:
        '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 4 3 3-5 5 7"/>',
      video: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/>',
      camera: '<path d="M8 5 9 3h6l1 2h4v15H4V5z"/><circle cx="12" cy="12" r="4"/>',
      reply: '<path d="M4 4h16v12H9l-5 4z"/>',
      share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8"/>',
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.plus}</svg>`;
  };
  const circleCover = (interest) =>
    ({
      Film: 'photo-1489599849927-2ee91cede3ba',
      Gardening: 'photo-1416879595882-3373a0480b5b',
      Art: 'photo-1513364776144-60967b0f800f',
      Cooking: 'photo-1490645935967-10de6ba17061',
    })[interest] || 'photo-1441974231531-c6227db76b6e';
  const coverURL = (interest) =>
    `https://images.unsplash.com/${circleCover(interest)}?w=900&h=450&fit=crop`;
  const mediaMarkup = (media) =>
    media
      ? media.kind === 'video'
        ? `<video class="postMedia" src="${media.url}" controls playsinline preload="metadata"></video>`
        : `<img class="postMedia" src="${media.url}" alt="Attached photo">`
      : '';
  let composerMedia = null;
  let mediaRequest = 0;
  let mediaPreparing = false;
  const clearMedia = () => {
    mediaRequest++;
    mediaPreparing = false;
    if (composerMedia) URL.revokeObjectURL(composerMedia.url);
    composerMedia = null;
  };
  let experience;
  const page = document.querySelector('.page');
  const tabs = [...document.querySelectorAll('.tab')];
  page.querySelectorAll('.post').forEach((post, index) => {
    post.dataset.postId = `seed-${index}`;
  });
  const seedTimeline = [...page.querySelectorAll('.section')].at(-1).innerHTML;
  const homeMarkup = () =>
    `<header class="top"><div class="brand"><span class="mark"><i class="dot"></i><i class="dot"></i><i class="dot"></i></span>circles</div><div class="topActions"><span id="activitySlot"></span><img class="avatar" src="${escapeHtml(state.avatarUrl)}" alt="Your profile"></div></header><section class="intro"><h1 class="headline">${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, ${escapeHtml(state.displayName.split(' ')[0])}.</h1><p class="sub">A little closer to your people.</p></section><div class="actions"><button class="quick" data-action="writePost">${icon('edit')} Share a thought</button><button class="quick tint" data-action="exploreCircles">${icon('plus')} Find circles</button></div><section class="section compactLiveSection"><button class="compactLiveCard" data-action="joinLive"><span class="liveIndicator"></span><span><small>Live · Kitchen Table Club</small><strong>Good food, better company</strong></span><span aria-hidden="true">›</span></button></section><section class="section"><div class="circleShortcuts">${state.circles
      .filter((c) => c[4])
      .map(
        (c) =>
          `<button class="circleShortcut" data-action="openCircle" data-name="${escapeHtml(c[0])}"><img src="${coverURL(c[1])}" alt="">${escapeHtml(c[0])}</button>`,
      )
      .join('')}</div></section><section class="section timeline">${seedTimeline}</section>`;
  const giftNames = [
    ['Petal', '🌸'],
    ['Cup of tea', '🍵'],
    ['Little star', '⭐️'],
    ['Peach', '🍑'],
    ['Warm bread', '🍞'],
    ['Daisy', '🌼'],
    ['Tiny heart', '💛'],
    ['Coffee date', '☕️'],
    ['Good luck charm', '🍀'],
    ['Sunshine', '☀️'],
    ['Moonbeam', '🌙'],
    ['Fresh flowers', '💐'],
    ['Candlelight', '🕯️'],
    ['Bluebird', '🐦'],
    ['Sweet treat', '🧁'],
    ['Golden hour', '🌅'],
    ['Love note', '💌'],
    ['Vinyl spin', '💿'],
    ['Garden bouquet', '💐'],
    ['Shooting star', '💫'],
    ['Picnic basket', '🧺'],
    ['Paper crane', '🕊️'],
    ['Little lantern', '🏮'],
    ['Lucky cat', '🐈'],
    ['Sea glass', '🫧'],
    ['Sunday cake', '🍰'],
    ['Big hug', '🧸'],
    ['Magic moment', '✨'],
    ['Golden ticket', '🎟️'],
    ['Whole sky', '🌌'],
  ];
  const giftCatalog = Array.from({ length: 300 }, (_, index) => {
    const n = index + 1;
    const [name, emoji] = giftNames[index % giftNames.length];
    const coins =
      n <= 80
        ? 5 + (index % 8)
        : n <= 160
          ? 25 + ((index - 80) % 8) * 5
          : n <= 230
            ? 100 + ((index - 160) % 7) * 20
            : n <= 280
              ? 500 + ((index - 230) % 5) * 100
              : 2000 + ((index - 280) % 5) * 500;
    return {
      id: `gift-${String(n).padStart(3, '0')}`,
      name: `${name} ${String(Math.floor(index / 30) + 1).padStart(2, '0')}`,
      emoji,
      coins,
    };
  });
  const navIcons = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.5 5.1-5.1 2.5 2.5-5.1z"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.8" fill="#fff" stroke="none"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  ];
  tabs.forEach((tab, index) => {
    const icon = tab.querySelector('.tabIcon,.bubble');
    if (icon) icon.innerHTML = navIcons[index];
  });
  const defaultProfilePhoto = document.querySelector('.top .avatar').src;
  let profilePhotoDraft = '';
  let savedProfile = {};
  try {
    savedProfile = JSON.parse(localStorage.getItem('circles-preview-profile') || '{}') || {};
  } catch {
    /* file previews may not expose local storage */
  }
  const state = {
    screen: 'home',
    returnScreen: 'home',
    activeCircle: null,
    displayName: savedProfile.displayName || 'Jules Parker',
    bio: savedProfile.bio ?? 'Collecting little moments and big ideas.',
    avatarUrl:
      typeof savedProfile.avatarUrl === 'string' &&
      /^data:image\/(jpeg|png|webp);base64,/.test(savedProfile.avatarUrl)
        ? savedProfile.avatarUrl
        : defaultProfilePhoto,
    circles: [
      [
        'The Film Room',
        'Film',
        'For people who love the feeling after the credits roll.',
        '18.2k',
        true,
        '🎞️',
      ],
      ['Tiny Gardens', 'Gardening', 'Small spaces, good soil, happy plants.', '9.6k', true, '🌱'],
      ['Sunday Studio', 'Art', 'A soft place to make things and start again.', '7.2k', false, '🎨'],
      [
        'Kitchen Table Club',
        'Cooking',
        'Recipes that feel like someone saved you a seat.',
        '30.8k',
        false,
        '🍋',
      ],
      [
        'Quiet Mornings',
        'Slow living',
        'A private circle for slower starts.',
        '841',
        false,
        '☕️',
        true,
      ],
    ],
    requestedCircles: new Set(),
    circlePosts: {
      'The Film Room': [
        {
          author: 'Mara Ellis',
          body: 'A little reminder that the best part of a film club is hearing what everyone noticed.',
          time: 'Yesterday',
        },
      ],
      'Tiny Gardens': [
        {
          author: 'Mara Ellis',
          body: 'First tomato of the season. She is tiny, she is perfect, and she knows it 🍅',
          time: '2h ago',
        },
      ],
      'Sunday Studio': [
        {
          author: 'Cleo James',
          body: 'What are you making this weekend? Half-finished things welcome here.',
          time: '3h ago',
        },
      ],
      'Kitchen Table Club': [
        {
          author: 'Cleo James',
          body: 'A pot of lemon pasta and a seat saved for anyone who needs one 🍋',
          time: '1h ago',
        },
      ],
      'Quiet Mornings': [
        {
          author: 'Noah Kim',
          body: 'No goals for this morning. Just tea, a window, and a slower start.',
          time: 'Today',
        },
      ],
    },
    following: new Set(['Mara Ellis', 'Noah Kim']),
    followers: new Set(['Cleo James', 'Mara Ellis']),
    likes: false,
    coins: 320,
    messages: {},
    replies: {},
    activeReplyPost: null,
    posts: [],
    attachment: '',
    activeChat: 'Mara Ellis',
    liveSession: null,
    giftSearch: '',
    liveGiftEvents: [],
  };

  Object.values(state.circlePosts).forEach((posts) =>
    posts.forEach((post) => {
      post.id = crypto.randomUUID();
    }),
  );
  const style = document.createElement('style');
  style.textContent = `
    .profilePhotoDemo{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid #ef715b;padding:3px;background:#fff}.profilePhotoRow{display:flex;align-items:center;gap:16px;margin:12px 0 18px}.demoButton:disabled{opacity:.55;cursor:wait}
    button,input,textarea{font:inherit}button{cursor:pointer;border:0}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #ef715b;outline-offset:2px}
    .screenHead{padding:14px 22px 16px}.screenHead h1{font:700 32px/1.05 Georgia,serif;letter-spacing:-.7px;margin:0 0 8px}.screenHead p{font-size:13px;color:#77747b;line-height:19px;margin:0}
    .demoCard{background:#fff;border:1px solid #eae5df;border-radius:20px;padding:15px;margin:0 22px 12px}.demoRow{display:flex;align-items:center;gap:11px}.demoRow .grow{flex:1;min-width:0}.demoTitle{font-size:14px;font-weight:800;margin:0 0 4px}.demoCopy{font-size:11px;line-height:16px;color:#77747b;margin:0}.demoButton{border-radius:99px;background:#ef715b;color:#fff;font-size:11px;font-weight:800;padding:10px 15px;white-space:nowrap}.demoButton.soft{background:#e7e2f4;color:#242326}.demoButton.dark{background:#24212c}.demoInput,.demoArea{width:100%;border:1px solid #eae5df;border-radius:14px;background:white;padding:12px;font-size:13px;margin-bottom:10px}.demoArea{min-height:96px;resize:vertical}.demoFilters{display:flex;gap:8px;overflow:auto;padding:0 22px 14px}.demoChip{border:1px solid #eae5df;border-radius:99px;background:#fff;color:#77747b;padding:8px 12px;font-size:11px;white-space:nowrap}.demoChip.on{background:#24212c;border-color:#24212c;color:#fff}.giftGridPreview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;max-height:230px;overflow:auto;padding:5px 0}.giftGridPreview button{white-space:normal;font-size:9px;line-height:13px;padding:8px 5px}.demoCircle{padding:0;overflow:hidden}.demoCircleHero{height:105px;background:#e7d8cc;display:flex;align-items:end;padding:14px;font-size:24px}.demoCircleInfo{padding:13px}.demoCircleFoot{display:flex;align-items:center;gap:8px;margin-top:10px}.demoCircleFoot .demoButton{margin-left:auto}.demoList{display:grid;gap:10px;padding:0 22px 22px}.demoPerson{display:flex;align-items:center;gap:10px;padding:11px 13px;background:#fff;border:1px solid #eae5df;border-radius:17px}.demoPerson img{width:42px;height:42px;border-radius:50%;object-fit:cover}.demoPerson .grow{flex:1}.liveDemo{min-height:230px;margin:0 22px 14px;border-radius:23px;background:linear-gradient(180deg,#17231924,#141019d9),url('https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=900&h=600&fit=crop') center/cover;color:white;padding:16px;display:flex;flex-direction:column;justify-content:space-between}.liveDemo h2{font:700 23px Georgia,serif;margin:0 0 5px}.liveDemo p{font-size:12px;margin:0;color:#ffffffd9}.liveDemo .demoButton{background:#fff;color:#242326}.walletDemo{background:#24212c;color:white}.walletDemo .demoCopy{color:#d7d2d9}.message{max-width:82%;background:#f0ede9;border-radius:16px 16px 16px 4px;padding:11px 13px;font-size:12px;line-height:18px}.message.mine{margin-left:auto;background:#24212c;color:#fff;border-radius:16px 16px 4px 16px}.modalDemo{position:absolute;inset:0;z-index:5;background:#17131c88;display:flex;align-items:flex-end}.modalPanel{background:#faf7f2;width:100%;max-height:86%;overflow:auto;border-radius:26px 26px 0 0;padding:22px}.modalHead{display:flex;align-items:center;margin-bottom:16px}.modalHead h2{font-size:21px;margin:0;flex:1}.modalHead button{font-size:24px;background:none;color:#777}.toastDemo{position:absolute;z-index:8;left:22px;right:22px;bottom:83px;padding:12px 15px;background:#24212c;color:white;border-radius:14px;font-size:12px;text-align:center;box-shadow:0 8px 25px #0002}.tabs .tab{cursor:pointer;min-width:48px}.tabs .tab:focus-visible{outline:2px solid #ef715b;border-radius:10px}.tabs .tabIcon{pointer-events:none}.tabs svg{display:block;width:23px;height:23px;margin:0 auto 4px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.tabs .bubble{background:#ef715b;width:35px;height:30px;border-radius:11px;margin:0 auto 4px}.tabs .bubble svg{width:15px;height:15px;fill:none;stroke:#fff;stroke-width:2;margin-bottom:0}.tabs .bubble svg circle[fill]{fill:#fff;stroke:none}
  `;
  document.head.append(style);

  const circlesScreen = () =>
    `<header class="screenHead exploreHeading"><h1>Explore circles</h1><p>Find a place that feels like you.</p></header><div style="padding:0 22px"><input class="demoInput" id="circleSearch" placeholder="Search interests and circles" aria-label="Search circles"></div><div class="demoFilters">${['For you', 'Film', 'Gardening', 'Art', 'Cooking', 'Music', 'Slow living'].map((x, i) => `<button class="demoChip ${i === 0 ? 'on' : ''}" data-filter="${x}">${x}</button>`).join('')}</div><div class="sectionHead" style="padding:0 22px"><div><div class="eyebrow">A FEW GOOD PLACES</div><h2 id="circleCount">${state.circles.length} circles to explore</h2></div><button class="demoButton" data-action="createCircle">＋ Create</button></div><div class="demoList" id="circleList">${state.circles.map(circleCard).join('')}</div><div class="sectionHead" style="padding:0 22px"><div><div class="eyebrow">PEOPLE TO MEET</div><h2>Follow your curiosity</h2></div></div>${peopleRows()}`;
  const circleCard = ([name, interest, desc, count, joined, emoji]) =>
    `<article class="demoCard demoCircle" role="button" tabindex="0" data-action="openCircle" data-name="${escapeHtml(name)}" data-circle="${escapeHtml(`${name.toLowerCase()} ${interest.toLowerCase()}`)}"><div class="demoCircleHero">${emoji}</div><div class="demoCircleInfo"><div class="demoTitle">${escapeHtml(name)}</div><p class="demoCopy">${escapeHtml(desc)}</p><div class="demoCircleFoot"><span class="demoCopy">${escapeHtml(interest)} · ${escapeHtml(count)} members</span><button class="demoButton ${joined ? 'soft' : ''}" data-action="join" data-name="${escapeHtml(name)}">${joined ? 'Joined' : 'Join'}</button></div><p class="demoCopy" style="margin-top:9px;color:#ef715b;font-weight:750">Open circle ›</p></div></article>`;
  const peopleRows = () =>
    [
      [
        'Mara Ellis',
        'maramakes',
        'Photography · Art',
        'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=faces',
      ],
      [
        'Noah Kim',
        'noahafterhours',
        'Music · Film',
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop&crop=faces',
      ],
      [
        'Cleo James',
        'cleo.cooks',
        'Cooking · Slow living',
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=160&h=160&fit=crop&crop=faces',
      ],
    ]
      .map(
        ([name, handle, interests, img]) =>
          `<div class="demoPerson"><img src="${img}" alt=""><div class="grow"><div class="demoTitle">${name}</div><p class="demoCopy">@${handle} · ${interests}</p></div><button class="demoButton ${state.following.has(name) ? 'soft' : ''}" data-action="follow" data-name="${name}">${state.following.has(name) ? 'Following' : 'Follow'}</button></div>`,
      )
      .join('');
  const liveScreen = () =>
    `<header class="screenHead"><div class="eyebrow">YOUR CIRCLES, RIGHT NOW</div><h1>Live together.</h1><p>Drop into a room or start one of your own.</p></header><div class="demoCard demoRow"><div class="grow"><div class="demoTitle">Your turn to host?</div><p class="demoCopy">Invite up to three people onto the stage.</p></div><button class="demoButton" data-action="startLive">Go live</button></div>${['Cleo James', 'Mara Ellis', 'Noah Kim'].map((name, i) => `<article class="liveDemo" data-action="watchLive" data-name="${name}" role="button" tabindex="0"><div class="demoRow"><span class="badge"><i class="redDot"></i> LIVE</span><span class="viewers">◉ ${['1.2k', '862', '531'][i]} watching</span></div><div class="demoRow"><div class="grow"><h2>${['Making lemon pasta from scratch', 'A tiny photo walk through my neighbourhood', 'Listening to the whole record, side A'][i]}</h2><p>${['Kitchen Table Club', 'The Film Room', 'Soft Sounds'][i]} · ${name}</p></div><button class="demoButton" data-action="watchLive" data-name="${name}">Watch</button></div></article>`).join('')}`;
  const inboxScreen = () =>
    `<header class="screenHead"><div class="eyebrow">YOUR PEOPLE</div><h1>Inbox</h1><p>Messages with people who follow you back.</p></header><div class="demoList">${[
      [
        'Mara Ellis',
        'I saved you a seat for the photo walk tomorrow 📷',
        '10:48',
        'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=faces',
      ],
      [
        'Noah Kim',
        'You might like the new Sault album. Side B especially.',
        'Yesterday',
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop&crop=faces',
      ],
      [
        'Cleo James',
        'The lemon pasta recipe is in the circle now!',
        'Monday',
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=160&h=160&fit=crop&crop=faces',
      ],
    ]
      .map(
        ([name, msg, time, img]) =>
          `<button class="demoPerson" style="text-align:left;width:100%" data-action="openChat" data-name="${name}"><img src="${img}" alt=""><div class="grow"><div class="demoTitle">${name}</div><p class="demoCopy">${msg}</p></div><span class="demoCopy">${time}</span></button>`,
      )
      .join('')}</div>`;
  const profilePeople = (names) => {
    const known = {
      'Mara Ellis': [
        'maramakes',
        'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=faces',
      ],
      'Noah Kim': [
        'noahafterhours',
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop&crop=faces',
      ],
      'Cleo James': [
        'cleo.cooks',
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=160&h=160&fit=crop&crop=faces',
      ],
    };
    return [...names]
      .map((name) => {
        const [handle, image] = known[name] || ['member', ''];
        return `<div class="demoPerson"><img src="${image}" alt=""><div class="grow"><div class="demoTitle">${escapeHtml(name)}</div><p class="demoCopy">@${escapeHtml(handle)}</p></div></div>`;
      })
      .join('');
  };
  const circleScreen = () => {
    const circle = state.circles.find((item) => item[0] === state.activeCircle);
    if (!circle)
      return `<header class="screenHead"><button class="demoButton soft" data-action="backCircle">‹ Back to circles</button><h1>Circle not found</h1></header>`;
    const [name, interest, description, count, joined, emoji, isPrivate] = circle;
    const requested = state.requestedCircles.has(name);
    const posts = (state.circlePosts[name] || [])
      .map(
        (post) =>
          `<article class="post" data-post-id="${post.id}"><div class="postMeta"><img ${post.isOwn ? 'data-own-avatar' : ''} src="${post.isOwn ? escapeHtml(state.avatarUrl) : 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=faces'}" alt=""><div><div class="author" ${post.isOwn ? 'data-own-author' : ''}>${escapeHtml(post.isOwn ? state.displayName : post.author)}</div><div class="meta">${escapeHtml(name)} · ${escapeHtml(post.time)}</div></div></div><p class="body">${escapeHtml(post.body)}</p>${mediaMarkup(post.media)}<div class="postActions"><button class="demoChip">◯ Reply</button></div></article>`,
      )
      .join('');
    const tab = state.circleTab || 'posts';
    const membership = joined
      ? tab === 'posts'
        ? `<button class="demoButton" data-action="writeCirclePost" data-name="${escapeHtml(name)}">${icon('edit')} Write a post</button>`
        : ''
      : requested
        ? `<button class="demoButton soft" data-action="cancelCircleRequest" data-name="${escapeHtml(name)}">Request pending · cancel</button>`
        : `<button class="demoButton" data-action="join" data-name="${escapeHtml(name)}">${isPrivate ? 'Request to join' : 'Join this circle'}</button>`;
    return `<header class="screenHead circleHeading"><button class="demoButton soft" data-action="backCircle">‹ Back</button><div class="circleCover" style="background-image:linear-gradient(0deg,#15131cdd,transparent),url('${coverURL(interest)}')"><div class="circleIdentity"><img src="${coverURL(interest)}" alt=""><span>${escapeHtml(interest)} · ${isPrivate ? 'Private' : 'Public'}</span></div><h1>${escapeHtml(name)}</h1><p>${escapeHtml(count)} members ${joined ? '· Joined' : ''}</p></div><div class="circleTabs" role="tablist" aria-label="Circle sections">${['posts', 'events', 'about'].map((t) => `<button role="tab" aria-selected="${t === tab}" data-action="circleTab" data-tab="${t}" id="circle-tab-${t}" aria-controls="circle-panel">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>${membership}</header><section class="section" id="circle-panel" role="tabpanel" aria-labelledby="circle-tab-${tab}">${tab === 'posts' ? (joined ? posts || '<div class="ex-empty"><h2>Start the conversation</h2><p>Share a thought, photo or video with your circle.</p></div>' : '<div class="ex-empty"><h2>Come on in</h2><p>Join this circle to read and share posts.</p></div>') : !joined ? '<div class="ex-empty">Join to see events and member information.</div>' : ''}</section>`;
  };
  const profileScreen = () =>
    `<header class="screenHead"><div class="eyebrow">YOUR LITTLE CORNER</div><div class="profilePhotoRow"><img class="profilePhotoDemo" data-own-avatar src="${escapeHtml(state.avatarUrl)}" alt="Your profile photo"><button class="demoButton soft" data-action="editProfilePhoto">Change photo</button></div><h1>${escapeHtml(state.displayName)}</h1><p>@julesmakes · ${escapeHtml(state.bio)}</p></header><div class="demoCard walletDemo demoRow"><div class="grow"><div class="demoCopy">YOUR WALLET</div><div style="font-size:23px;font-weight:850;margin-top:5px">◉ ${state.coins} <span style="font-size:12px;font-weight:500">coins</span></div></div><button class="demoButton" data-action="buyCoins">Add coins</button></div><div class="demoCard demoRow"><div class="grow"><div class="demoTitle">${state.following.size} following</div><p class="demoCopy">Your profile and interests</p></div><button class="demoButton soft" data-action="editProfile">Edit profile</button></div><section class="section"><div class="sectionHead"><div><div class="eyebrow">YOUR COMMUNITY</div><h2>Following · ${state.following.size}</h2></div></div><div class="demoList" style="padding:0">${profilePeople(state.following)}</div></section><section class="section"><div class="sectionHead"><div><div class="eyebrow">YOUR COMMUNITY</div><h2>Followers · ${state.followers.size}</h2></div></div><div class="demoList" style="padding:0">${profilePeople(state.followers)}</div></section><div class="sectionHead" style="padding:8px 22px"><div><div class="eyebrow">YOUR CIRCLES</div><h2>Places you belong</h2></div></div><div class="demoList">${state.circles
      .filter((c) => c[4])
      .map(circleCard)
      .join('')}</div>`;

  // Preview-only post interactions mirror native ownership controls without contacting services.
  let savedPreviewPosts = {};
  try {
    savedPreviewPosts = JSON.parse(localStorage.getItem('circles-preview-saved-posts') || '{}');
  } catch {}
  const savePreviewBookmarks = () => {
    try {
      localStorage.setItem('circles-preview-saved-posts', JSON.stringify(savedPreviewPosts));
    } catch {
      toast('Could not save on this browser.');
    }
  };
  function enhancePosts(screen) {
    page.querySelectorAll('.post[data-post-id]').forEach((article) => {
      if (!article.querySelector('[data-enhance="options"]'))
        article
          .querySelector('.postMeta')
          ?.insertAdjacentHTML(
            'beforeend',
            `<button class="iconButton" data-enhance="options" data-id="${escapeHtml(article.dataset.postId)}" aria-label="Post options">···</button>`,
          );
      const old = article.querySelector('.more');
      if (old) old.remove();
    });
    if (screen === 'home')
      page
        .querySelector('.timeline .sectionHead')
        ?.insertAdjacentHTML(
          'beforeend',
          '<button class="demoButton soft" data-enhance="saved">Saved posts</button>',
        );
    if (screen === 'circle') {
      page
        .querySelector('.circleHeading')
        ?.insertAdjacentHTML(
          'beforeend',
          '<button class="demoButton soft" data-enhance="shareCircle">Share circle</button>',
        );
      if (
        state.circleTab === 'posts' &&
        state.circles.find((c) => c[0] === state.activeCircle)?.[4]
      )
        page
          .querySelector('#circle-panel')
          ?.insertAdjacentHTML(
            'afterbegin',
            '<div class="ex-stack" style="margin-bottom:16px"><input class="demoInput" id="postSearch" aria-label="Search posts in this circle" placeholder="Search this circle’s posts"><select class="demoInput" id="postMediaFilter" aria-label="Filter posts by media"><option value="all">All posts</option><option value="image">Photos</option><option value="video">Videos</option></select><p id="postSearchCount" class="demoCopy" aria-live="polite"></p></div>',
          );
    }
    const observer = new IntersectionObserver((entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) entry.target.pause();
      }),
    );
    page.querySelectorAll('video').forEach((video) => {
      observer.observe(video);
      video.addEventListener('error', () => {
        if (video.nextElementSibling?.dataset.enhance === 'retryVideo') return;
        video.insertAdjacentHTML(
          'afterend',
          '<button class="demoButton soft" data-enhance="retryVideo">Video unavailable · Retry</button>',
        );
      });
    });
    previewMediaObserver?.disconnect();
    previewMediaObserver = observer;
  }
  let previewMediaObserver;
  function previewPostOptions(id) {
    const article = page.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    if (!article) return;
    const own = !!article.querySelector('[data-own-author]');
    const content = article.querySelector('.body')?.textContent || '';
    modal(
      'Post options',
      `<div class="ex-stack"><button class="demoButton" data-enhance="save" data-id="${escapeHtml(id)}">${savedPreviewPosts[id] ? 'Remove from saved posts' : 'Save post'}</button>${own ? `<p class="demoCopy">You can edit or remove your timeline posts at any time while you are a member.</p><textarea class="demoArea" id="editPostBody" aria-label="Edit post text" maxlength="5000">${escapeHtml(content)}</textarea><button class="demoButton soft" data-enhance="edit" data-id="${escapeHtml(id)}">Save changes</button><button class="demoButton soft" data-enhance="delete" data-id="${escapeHtml(id)}">Delete post</button>` : '<button class="demoButton soft" data-action="report">Report post (preview)</button>'}</div>`,
    );
  }
  document.addEventListener(
    'click',
    async (event) => {
      const el = event.target.closest('[data-enhance]');
      if (!el) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const action = el.dataset.enhance,
        id = el.dataset.id;
      if (action === 'copyLink') {
        try {
          await navigator.clipboard.writeText(
            document.querySelector('[aria-label="Post link"]').value,
          );
          toast('Post link copied.');
        } catch {
          toast('Select and copy the link above.');
        }
        return;
      }
      if (action === 'options') return previewPostOptions(id);
      if (action === 'retryVideo') {
        el.previousElementSibling?.load();
        el.remove();
        return;
      }
      if (action === 'shareCircle') {
        const link = `circles://circle/${encodeURIComponent(state.activeCircle)}`;
        modal(
          'Circle link',
          `<p class="demoCopy">Demo circle link. Native links use the connected circle ID.</p><input class="demoInput" readonly aria-label="Circle link" value="${escapeHtml(link)}">`,
        );
        return;
      }
      if (action === 'saved') {
        modal(
          'Saved posts',
          Object.entries(savedPreviewPosts)
            .map(
              ([key, p]) =>
                `<div class="ex-card"><strong>${escapeHtml(p.circle)}</strong><p>${escapeHtml(p.body)}</p><button class="demoButton soft" data-enhance="unsave" data-id="${escapeHtml(key)}">Remove saved post</button></div>`,
            )
            .join('') ||
            '<p class="demoCopy">No saved posts yet. Open a post’s options to save it.</p>',
        );
        return;
      }
      if (action === 'unsave') {
        delete savedPreviewPosts[id];
        savePreviewBookmarks();
        el.closest('.ex-card').remove();
        return;
      }
      const article = page.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
      if (!article) return;
      if (action === 'save') {
        if (savedPreviewPosts[id]) delete savedPreviewPosts[id];
        else
          savedPreviewPosts[id] = {
            body: article.querySelector('.body')?.textContent || 'Media post',
            circle: article.querySelector('.meta')?.textContent || 'Circle',
          };
        savePreviewBookmarks();
        document.querySelector('.modalDemo')?.remove();
        toast('Saved posts updated.');
        return;
      }
      if (!article.querySelector('[data-own-author]')) return;
      if (action === 'delete' && !confirm('Delete this post from the preview timeline?')) return;
      const body = document.querySelector('#editPostBody')?.value.trim() || '';
      if (action === 'edit' && !body && !article.querySelector('.postMedia')) {
        toast('Write something or keep your attachment.');
        return;
      }
      for (const posts of Object.values(state.circlePosts)) {
        const index = posts.findIndex((p) => p.id === id);
        if (index >= 0) {
          if (action === 'delete') posts.splice(index, 1);
          else posts[index].body = body;
        }
      }
      state.posts = state.posts.flatMap((html) => {
        const template = document.createElement('template');
        template.innerHTML = html;
        const post = template.content.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
        if (!post) return [html];
        if (action === 'delete') return [];
        post.querySelector('.body').textContent = body;
        return [template.innerHTML];
      });
      if (action === 'delete') delete savedPreviewPosts[id];
      else if (savedPreviewPosts[id]) savedPreviewPosts[id].body = body;
      savePreviewBookmarks();
      document.querySelector('.modalDemo')?.remove();
      render();
      toast(action === 'delete' ? 'Post deleted.' : 'Post updated.');
    },
    true,
  );
  function filterCircleContent() {
    const input = document.querySelector('#postSearch'),
      select = document.querySelector('#postMediaFilter');
    if (!input || !select) return;
    let count = 0;
    page.querySelectorAll('#circle-panel .post').forEach((post) => {
      const match =
        post
          .querySelector('.body')
          ?.textContent.toLowerCase()
          .includes(input.value.toLowerCase()) &&
        (select.value === 'all' ||
          (select.value === 'video'
            ? !!post.querySelector('video')
            : !!post.querySelector('img.postMedia')));
      post.hidden = !match;
      if (match) count++;
    });
    document.querySelector('#postSearchCount').textContent = `${count} matching posts`;
  }
  document.addEventListener('input', (event) => {
    if (event.target.id === 'postSearch') filterCircleContent();
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'postMediaFilter') filterCircleContent();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) document.querySelectorAll('video').forEach((v) => v.pause());
  });
  function render(screen = state.screen) {
    state.screen = screen;
    const activeScreen = screen === 'circle' ? state.returnScreen : screen;
    tabs.forEach((tab, index) => {
      const active = ['home', 'circles', 'live', 'inbox', 'profile'][index] === activeScreen;
      tab.classList.toggle('active', active);
      tab.setAttribute('role', 'button');
      tab.setAttribute('tabindex', '0');
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });
    page.scrollTop = 0;
    page.innerHTML =
      screen === 'home'
        ? homeMarkup()
        : screen === 'circles'
          ? circlesScreen()
          : screen === 'live'
            ? liveScreen()
            : screen === 'inbox'
              ? inboxScreen()
              : screen === 'circle'
                ? circleScreen()
                : profileScreen();
    const greeting = page.querySelector('.intro .sub');
    if (greeting) greeting.textContent = 'A little closer to your people.';
    if (screen === 'home' && state.posts.length) {
      const section = [...page.querySelectorAll('.section')].at(-1);
      if (section) for (const post of state.posts) section.insertAdjacentHTML('beforeend', post);
    }
    page.querySelectorAll('.top .avatar,[data-own-avatar]').forEach((image) => {
      image.src = state.avatarUrl;
      image.alt = 'Your profile photo';
    });
    page.querySelectorAll('[data-own-author]').forEach((label) => {
      label.textContent = state.displayName;
    });
    experience?.decorate(screen);
    enhancePosts(screen);
    makePreviewControlsAccessible();
    document.querySelector('.note').textContent =
      `Circles · ${screen === 'circle' ? state.activeCircle : screen === 'circles' ? 'explore' : screen} screen · local prototype`;
  }
  function toast(message) {
    document.querySelector('.toastDemo')?.remove();
    const el = document.createElement('div');
    el.className = 'toastDemo';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = message;
    document.querySelector('.device').append(el);
    setTimeout(() => el.remove(), 2200);
  }
  function openCircle(name) {
    if (state.screen !== 'circle') state.returnScreen = state.screen;
    state.activeCircle = name;
    state.circleTab = 'posts';
    render('circle');
  }
  function modal(title, content) {
    document.querySelector('.modalDemo')?.remove();
    const el = document.createElement('div');
    el.className = 'modalDemo';
    el.innerHTML = `<section class="modalPanel" role="dialog" aria-modal="true" aria-label="${title.replace(/<[^>]*>/g, '')}"><header class="modalHead"><h2>${title}</h2><button data-action="closeModal" aria-label="Close">×</button></header>${content}</section>`;
    document.querySelector('.device').append(el);
    experience?.labelFields();
    el.querySelector('[data-action="closeModal"]')?.focus();
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        clearMedia();
        el.remove();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...el.querySelectorAll(
          'button:not(:disabled),input:not([type="file"]),textarea,select,summary,[tabindex="0"]',
        ),
      ].filter((control) => control.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
  }
  const deleteWindowMs = 15 * 60 * 1000;
  const canDelete = (item) =>
    item?.own &&
    Number.isFinite(item.createdAt) &&
    Date.now() >= item.createdAt &&
    Date.now() < item.createdAt + deleteWindowMs;
  const deleteControl = (item, kind) =>
    canDelete(item)
      ? `<button class="demoChip" style="display:block;margin-top:8px" data-action="deleteContent" data-kind="${kind}" data-id="${item.id}" data-expires="${item.createdAt + deleteWindowMs}" aria-label="Delete ${kind} for everyone">Delete</button>`
      : '';
  function openChat(name, draft = '') {
    if (experience) return experience.chat(name, draft);
    state.activeChat = name;
    state.messages[name] ||= [
      'I saved you a seat for the photo walk tomorrow 📷',
      'Would love that. What time are you heading out?',
      'Around 9, coffee first?',
    ].map((body, i) => ({
      id: crypto.randomUUID(),
      body,
      own: i === 1,
      createdAt: Date.now() - 20 * 60 * 1000,
    }));
    modal(
      `Chat with ${escapeHtml(name)}`,
      `<p class="demoCopy" style="margin-bottom:12px">You can delete your own messages for 15 minutes after sending.</p><div id="chatMessages" style="display:grid;gap:10px;min-height:190px;margin-bottom:16px">${state.messages[name].map((message) => `<div class="message ${message.own ? 'mine' : ''}">${escapeHtml(message.body)}${deleteControl(message, 'message')}</div>`).join('')}</div><form data-form="message" class="demoRow"><input class="demoInput" name="message" value="${escapeHtml(draft)}" placeholder="Write a message…" aria-label="Write a message" maxlength="4000" style="margin:0"><button class="demoButton" type="submit">Send</button></form>`,
    );
  }
  function openReplies(postId, draft = '') {
    if (experience) return experience.replies(postId, draft);
    state.activeReplyPost = postId;
    state.replies[postId] ||= [];
    modal(
      'Replies',
      `<p class="demoCopy" style="margin-bottom:12px">You can delete your own comments for 15 minutes after posting.</p><div style="display:grid;gap:10px;margin-bottom:16px">${state.replies[postId].map((comment) => `<div class="message"><b>${escapeHtml(state.displayName)}</b><p>${escapeHtml(comment.body)}</p>${deleteControl(comment, 'comment')}</div>`).join('') || '<p class="demoCopy">No replies yet. Say hello first.</p>'}</div><form data-form="reply" class="demoRow"><input class="demoInput" name="message" value="${escapeHtml(draft)}" placeholder="Write a reply…" aria-label="Write a reply" maxlength="2000" style="margin:0"><button class="demoButton" type="submit">Send</button></form>`,
    );
  }
  setInterval(
    () =>
      document.querySelectorAll('[data-expires]').forEach((button) => {
        if (Date.now() >= Number(button.dataset.expires)) button.remove();
      }),
    1000,
  );
  function openLive(name = 'Cleo James') {
    state.liveSession = {
      title: `${name} is live`,
      host: name,
      seats: [name],
      requests: [],
      hostMode: false,
      giftsOpen: false,
    };
    renderLive();
  }
  function renderLive(hostMode = Boolean(state.liveSession?.hostMode)) {
    if (!state.liveSession) return;
    state.liveSession.hostMode = hostMode;
    const live = state.liveSession;
    const seats = live.seats
      .map(
        (person, index) =>
          `<span class="demoChip on">${index === 0 ? 'HOST' : 'CO-HOST'} · ${escapeHtml(person)}</span>`,
      )
      .join('');
    const requestQueue = live.requests
      .map(
        (request, index) =>
          `<div class="demoPerson"><span class="grow"><b>${escapeHtml(request.name)}</b><p class="demoCopy">Asked to join the stage</p></span><button class="demoButton soft" data-action="declineSeat" data-index="${index}">Decline</button><button class="demoButton" data-action="acceptSeat" data-index="${index}" ${live.seats.length >= 4 ? 'disabled' : ''}>Accept</button></div>`,
      )
      .join('');
    const gifts = live.giftsOpen
      ? `<input class="demoInput" id="giftSearch" value="${escapeHtml(state.giftSearch)}" placeholder="Find any of 300 gifts" aria-label="Search gifts"><div class="giftGridPreview">${giftCatalog
          .filter((gift) => gift.name.toLowerCase().includes(state.giftSearch.toLowerCase()))
          .map(
            (gift) =>
              `<button class="demoChip" data-action="gift" data-cost="${gift.coins}" data-gift="${gift.emoji} ${gift.name}">${gift.emoji} ${escapeHtml(gift.name)}<br>◉ ${gift.coins}</button>`,
          )
          .join('')}</div>`
      : '';
    const hostControls = hostMode
      ? `<p class="demoCopy">Host controls · ${live.seats.length}/4 stage seats</p><button class="demoButton soft" data-action="simulateSeatRequest" ${live.seats.length + live.requests.length >= 4 ? 'disabled' : ''}>Simulate viewer request</button>${requestQueue || '<p class="demoCopy" style="margin-top:8px">No requests waiting.</p>'}`
      : `<div class="demoRow"><button class="demoButton soft" data-action="requestSeat" ${live.requested ? 'disabled' : ''}>${live.requested ? 'Request sent' : '＋ Ask to join'}</button><span class="demoCopy grow">${live.requested ? 'Waiting for the host' : 'Watching live'}</span></div><button class="demoChip" data-action="hostView">Preview host controls</button>`;
    modal(
      'Live preview',
      `<p class="previewNotice">Local simulation · no Agora connection or other users are involved.</p><div class="liveDemo" style="margin:0 0 12px;min-height:160px"><div class="demoRow"><span class="badge"><i class="redDot"></i> LIVE</span><span class="viewers">◉ 1.2k watching</span></div><div><h2>${escapeHtml(live.title)}</h2><p>Stage · ${live.seats.length}/4</p></div></div><div class="demoRow" style="flex-wrap:wrap">${seats}</div><div style="display:flex;gap:8px;margin:12px 0">${hostControls}</div><button class="demoButton" data-action="openGifts">🎁 ${live.giftsOpen ? 'Hide' : 'Browse'} 300 gifts · ◉ ${state.coins}</button>${gifts}<div style="margin-top:10px">${state.liveGiftEvents
        .slice(0, 3)
        .map(
          (event) =>
            `<p class="demoCopy">${event.emoji} ${escapeHtml(event.name)} · ${event.coins} coins</p>`,
        )
        .join('')}</div><button class="demoChip" data-action="closeLive">Close room</button>`,
    );
    experience?.gifts();
  }

  tabs.forEach((tab, index) =>
    tab.addEventListener('click', () => {
      state.activeCircle = null;
      render(['home', 'circles', 'live', 'inbox', 'profile'][index]);
    }),
  );
  tabs.forEach((tab, index) =>
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        state.activeCircle = null;
        render(['home', 'circles', 'live', 'inbox', 'profile'][index]);
      }
    }),
  );
  document.addEventListener('click', (event) => {
    const target = event.target.closest(
      '[data-action], [data-filter], .link, .quick, .postActions span, .live, .play, .circle, .avatar, .more, .postActions button',
    );
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'circleTab') {
      state.circleTab = target.dataset.tab;
      render('circle');
      document.querySelector(`[data-tab="${state.circleTab}"]`)?.focus();
      return;
    }
    if (action === 'exploreCircles') {
      render('circles');
      return;
    }
    if (action === 'writePost') {
      openComposer();
      return;
    }
    if (action === 'joinLive') {
      openLive();
      return;
    }
    if (action === 'removeMedia') {
      clearMedia();
      state.attachment = '';
      document.querySelector('#mediaPreview').innerHTML = '';
      document.querySelector('#attachmentName').textContent = '';
      updatePublishButton();
      return;
    }

    if (target.dataset.filter) {
      document
        .querySelectorAll('[data-filter]')
        .forEach((x) => x.classList.toggle('on', x === target));
      filterCircles();
      return;
    }
    if (target.classList.contains('quick')) {
      if (target.textContent.includes('thought')) openComposer();
      else render('live');
      return;
    }
    if (target.classList.contains('link')) {
      if (target.textContent.includes('Explore')) render('circles');
      else if (target.textContent.includes('all')) render('live');
      else if (target.textContent.includes('post')) openComposer();
      return;
    }
    if (target.classList.contains('avatar')) {
      render('profile');
      return;
    }
    if (target.classList.contains('live') || target.classList.contains('play')) {
      openLive('Cleo James');
      return;
    }
    if (action === 'openCircle') {
      openCircle(target.dataset.name);
      return;
    }
    if (target.classList.contains('circle')) {
      const name = target.querySelector('.circleName')?.textContent || 'Your circle';
      openCircle(name);
      return;
    }
    if (target.classList.contains('more')) {
      modal(
        'Keep Circles kind',
        `<p class="demoCopy" style="margin-bottom:14px">This prototype cannot submit a report to moderation.</p><button class="demoButton soft" data-action="report">Dismiss preview</button>`,
      );
      return;
    }
    if (target.closest('.postActions')) {
      const label = target.textContent;
      if (label.includes('♥')) {
        state.likes = !state.likes;
        target.textContent = state.likes ? '♥　285' : '♥　284';
        toast(state.likes ? 'You liked this post.' : 'Like removed.');
      } else if (label.includes('Reply'))
        openReplies(target.closest('[data-post-id]')?.dataset.postId || 'seed-0');
      else {
        const article = target.closest('[data-post-id]');
        const link = `circles://post/${encodeURIComponent(article?.dataset.postId || 'seed-0')}`;
        modal(
          'Share post',
          `<p class="demoCopy">Open in Circles. Circle membership is required. This preview uses demo IDs.</p><input class="demoInput" aria-label="Post link" readonly value="${escapeHtml(link)}"><button class="demoButton" data-enhance="copyLink">Copy link</button>`,
        );
      }
      return;
    }
    if (action === 'deleteContent') {
      const isMessage = target.dataset.kind === 'message';
      const key = isMessage ? state.activeChat : state.activeReplyPost;
      const collection = isMessage ? state.messages : state.replies;
      const item = collection[key]?.find((entry) => entry.id === target.dataset.id);
      if (!canDelete(item)) {
        target.remove();
        toast('The 15-minute deletion window has ended.');
        return;
      }
      if (!window.confirm(`Delete this ${isMessage ? 'message' : 'comment'} for everyone?`)) return;
      if (!canDelete(item)) {
        target.remove();
        toast('The 15-minute deletion window has ended.');
        return;
      }
      const draft = document.querySelector('.modalDemo [name="message"]')?.value || '';
      collection[key] = collection[key]
        .filter((entry) => entry.id !== item.id)
        .map((entry) => (entry.replyToId === item.id ? { ...entry, replyToId: null } : entry));
      if (isMessage) openChat(key, draft);
      else openReplies(key, draft);
      toast(`${isMessage ? 'Message' : 'Comment'} deleted in this local preview.`);
    } else if (action === 'createCircle')
      modal(
        'Create a circle',
        `<form data-form="circle"><input class="demoInput" name="name" required placeholder="Circle name"><input class="demoInput" name="interest" required placeholder="Interest"><textarea class="demoArea" name="description" placeholder="What brings your people together?"></textarea><label class="demoCopy"><input type="checkbox" name="private"> Make this circle private</label><button class="demoButton" style="width:100%;margin-top:14px">Create your circle</button></form>`,
      );
    else if (action === 'join') {
      const c = state.circles.find((c) => c[0] === target.dataset.name);
      if (c && !c[4]) {
        if (c[6]) {
          state.requestedCircles.add(c[0]);
          toast('Your request is with the circle host.');
        } else {
          c[4] = true;
          toast(`You joined ${c[0]}.`);
        }
        render(state.screen);
      }
    } else if (action === 'cancelCircleRequest') {
      state.requestedCircles.delete(target.dataset.name);
      render('circle');
      toast('Your request was cancelled.');
    } else if (action === 'leaveCircle') {
      const c = state.circles.find((c) => c[0] === target.dataset.name);
      if (c) c[4] = false;
      render('circle');
      toast(`You left ${target.dataset.name}.`);
    } else if (action === 'backCircle') {
      const returnTo = state.returnScreen;
      state.activeCircle = null;
      render(returnTo);
    } else if (action === 'writeCirclePost') {
      openComposer(target.dataset.name);
    } else if (action === 'follow') {
      const n = target.dataset.name;
      if (state.following.has(n)) {
        state.following.delete(n);
        target.textContent = 'Follow';
        target.classList.remove('soft');
        toast(`You unfollowed ${n}.`);
      } else {
        state.following.add(n);
        target.textContent = 'Following';
        target.classList.add('soft');
        toast(`You’re following ${n}.`);
      }
    } else if (action === 'startLive')
      modal(
        'Go live',
        `<p class="demoCopy" style="margin-bottom:14px">Your room can have you and up to three co-hosts. Viewers can request a seat.</p><input id="liveTitle" class="demoInput" placeholder="What are we hanging out for?"><button class="demoButton" style="width:100%" data-action="confirmLive">Start livestream</button>`,
      );
    else if (action === 'confirmLive') {
      const title = document.querySelector('#liveTitle')?.value || 'A little live moment';
      state.liveSession = {
        title,
        host: state.displayName,
        seats: [state.displayName],
        requests: [],
        hostMode: true,
        giftsOpen: false,
      };
      state.liveGiftEvents = [];
      renderLive(true);
    } else if (action === 'watchLive') openLive(target.dataset.name || 'Cleo James');
    else if (action === 'requestSeat') {
      if (state.liveSession) {
        state.liveSession.requested = true;
        state.liveSession.requests.push({ name: state.displayName });
        renderLive(false);
        toast('Local demo request added to the host queue.');
      }
    } else if (action === 'hostView') {
      renderLive(true);
    } else if (action === 'simulateSeatRequest') {
      if (
        !state.liveSession ||
        state.liveSession.seats.length + state.liveSession.requests.length >= 4
      )
        return;
      state.liveSession.requests.push({
        name:
          ['Mara Ellis', 'Noah Kim', 'Cleo James'].find(
            (name) =>
              !state.liveSession.seats.includes(name) &&
              !state.liveSession.requests.some((request) => request.name === name),
          ) || 'A guest',
      });
      renderLive(true);
    } else if (action === 'acceptSeat' || action === 'declineSeat') {
      const index = Number(target.dataset.index);
      const request = state.liveSession?.requests[index];
      if (!request) return;
      if (action === 'acceptSeat') {
        if (state.liveSession.seats.length >= 4) {
          toast('The stage is full.');
          return;
        }
        state.liveSession.seats.push(request.name);
      }
      state.liveSession.requests.splice(index, 1);
      renderLive(true);
      toast(action === 'acceptSeat' ? `${request.name} joined the stage.` : 'Request declined.');
    } else if (action === 'openGifts') {
      state.liveSession.giftsOpen = !state.liveSession.giftsOpen;
      if (!state.liveSession.giftsOpen) state.giftSearch = '';
      renderLive(state.liveSession.hostMode);
    } else if (action === 'gift') {
      const cost = Number(target.dataset.cost);
      if (state.coins < cost) {
        toast('Add coins in your profile to send this gift.');
        return;
      }
      state.coins -= cost;
      state.liveGiftEvents.unshift({
        name: target.dataset.gift,
        emoji: target.dataset.gift.split(' ')[0],
        coins: cost,
      });
      state.liveGiftEvents = state.liveGiftEvents.slice(0, 8);
      renderLive(state.liveSession.hostMode);
      toast(`Local gift sent · ${state.coins} preview coins left.`);
    } else if (action === 'closeLive') {
      state.liveSession = null;
      state.liveGiftEvents = [];
      document.querySelector('.modalDemo')?.remove();
    } else if (action === 'buyCoins') {
      modal(
        'Add coins',
        `<p class="demoCopy" style="margin-bottom:12px">Preview wallet · balance ${state.coins} coins</p><div class="demoList" style="padding:0">${[
          [100, 'Pocketful'],
          [500, 'Good company'],
          [1200, 'Big-hearted'],
        ]
          .map(
            ([coins, label]) =>
              `<button class="demoPerson" data-action="addCoins" data-coins="${coins}"><span class="grow"><b>${label}</b><p class="demoCopy">◉ ${coins} coins</p></span><span class="demoButton soft">Select</span></button>`,
          )
          .join('')}</div>`,
      );
    } else if (action === 'addCoins') {
      state.coins += Number(target.dataset.coins);
      toast(`${target.dataset.coins} demo coins added.`);
      modal(
        'Coins added',
        `<p>You now have <b>◉ ${state.coins} coins</b> in your preview wallet.</p><button class="demoButton" data-action="closeModal">Done</button>`,
      );
    } else if (action === 'editProfile' || action === 'editProfilePhoto') {
      openProfileEditor();
      if (action === 'editProfilePhoto') document.querySelector('#profilePhotoPicker').click();
    } else if (action === 'chooseProfilePhoto')
      document.querySelector('#profilePhotoPicker')?.click();
    else if (action === 'saveProfile') {
      const nextProfile = {
        displayName: document.querySelector('#profileName')?.value.trim() || state.displayName,
        bio: document.querySelector('#profileBio')?.value.trim() || '',
        avatarUrl: profilePhotoDraft,
      };
      try {
        localStorage.setItem('circles-preview-profile', JSON.stringify(nextProfile));
      } catch {
        toast('Could not save in this browser. Free some browser storage and try again.');
        return;
      }
      Object.assign(state, nextProfile);
      document.querySelector('.modalDemo')?.remove();
      render(state.screen);
      toast('Prototype profile saved in this browser.');
    } else if (action === 'openChat') openChat(target.dataset.name);
    else if (action === 'publish') {
      if (mediaPreparing) return;
      const body = document.querySelector('.modalDemo textarea')?.value.trim() || '';
      if (!body && !state.attachment) {
        toast('Write something or attach media first.');
        return;
      }
      const circle = document.querySelector('.modalDemo select')?.value || 'Your circle';
      if (!state.circles.some((c) => c[0] === circle && c[4])) {
        toast('Choose a circle you belong to.');
        return;
      }
      const postId = crypto.randomUUID();
      state.posts.unshift(
        `<article class="post" data-post-id="${postId}"><div class="postMeta"><img data-own-avatar src="${escapeHtml(state.avatarUrl)}" alt="Your profile photo"><div><div class="author" data-own-author>${escapeHtml(state.displayName)}</div><div class="meta">${escapeHtml(circle)} · now</div></div></div><p class="body">${escapeHtml(body)}</p>${mediaMarkup(composerMedia)}<div class="postActions"><span>♡　0</span><span>◯　Reply</span><span>↗　Share</span></div></article>`,
      );
      state.circlePosts[circle] ||= [];
      state.circlePosts[circle].unshift({
        id: postId,
        media: composerMedia,
        author: state.displayName,
        isOwn: true,
        body: body || `Shared ${state.attachment}`,
        time: 'now',
      });
      state.attachment = '';
      composerMedia = null;
      document.querySelector('.modalDemo')?.remove();
      render(state.screen === 'circle' ? 'circle' : 'home');
      toast(`Added to ${circle} in this local preview.`);
    } else if (action === 'report') {
      document.querySelector('.modalDemo')?.remove();
      toast('Preview only: no report was submitted.');
    } else if (action === 'closeModal') {
      clearMedia();
      document.querySelector('.modalDemo')?.remove();
      if (state.screen === 'circle') render('circle');
    }
  });
  function openProfileEditor() {
    profilePhotoDraft = state.avatarUrl;
    modal(
      'Edit profile',
      `<div class="profilePhotoRow"><img class="profilePhotoDemo" id="profilePhotoPreview" src="${escapeHtml(profilePhotoDraft)}" alt="Profile photo preview"><button class="demoButton soft" data-action="chooseProfilePhoto">Change photo</button></div><input type="file" id="profilePhotoPicker" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo" hidden><p class="demoCopy" id="profilePhotoStatus" role="status" style="margin-bottom:14px">JPG, PNG or WebP · up to 5 MB. Saved only in this browser preview.</p><input class="demoInput" id="profileName" value="${escapeHtml(state.displayName)}" aria-label="Display name"><textarea class="demoArea" id="profileBio" aria-label="Bio">${escapeHtml(state.bio)}</textarea><div class="demoRow"><button class="demoButton" data-action="saveProfile">Save changes</button><button class="demoButton soft" data-action="closeModal">Cancel</button></div>`,
    );
  }
  async function chooseProfilePhoto(input) {
    const file = input.files?.[0];
    if (!file) return;
    const panel = input.closest('.modalPanel');
    const status = panel.querySelector('#profilePhotoStatus');
    const controls = panel.querySelectorAll(
      '[data-action="saveProfile"],[data-action="chooseProfilePhoto"]',
    );
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('Choose a JPG, PNG, or WebP photo.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a profile photo smaller than 5 MB.');
      controls.forEach((button) => (button.disabled = true));
      input.disabled = true;
      status.textContent = 'Preparing your photo…';
      const url = URL.createObjectURL(file);
      let photo;
      try {
        photo = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () =>
            reject(new Error('This photo could not be opened. Try another image.'));
          image.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      if (!panel.isConnected) return;
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare the photo.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 400, 400);
      const side = Math.min(photo.naturalWidth, photo.naturalHeight);
      context.drawImage(
        photo,
        (photo.naturalWidth - side) / 2,
        (photo.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        400,
        400,
      );
      profilePhotoDraft = canvas.toDataURL('image/jpeg', 0.85);
      panel.querySelector('#profilePhotoPreview').src = profilePhotoDraft;
      status.textContent = 'Photo ready. Save changes to keep it, or cancel to discard.';
    } catch (error) {
      if (panel.isConnected) status.textContent = error.message || 'Could not prepare this photo.';
    } finally {
      controls.forEach((button) => (button.disabled = false));
      input.disabled = false;
      input.value = '';
    }
  }
  function updatePublishButton() {
    const publish = document.querySelector('[data-action="publish"]');
    if (publish)
      publish.disabled =
        mediaPreparing ||
        !state.circles.some((c) => c[4]) ||
        (!document.querySelector('.composerBody')?.value.trim() && !state.attachment);
  }
  function openComposer(circleName) {
    clearMedia();
    state.attachment = '';
    modal(
      'Create a post',
      `<div class="composerScroll"><label class="ex-label">Posting to<select class="demoInput" aria-label="Choose a circle">${state.circles
        .filter((c) => c[4])
        .map((c) => `<option ${c[0] === circleName ? 'selected' : ''}>${escapeHtml(c[0])}</option>`)
        .join(
          '',
        )}</select></label><textarea class="demoArea composerBody" name="body" aria-label="Post text" placeholder="What’s on your mind?" maxlength="5000"></textarea><div id="mediaPreview"></div><div class="attachmentToolbar">${[
        ['image', 'photo', 'Photo'],
        ['gif', 'photo', 'GIF'],
        ['video', 'video', 'Upload video'],
        ['video', 'camera', 'Record video'],
      ]
        .map(
          ([kind, glyph, label]) =>
            `<button class="demoChip" data-action="media" data-kind="${kind}" ${glyph === 'camera' ? 'data-source="camera"' : ''}>${icon(glyph)}${label}</button>`,
        )
        .join(
          '',
        )}</div><p class="ex-hint" id="attachmentName" role="status"></p><p class="ex-hint">Videos up to 2 minutes · 25 MB maximum.</p><input type="file" id="mediaPicker" hidden></div><footer class="composerFooter"><button class="demoButton" data-action="publish" disabled>Share with your circle</button></footer>`,
    );
    document.querySelector('.modalPanel').classList.add('composerPanel');
    document.querySelector('.composerBody').addEventListener('input', updatePublishButton);
  }
  function escapeHtml(value) {
    return value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  }
  function filterCircles() {
    if (experience) return experience.filter();
    const query = (document.querySelector('#circleSearch')?.value ?? '').trim().toLowerCase();
    const interest = document.querySelector('[data-filter].on')?.dataset.filter ?? 'For you';
    const matches = state.circles.filter(
      ([name, category, desc]) =>
        (interest === 'For you' || category === interest) &&
        `${name} ${desc} ${category}`.toLowerCase().includes(query),
    );
    document
      .querySelectorAll('.demoCircle')
      .forEach(
        (el) =>
          (el.style.display = matches.some(([name]) => name === el.dataset.name) ? '' : 'none'),
      );
    const title = document.querySelector('#circleCount');
    if (title)
      title.textContent = `${matches.length} ${matches.length === 1 ? 'circle' : 'circles'} to explore`;
  }
  document.addEventListener('input', (event) => {
    if (event.target.id === 'circleSearch') {
      filterCircles();
    }
    if (event.target.id === 'giftSearch') {
      state.giftSearch = event.target.value.toLowerCase();
      document
        .querySelectorAll('.giftGridPreview [data-action=gift]')
        .forEach(
          (el) =>
            (el.style.display = el.dataset.gift.toLowerCase().includes(state.giftSearch)
              ? ''
              : 'none'),
        );
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'profilePhotoPicker') void chooseProfilePhoto(event.target);
    if (event.target.id === 'mediaPicker' && event.target.files?.[0]) {
      void prepareMedia(event.target.files[0]);
    }
  });
  async function prepareMedia(file) {
    const panel = document.querySelector('.composerPanel');
    if (!panel) return;
    const status = panel.querySelector('#attachmentName');
    const request = ++mediaRequest;
    if (!/^(image|video)\//.test(file.type) || file.size > 25 * 1024 * 1024) {
      mediaPreparing = false;
      status.textContent = 'Choose a photo, GIF or video under 25 MB.';
      updatePublishButton();
      return;
    }
    mediaPreparing = true;
    status.textContent = 'Preparing attachment…';
    updatePublishButton();
    const url = URL.createObjectURL(file),
      kind = file.type.startsWith('video/') ? 'video' : 'image';
    try {
      if (kind === 'video')
        await new Promise((resolve, reject) => {
          const video = document.createElement('video');
          const timer = setTimeout(() => {
            video.removeAttribute('src');
            video.load();
            reject(new Error('Could not read this video. Try another file.'));
          }, 10000);
          const done = (error) => {
            clearTimeout(timer);
            video.removeAttribute('src');
            video.load();
            error ? reject(error) : resolve();
          };
          video.onloadedmetadata = () =>
            done(
              !Number.isFinite(video.duration) || video.duration > 120
                ? new Error('Choose a video up to 2 minutes long.')
                : null,
            );
          video.onerror = () => done(new Error('This video could not be opened.'));
          video.src = url;
        });
      if (!panel.isConnected || request !== mediaRequest) {
        URL.revokeObjectURL(url);
        return;
      }
      clearMedia();
      composerMedia = { url, kind };
      state.attachment = file.name;
      panel.querySelector('#mediaPreview').innerHTML =
        `<div class="attachmentCard">${mediaMarkup(composerMedia)}<div class="ex-row"><button class="demoChip" data-action="media" data-kind="${kind}">Replace</button><button class="demoChip" data-action="removeMedia">Remove</button></div></div>`;
      status.textContent = file.name;
      updatePublishButton();
    } catch (error) {
      URL.revokeObjectURL(url);
      if (panel.isConnected && request === mediaRequest) {
        status.textContent = error.message;
        mediaPreparing = false;
        updatePublishButton();
      }
    }
  }
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'message') {
      const body = String(data.get('message') || '').trim();
      if (!body) return;
      state.messages[state.activeChat].push({
        id: crypto.randomUUID(),
        body,
        own: true,
        createdAt: Date.now(),
      });
      openChat(state.activeChat);
    } else if (form.dataset.form === 'circle') {
      const name = String(data.get('name') || '').trim(),
        interest = String(data.get('interest') || '').trim();
      if (!name || !interest) return;
      const isPrivate = data.get('private') === 'on';
      state.circles.unshift([
        name,
        interest,
        String(data.get('description') || 'A new place to share what you love.'),
        '1',
        true,
        '🫶',
        isPrivate,
      ]);
      document.querySelector('.modalDemo')?.remove();
      render('circles');
      toast(`${name} is ready.`);
    } else if (form.dataset.form === 'reply') {
      const body = String(data.get('message') || '').trim();
      if (!body) return;
      state.replies[state.activeReplyPost].push({
        id: crypto.randomUUID(),
        body,
        own: true,
        createdAt: Date.now(),
      });
      openReplies(state.activeReplyPost);
    }
  });

  document.addEventListener('click', (event) => {
    const picker = event.target.closest('[data-action="media"]');
    if (picker) {
      const input = document.querySelector('#mediaPicker');
      if (input) {
        if (picker.dataset.source === 'camera') input.setAttribute('capture', 'environment');
        else input.removeAttribute('capture');
        input.value = '';
        input.accept =
          picker.dataset.kind === 'video'
            ? 'video/*'
            : picker.dataset.kind === 'gif'
              ? '.gif,image/gif'
              : 'image/*';
        input.click();
      }
    }
  });

  const previewControlSelector =
    '[data-action],.quick,.link,.postActions span,.live,.play,.circle,.avatar,.more,.postActions button';
  function makePreviewControlsAccessible() {
    document.querySelectorAll(previewControlSelector).forEach((element) => {
      if (!element.hasAttribute('role')) element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
    });
  }
  document.addEventListener('keydown', (event) => {
    const target = event.target.closest?.(previewControlSelector);
    if (!target || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    target.click();
  });
  experience = window.createCirclesExperience({
    state,
    icon,
    page,
    modal,
    render,
    toast,
    escapeHtml,
    openComposer,
    openCircle,
    renderLive,
    giftCatalog,
    canDelete,
    deleteControl,
  });
  const previewMeta = document.createElement('aside');
  previewMeta.className = 'previewMeta';
  previewMeta.innerHTML =
    '<strong>Circles · interactive preview</strong><span>Demo data · native mobile services are not connected here.</span><label>Appearance <select id="previewTheme" aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>';
  document.querySelector('.device').before(previewMeta);
  const appearance = document.querySelector('#previewTheme');
  try {
    appearance.value = localStorage.getItem('circles-preview-theme') || 'system';
  } catch {}
  const applyTheme = () => {
    document.documentElement.dataset.theme =
      appearance.value === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : appearance.value;
  };
  appearance.addEventListener('change', () => {
    try {
      localStorage.setItem('circles-preview-theme', appearance.value);
    } catch {}
    applyTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  applyTheme();
  render();
})();
