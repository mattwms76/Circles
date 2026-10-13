import type { Circle, CirclePost, Conversation, Gift, LiveSession, Profile } from '../types';

export const currentUser: Profile = {
  id: 'user-you',
  handle: 'julesmakes',
  displayName: 'Jules Parker',
  avatarUrl:
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=faces',
  bio: 'Collecting little moments and big ideas.',
  interests: ['Film', 'Slow living', 'Photography'],
};

export const people: Profile[] = [
  currentUser,
  {
    id: 'user-mara',
    handle: 'maramakes',
    displayName: 'Mara Ellis',
    avatarUrl:
      'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=faces',
    interests: ['Photography', 'Art'],
  },
  {
    id: 'user-noah',
    handle: 'noahafterhours',
    displayName: 'Noah Kim',
    avatarUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop&crop=faces',
    interests: ['Music', 'Film'],
  },
  {
    id: 'user-cleo',
    handle: 'cleo.cooks',
    displayName: 'Cleo James',
    avatarUrl:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=160&h=160&fit=crop&crop=faces',
    interests: ['Cooking', 'Slow living'],
  },
  {
    id: 'user-ari',
    handle: 'aribuilds',
    displayName: 'Ari Navarro',
    avatarUrl:
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=160&h=160&fit=crop&crop=faces',
    interests: ['Design', 'Music'],
  },
];

export const circles: Circle[] = [
  {
    id: 'circle-film',
    name: 'The Film Room',
    description: 'For people who love the feeling after the credits roll.',
    interest: 'Film',
    members: 18240,
    isPrivate: false,
    isMember: true,
    color: '#E7D8CC',
    imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=720&h=520&fit=crop',
  },
  {
    id: 'circle-garden',
    name: 'Tiny Gardens',
    description: 'Small spaces, good soil, happy plants.',
    interest: 'Gardening',
    members: 9640,
    isPrivate: false,
    isMember: true,
    color: '#DCE7D6',
    imageUrl: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=720&h=520&fit=crop',
  },
  {
    id: 'circle-studio',
    name: 'Sunday Studio',
    description: 'A soft place to make things, share drafts, and start again.',
    interest: 'Art',
    members: 7231,
    isPrivate: false,
    isMember: false,
    color: '#E5DFF1',
    imageUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=720&h=520&fit=crop',
  },
  {
    id: 'circle-kitchen',
    name: 'Kitchen Table Club',
    description: 'Recipes that feel like someone saved you a seat.',
    interest: 'Cooking',
    members: 30870,
    isPrivate: false,
    isMember: false,
    color: '#F4E6C7',
    imageUrl: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=720&h=520&fit=crop',
  },
  {
    id: 'circle-quiet',
    name: 'Quiet Mornings',
    description: 'A private circle for slower starts and kinder plans.',
    interest: 'Slow living',
    members: 841,
    isPrivate: true,
    isMember: false,
    color: '#E7E9E1',
    imageUrl: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=720&h=520&fit=crop',
  },
  {
    id: 'circle-sound',
    name: 'Soft Sounds',
    description: 'New records, old favourites, and what to play next.',
    interest: 'Music',
    members: 14522,
    isPrivate: false,
    isMember: true,
    color: '#DDE7E8',
    imageUrl: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=720&h=520&fit=crop',
  },
];

export const liveSessions: LiveSession[] = [
  {
    id: 'live-cleo',
    host: people[3],
    title: 'Making lemon pasta from scratch',
    circleName: 'Kitchen Table Club',
    viewerCount: 1240,
    status: 'live',
    startedAt: new Date().toISOString(),
    seats: [{ user: people[3], role: 'host' }],
  },
  {
    id: 'live-mara',
    host: people[1],
    title: 'A tiny photo walk through my neighbourhood',
    circleName: 'The Film Room',
    viewerCount: 862,
    status: 'live',
    startedAt: new Date().toISOString(),
    seats: [
      { user: people[1], role: 'host' },
      { user: people[4], role: 'cohost' },
    ],
  },
  {
    id: 'live-noah',
    host: people[2],
    title: 'Listening to the whole record, side A',
    circleName: 'Soft Sounds',
    viewerCount: 531,
    status: 'live',
    startedAt: new Date().toISOString(),
    seats: [{ user: people[2], role: 'host' }],
  },
];

export const posts: CirclePost[] = [
  {
    id: 'post-1',
    circleId: 'circle-garden',
    circleName: 'Tiny Gardens',
    author: people[1],
    body: 'First tomato of the season. She is tiny, she is perfect, and she knows it 🍅',
    media: {
      id: 'media-1',
      kind: 'image',
      url: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=1100&h=800&fit=crop',
    },
    likes: 284,
    createdAt: '2h ago',
    liked: false,
  },
  {
    id: 'post-2',
    circleId: 'circle-film',
    circleName: 'The Film Room',
    author: people[2],
    body: 'Watched In the Mood for Love again and now I want to paint my hallway that exact shade of green.',
    likes: 76,
    createdAt: '4h ago',
    liked: true,
  },
  {
    id: 'post-3',
    circleId: 'circle-sound',
    circleName: 'Soft Sounds',
    author: people[4],
    body: 'Made a little playlist for the walk home while it is still light out 🌿',
    media: {
      id: 'media-3',
      kind: 'image',
      url: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1100&h=800&fit=crop',
    },
    likes: 139,
    createdAt: '6h ago',
    liked: false,
  },
];

export const conversations: Conversation[] = [
  {
    id: 'dm-mara',
    peer: people[1],
    isMutual: true,
    unread: 2,
    messages: [
      {
        id: 'm1',
        senderId: 'user-mara',
        body: 'I saved you a seat for the photo walk tomorrow 📷',
        createdAt: '10:42',
      },
      {
        id: 'm2',
        senderId: 'user-you',
        body: 'Would love that. What time are you heading out?',
        createdAt: '10:45',
      },
      { id: 'm3', senderId: 'user-mara', body: 'Around 9, coffee first?', createdAt: '10:48' },
    ],
  },
  {
    id: 'dm-noah',
    peer: people[2],
    isMutual: true,
    unread: 0,
    messages: [
      {
        id: 'm4',
        senderId: 'user-noah',
        body: 'You might like the new Sault album. Side B especially.',
        createdAt: 'Yesterday',
      },
    ],
  },
  {
    id: 'dm-cleo',
    peer: people[3],
    isMutual: true,
    unread: 0,
    messages: [
      {
        id: 'm5',
        senderId: 'user-cleo',
        body: 'The lemon pasta recipe is in the circle now!',
        createdAt: 'Monday',
      },
    ],
  },
];

const giftSeeds = [
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

const tierFor = (index: number): Gift['tier'] =>
  index < 80
    ? 'tiny'
    : index < 160
      ? 'small'
      : index < 230
        ? 'medium'
        : index < 280
          ? 'large'
          : 'legendary';
const tierBase = { tiny: 5, small: 25, medium: 100, large: 500, legendary: 2000 };

export const gifts: Gift[] = Array.from({ length: 300 }, (_, index) => {
  const seed = giftSeeds[index % giftSeeds.length];
  const tier = tierFor(index);
  const tierIndex =
    index < 80
      ? index
      : index < 160
        ? index - 80
        : index < 230
          ? index - 160
          : index < 280
            ? index - 230
            : index - 280;
  return {
    id: `gift-${String(index + 1).padStart(3, '0')}`,
    name: `${seed[0]} ${String(Math.floor(index / giftSeeds.length) + 1).padStart(2, '0')}`,
    emoji: seed[1],
    coins:
      tierBase[tier] +
      (tierIndex % 10) *
        (tier === 'tiny'
          ? 1
          : tier === 'small'
            ? 5
            : tier === 'medium'
              ? 20
              : tier === 'large'
                ? 100
                : 500),
    tier,
  };
});
