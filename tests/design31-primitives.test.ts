import {
  Children,
  createRef,
  type ForwardedRef,
  isValidElement,
  type ForwardRefExoticComponent,
  type ForwardRefRenderFunction,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
} from "react";
import type { TextInput } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio, UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: {
    create: <T>(value: T) => value,
    flatten: (value: unknown) => value ?? {},
  },
}));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Circle: "SvgCircle",
}));
vi.mock("@/components/live-avatar-ring", () => ({
  LiveAvatarRing: "LiveAvatarRing",
}));
vi.mock(
  "@/lib/ui-accessibility",
  async () => import("../lib/ui-accessibility"),
);

const { Avatar, C, Input, T } = await import("../components/circles-ui");
type InputProps = import("../components/circles-ui").InputProps;

type InspectableForwardRef<Instance, Props> = ForwardRefExoticComponent<
  Props & RefAttributes<Instance>
> & {
  render: ForwardRefRenderFunction<Instance, Props>;
};

function hasForwardRefRender<Instance, Props>(
  component: ForwardRefExoticComponent<Props & RefAttributes<Instance>>,
): component is InspectableForwardRef<Instance, Props> {
  return "render" in component && typeof component.render === "function";
}

function renderInput(
  props: InputProps,
  ref: ForwardedRef<TextInput>,
): ReactNode {
  if (!hasForwardRefRender<TextInput, InputProps>(Input)) {
    throw new Error("Input must retain a React.forwardRef render contract.");
  }
  return Input.render(props, ref);
}

function findElement(
  node: ReactNode,
  type: string | typeof T,
): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === type) return child;
    const nested = findElement(child.props.children as ReactNode, type);
    if (nested) return nested;
  }
  return undefined;
}

describe("D26 shared primitives accessibility foundation", () => {
  it("keeps the muted ordinary-copy default above 4.5:1 on every actual light surface", () => {
    expect(C.muted).toBe(C.secondary);
    for (const surface of [C.bg, C.paper, C.soft, C.sage, "#F4F4F0"]) {
      expect(contrastRatio(C.muted, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("preserves decorative brand coral and green while keeping the semantic action pair compliant", () => {
    expect(C.coral).toBe("#ED604A");
    expect(C.green).toBe("#718569");
    expect(C.action).toBe(UI_ACCESSIBLE_COLORS.action);
    expect(C.actionText).toBe(UI_ACCESSIBLE_COLORS.actionText);
    expect(contrastRatio(C.actionText, C.action)).toBeGreaterThanOrEqual(4.5);
  });

  it("renders accessible Avatar initials for both absent-image and image-error fallback paths", () => {
    const absentImageInitial = findElement(
      Avatar({ uri: null, name: "Ari" }),
      T,
    );
    expect(absentImageInitial?.props.style).toMatchObject({
      color: C.secondary,
    });
    expect(contrastRatio(C.secondary, C.sage)).toBeGreaterThanOrEqual(4.5);

    const avatarWithImage = Avatar({
      uri: "https://example.test/ari.jpg",
      name: "Ari",
    });
    const image = findElement(avatarWithImage, "Image");
    const imageErrorInitial = findElement(
      image?.props.fallback as ReactNode,
      T,
    );
    expect(imageErrorInitial?.props.style).toMatchObject({
      color: C.secondary,
    });

    const liveAvatar = Avatar({
      uri: null,
      name: "Ari",
      size: 50,
      ring: true,
      live: true,
      livePulse: true,
    });
    const liveOverlay = findElement(liveAvatar, "LiveAvatarRing");
    expect(liveOverlay?.props).toMatchObject({
      size: 58,
      live: true,
      animate: true,
      inset: 4,
    });
  });

  it("forwards a typed TextInput ref and preserves keyboard-native attributes with a compliant default placeholder", () => {
    const ref = createRef<TextInput>();
    const onSubmitEditing = vi.fn();
    const rendered = renderInput(
      {
        value: "ari@example.com",
        onChangeText: vi.fn(),
        placeholder: "you@example.com",
        accessibilityLabel: "Email address",
        editable: true,
        keyboardType: "email-address",
        onSubmitEditing,
        returnKeyType: "next",
        textContentType: "emailAddress",
      },
      ref,
    );
    const nativeInput = findElement(rendered, "TextInput");

    expect(nativeInput?.props).toMatchObject({
      ref,
      value: "ari@example.com",
      placeholder: "you@example.com",
      accessibilityLabel: "Email address",
      editable: true,
      keyboardType: "email-address",
      onSubmitEditing,
      returnKeyType: "next",
      textContentType: "emailAddress",
      placeholderTextColor: C.secondary,
    });
    expect(contrastRatio(C.secondary, C.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
