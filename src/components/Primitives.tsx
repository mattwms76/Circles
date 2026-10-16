import { ParticipationCard } from './ParticipationCard';
import { PostGallery } from './PostGallery';
import { MemberRecognition } from './CommunityDepth';
import { contentLink } from '../lib/contentLinks';
import { usePostActions } from './PostActions';
import React, { useState } from 'react';
import { Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { createThemedStyles, colors, radii, typography } from '../theme';
import { useCompactLayout } from './Design';
import type { Circle, CirclePost, Profile } from '../types';

export { Icon } from './Icon';
export type { IconName } from './Icon';
import { Icon, type IconName } from './Icon';

export function Avatar({
  profile,
  size = 44,
  frame = 'none',
}: {
  profile: Profile;
  size?: number;
  frame?: 'none' | 'neutral';
}) {
  return (
    <View
      style={[
        styles.avatarFrame,
        frame === 'neutral' && styles.avatarFrameNeutral,
        {
          width: size + (frame === 'neutral' ? 6 : 0),
          height: size + (frame === 'neutral' ? 6 : 0),
          borderRadius: size / 2 + 3,
        },
      ]}
    >
      <Image
        accessibilityLabel={`${profile.displayName} profile photo`}
        source={{ uri: profile.avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.lilac }}
      />
    </View>
  );
}

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <View style={[styles.brandGlyph, light && { backgroundColor: '#FFFFFF' }]}>
        <View style={styles.glyphDot} />
        <View style={[styles.glyphDot, styles.glyphDotRight]} />
        <View style={[styles.glyphDot, styles.glyphDotBottom]} />
      </View>
      <Text style={[styles.brandText, light && { color: '#FFFFFF' }]}>circles</Text>
    </View>
  );
}

export function TopBar({
  profile,
  onProfile,
  dark = false,
  onActivity,
  unreadActivity = 0,
}: {
  onActivity?: () => void;
  unreadActivity?: number;
  profile: Profile;
  onProfile?: () => void;
  dark?: boolean;
}) {
  return (
    <View style={styles.topBar}>
      <BrandMark light={dark} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {onActivity ? (
          <Pressable
            onPress={onActivity}
            accessibilityRole="button"
            accessibilityLabel={`Activity, ${unreadActivity} unread`}
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="bell" />
            {unreadActivity > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  right: 2,
                  top: 0,
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  paddingHorizontal: 5,
                }}
              >
                <Text style={{ color: 'white', fontSize: 12 }}>
                  {unreadActivity > 99 ? '99+' : unreadActivity}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {onProfile ? (
          <Pressable
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
            onPress={onProfile}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
          >
            <Avatar profile={profile} size={36} />
          </Pressable>
        ) : (
          <Avatar profile={profile} size={36} />
        )}
      </View>
    </View>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? (
          <Text style={styles.eyebrow}>{eyebrow.charAt(0) + eyebrow.slice(1).toLowerCase()}</Text>
        ) : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action && onAction ? (
        <Pressable
          style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}
          accessibilityRole="button"
          onPress={onAction}
        >
          <Text style={styles.actionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CircleTile({
  circle,
  onPress,
  onJoin,
  onMore,
  requested = false,
  joining = false,
}: {
  circle: Circle;
  onPress?: () => void;
  onJoin?: () => void;
  onMore?: () => void;
  requested?: boolean;
  joining?: boolean;
}) {
  const { compact } = useCompactLayout();
  return (
    <View
      style={[
        styles.circleTile,
        { flexDirection: compact ? 'column' : 'row', alignItems: 'stretch', padding: 16, gap: 12 },
      ]}
    >
      <Pressable
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`Enter ${circle.name}`}
        onPress={onPress}
        style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
      >
        <Image
          source={{ uri: circle.imageUrl }}
          style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: colors.sage }}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ color: colors.ink, ...typography.member }}>{circle.name}</Text>
          <Text numberOfLines={2} style={styles.circleDescription}>
            {circle.description}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
            {circle.interest} · {formatCount(circle.members)} members
            {circle.isPrivate ? ' · Private' : ''}
          </Text>
        </View>
      </Pressable>
      <View
        style={{
          alignItems: 'center',
          flexDirection: compact ? 'row' : 'column',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        {onMore ? (
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel={`Report ${circle.name}`}
            style={styles.circleMore}
          >
            <Icon name="more" color={colors.muted} />
          </Pressable>
        ) : null}
        {onJoin ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              circle.isMember
                ? `Joined ${circle.name}`
                : requested
                  ? `Join request pending for ${circle.name}`
                  : joining
                    ? `Joining ${circle.name}`
                    : `Join ${circle.name}`
            }
            accessibilityState={{ disabled: circle.isMember || requested || joining }}
            disabled={circle.isMember || requested || joining}
            onPress={onJoin}
            style={[
              styles.joinButton,
              circle.isMember && styles.joinedButton,
              requested && styles.requestedButton,
            ]}
          >
            <Text
              style={[
                styles.joinButtonText,
                (circle.isMember || requested) && styles.joinedButtonText,
              ]}
            >
              {circle.isMember ? 'Joined' : requested ? 'Requested' : joining ? '…' : 'Join'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function PostCard({
  post,
  onLike,
  onReply,
  onOpenCircle,
  onMore,
}: {
  post: CirclePost;
  onLike: () => void;
  onReply: () => void;
  onOpenCircle?: () => void;
  onMore?: () => void;
}) {
  const actions = usePostActions();
  return (
    <View style={styles.postCard}>
      <View style={styles.postMeta}>
        <Avatar profile={post.author} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.postAuthor}>{post.author.displayName}</Text>
          <MemberRecognition circleId={post.circleId} userId={post.author.id} />
          {onOpenCircle ? (
            <Pressable onPress={onOpenCircle}>
              <Text style={styles.postCircle}>
                {post.circleName} · {post.createdAt}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.postCircle}>
              {post.circleName} · {post.createdAt}
            </Text>
          )}
        </View>
        {actions || onMore ? (
          <Pressable
            onPress={() => (actions ? actions.open(post, onMore) : onMore?.())}
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Post options"
          >
            <Icon name="more" color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.postBody}>{post.body}</Text>
      {post.postType === 'question' ? (
        <Text style={{ color: colors.coral, fontSize: 14 }}>Question for the circle</Text>
      ) : null}
      {post.postType === 'poll' ? <ParticipationCard postId={post.id} /> : null}
      {post.mediaItems?.length || post.media ? (
        <PostGallery items={post.mediaItems?.length ? post.mediaItems : [post.media!]} />
      ) : null}
      <View style={styles.postActions}>
        <Pressable
          onPress={onLike}
          style={styles.postAction}
          accessibilityRole="button"
          accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'}
          accessibilityState={{ selected: post.liked }}
        >
          <Icon name="heart" color={post.liked ? colors.coral : colors.muted} filled={post.liked} />
          <Text style={styles.postActionLabel}>{post.likes}</Text>
        </Pressable>
        <Pressable
          onPress={onReply}
          style={styles.postAction}
          accessibilityRole="button"
          accessibilityLabel="Reply to post"
        >
          <Icon name="reply" color={colors.muted} />
          <Text style={styles.postActionLabel}>Reply</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            void Share.share({
              message: `Open this post in ${post.circleName} on Circles. Circle membership is required.\n${contentLink('post', post.id, post.circleId)}`,
            })
          }
          style={styles.postAction}
          accessibilityRole="button"
          accessibilityLabel="Share post"
        >
          <Icon name="share" color={colors.muted} />
          <Text style={styles.postActionLabel}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'dark' | 'outline' | 'destructive' | 'quiet';
  compact?: boolean;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const variantStyle = {
    primary: styles.button_primary,
    secondary: styles.button_secondary,
    dark: styles.button_dark,
    outline: styles.button_outline,
    quiet: { backgroundColor: 'transparent', borderWidth: 0, alignItems: 'flex-start' as const },
    destructive: { backgroundColor: colors.live },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variantStyle,
        focused && { outlineWidth: 2, outlineColor: colors.focus, outlineOffset: 2 },
        compact && styles.actionButtonCompact,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          (variant === 'secondary' || variant === 'outline') && { color: colors.ink },
          variant === 'quiet' && { color: colors.coral, textAlign: 'left' },
          compact && { fontSize: 14 },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        minWidth: 48,
        padding: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.small,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Icon name={icon} />
    </Pressable>
  );
}

export function Pill({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillSelected]}
    >
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({
  emoji,
  title,
  detail,
  action,
  onAction,
}: {
  emoji: string;
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={{ fontSize: 38 }}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
      {action && onAction ? <ActionButton compact label={action} onPress={onAction} /> : null}
    </View>
  );
}

export function formatCount(count: number) {
  return count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
}

export function Disclosure({
  title,
  children,
  initiallyOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Text
          style={{ flex: 1, fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.ink }}
        >
          {title}
        </Text>
        <Text accessibilityElementsHidden style={{ fontSize: 22, color: colors.muted }}>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  avatarFrame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarFrameNeutral: { borderWidth: 1, borderColor: colors.controlBorder, padding: 2 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandGlyph: {
    width: 27,
    height: 27,
    borderRadius: 10,
    backgroundColor: colors.primary,
    position: 'relative',
  },
  glyphDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFF8EF',
    top: 5,
    left: 5,
  },
  glyphDotRight: { left: 14, top: 10 },
  glyphDotBottom: { top: 15, left: 5 },
  brandText: { color: colors.ink, fontWeight: '700', fontSize: 19, letterSpacing: -0.8 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sectionTitleRow: {
    gap: 12,
    flexWrap: 'wrap',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 0,
  },
  eyebrow: {
    color: colors.coral,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1.4,
    marginBottom: 5,
  },
  sectionTitle: { ...typography.section, color: colors.ink, letterSpacing: -0.4 },
  actionText: {
    color: colors.coral,
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
    paddingBottom: 3,
  },
  circleTile: {
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    overflow: 'hidden',
    marginBottom: 0,
    borderWidth: 1,
    borderColor: colors.line,
  },
  circleImageWrap: { height: 162, backgroundColor: colors.sage },
  circleImage: { width: '100%', height: '100%' },
  circlePhotoOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(25,22,21,0.62)' },
  privateBadge: {
    position: 'absolute',
    top: 13,
    right: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  privateBadgeText: { fontSize: 12, fontWeight: '700', color: colors.ink, letterSpacing: 1 },
  circleImageText: { position: 'absolute', left: 16, right: 16, bottom: 15 },
  circleNameOnImage: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowRadius: 8,
  },
  circleMemberOnImage: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginTop: 3 },
  circleTileFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  circleInterest: {
    fontSize: 12,
    color: colors.coral,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  circleDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  circleMore: { minHeight: 48, minWidth: 48, width: 29, alignItems: 'center' },
  joinButton: {
    minHeight: 48,
    justifyContent: 'center',
    minWidth: 70,
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  joinedButton: { backgroundColor: colors.sage },
  requestedButton: { backgroundColor: colors.butter },
  joinButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  joinedButtonText: { color: colors.green },
  postCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    padding: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: colors.line,
  },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
  postAuthor: { color: colors.ink, ...typography.member },
  postCircle: { color: colors.muted, ...typography.secondary, marginTop: 3 },
  moreIcon: { fontSize: 25, lineHeight: 20, color: colors.muted, letterSpacing: 1 },
  postBody: { color: colors.ink, fontSize: 16, lineHeight: 24, marginBottom: 12 },
  postImage: {
    width: '100%',
    height: 222,
    borderRadius: 17,
    backgroundColor: colors.sage,
    marginBottom: 12,
  },
  postActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 4 },
  postAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7 },
  postActionLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  actionButton: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 17,
    borderRadius: radii.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  actionButtonCompact: { minHeight: 48, paddingHorizontal: 13 },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: { backgroundColor: colors.coralSoft },
  button_dark: { backgroundColor: colors.night },
  button_outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  pill: {
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    paddingHorizontal: 13,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 9,
    marginRight: 0,
    backgroundColor: colors.surface,
  },
  pillSelected: { backgroundColor: colors.selected, borderColor: colors.coral, borderWidth: 2 },
  pillText: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  pillTextSelected: { color: colors.coral },
  emptyState: {
    alignItems: 'center',
    gap: 9,
    padding: 28,
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.line,
  },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  emptyDetail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 6,
  },
}));
