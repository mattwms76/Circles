import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { RecordedVideoPreview } from "../components/recorded-video-preview";
const state = vi.hoisted(() => ({
  status: "readyToPlay",
  playing: false,
  source: null as unknown,
  pause: vi.fn(),
  play: vi.fn(),
  replay: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) =>
    createElement("div", { "data-testid": testID }, children),
}));
vi.mock("expo-router", () => ({ useFocusEffect: vi.fn() }));
vi.mock("expo", () => ({
  useEvent: (_player: unknown, event: string) =>
    event === "statusChange"
      ? { status: state.status }
      : { isPlaying: state.playing },
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: (source: unknown, setup: (player: unknown) => void) => {
    state.source = source;
    const player = {
      status: state.status,
      playing: state.playing,
      pause: state.pause,
      play: state.play,
      replay: state.replay,
    };
    setup(player);
    return player;
  },
  VideoView: ({ nativeControls }: { nativeControls: boolean }) =>
    createElement("div", { "data-native-controls": nativeControls }),
}));
vi.mock("@/components/circles-ui", () => ({
  C: { ink: "#111", secondary: "#333" },
  T: ({ children }: { children?: ReactNode }) =>
    createElement("p", {}, children),
  Button: ({ title, disabled }: { title: string; disabled?: boolean }) =>
    createElement("button", { disabled }, title),
}));
vi.mock("@/components/status-message", () => ({
  StatusMessage: ({ message }: { message: string }) =>
    createElement("p", { role: "alert" }, message),
}));
describe("actual preview rendering with mocked native player", () => {
  beforeEach(() => {
    state.status = "readyToPlay";
    state.playing = false;
    vi.clearAllMocks();
  });
  it("uses the local URI without upload/base64/autoplay and offers play/replay/retake/use", () => {
    const html = renderToStaticMarkup(
      createElement(RecordedVideoPreview, {
        uri: "file:///cache/local.mp4",
        onUse: vi.fn(),
        onRetake: vi.fn(),
      }),
    );
    expect(state.source).toEqual({
      uri: "file:///cache/local.mp4",
      useCaching: false,
    });
    expect(state.play).not.toHaveBeenCalled();
    for (const label of ["Play video", "Replay video", "Retake", "Use video"])
      expect(html).toContain(label);
  });
  it("disables Use on player failure and retains Retake recovery", () => {
    state.status = "error";
    const html = renderToStaticMarkup(
      createElement(RecordedVideoPreview, {
        uri: "file:///bad.mp4",
        onUse: vi.fn(),
        onRetake: vi.fn(),
      }),
    );
    expect(html).toContain("could not play");
    expect(html).toMatch(/<button disabled="">Use video/);
    expect(html).toContain("<button>Retake");
  });
  it("shows Pause when playing and disables all conflicting controls while publishing", () => {
    state.playing = true;
    const html = renderToStaticMarkup(
      createElement(RecordedVideoPreview, {
        uri: "file:///cache/a.mp4",
        disabled: true,
        onUse: vi.fn(),
        onRetake: vi.fn(),
      }),
    );
    expect(html).toContain("Pause video");
    expect(html).toContain('data-native-controls="false"');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });
  it("keeps actual source background/route pause and native seek wired", () => {
    const source = readFileSync(
      "components/recorded-video-preview.tsx",
      "utf8",
    );
    expect(source).toContain('AppState.addEventListener("change"');
    expect(source).toContain("useFocusEffect");
    expect(source).toContain("player.pause()");
    expect(source).toContain("nativeControls={!disabled}");
    expect(source).not.toContain("base64");
  });
});
