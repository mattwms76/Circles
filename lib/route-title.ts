const routeTitles: Record<string, string> = {
  "/": "Home",
  "/discover": "Discover",
  "/circles": "Circles",
  "/messages": "Messages",
  "/profile": "Your profile",
  "/account/email": "Connect email sign-in",
  "/create": "Share a moment",
  "/live": "Live conversations",
  "/oauth/callback": "Secure sign-in",
  "/onboarding": "Your interests",
  "/updates": "Updates",
  "/updates/preferences": "Update preferences",
  "/dev/theme-lab": "Theme Lab",
};

export function routeTitle(pathname: string): string {
  const path = pathname.replace(/\/$/, "") || "/";
  if (routeTitles[path]) return routeTitles[path];
  if (path.startsWith("/circle/")) return "Circle";
  if (path.startsWith("/person/")) return "Profile";
  if (path.startsWith("/chat/")) return "Conversation";
  if (path.startsWith("/live/")) return "Live conversation";
  if (path.startsWith("/moderation/")) return "Circle reports";
  if (path.startsWith("/updates/")) return "Update details";
  return "Page not found";
}

export function documentTitle(title: string): string {
  const bounded = title.trim().slice(0, 120);
  return bounded ? `${bounded} · Circles` : "Circles";
}
