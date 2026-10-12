import React from 'react';
import { Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, radii } from '../theme';
import type { Circle, CirclePost, Profile } from '../types';

export function Avatar({ profile, size = 44, ring = false }: { profile: Profile; size?: number; ring?: boolean }) {
  return <View style={[styles.avatarFrame, ring && styles.avatarRing, { width: size + (ring ? 6 : 0), height: size + (ring ? 6 : 0), borderRadius: size / 2 + 3 }]}><Image source={{ uri: profile.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.lilac }} /></View>;
}

export function BrandMark({ light = false }: { light?: boolean }) {
  return <View style={styles.brandRow}><View style={[styles.brandGlyph, light && { backgroundColor: '#FFFFFF' }]}><View style={styles.glyphDot} /><View style={[styles.glyphDot, styles.glyphDotRight]} /><View style={[styles.glyphDot, styles.glyphDotBottom]} /></View><Text style={[styles.brandText, light && { color: '#FFFFFF' }]}>circles</Text></View>;
}

export function TopBar({ profile, onProfile, dark = false }: { profile: Profile; onProfile?: () => void; dark?: boolean }) {
  return <View style={styles.topBar}><BrandMark light={dark} />{onProfile ? <Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Open profile"><Avatar profile={profile} size={36} /></Pressable> : <Avatar profile={profile} size={36} />}</View>;
}

export function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.sectionTitleRow}><View>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}<Text style={styles.sectionTitle}>{title}</Text></View>{action && onAction ? <Pressable accessibilityRole="button" onPress={onAction}><Text style={styles.actionText}>{action}</Text></Pressable> : null}</View>;
}

export function CircleTile({ circle, onPress, onJoin, onMore, requested = false, joining = false }: { circle: Circle; onPress?: () => void; onJoin?: () => void; onMore?: () => void; requested?: boolean; joining?: boolean }) {
  return <View style={styles.circleTile}>
    <Pressable disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? `Open ${circle.name}` : undefined} onPress={onPress} style={styles.circleImageWrap}>
      <Image source={{ uri: circle.imageUrl }} style={styles.circleImage} />
      <View style={styles.circlePhotoOverlay} />
      {circle.isPrivate ? <View style={styles.privateBadge}><Text style={styles.privateBadgeText}>PRIVATE</Text></View> : null}
      <View style={styles.circleImageText}><Text style={styles.circleNameOnImage}>{circle.name}</Text><Text style={styles.circleMemberOnImage}>{formatCount(circle.members)} members</Text></View>
    </Pressable>
    <View style={styles.circleTileFooter}><View style={{ flex: 1 }}><Text style={styles.circleInterest}>{circle.interest}</Text><Text numberOfLines={2} style={styles.circleDescription}>{circle.description}</Text></View>
      {onMore ? <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel={`Report ${circle.name}`} style={styles.circleMore}><Text style={styles.moreIcon}>···</Text></Pressable> : null}
      {onJoin ? <Pressable accessibilityRole="button" accessibilityLabel={circle.isMember ? `Joined ${circle.name}` : requested ? `Join request pending for ${circle.name}` : joining ? `Joining ${circle.name}` : `Join ${circle.name}`} accessibilityState={{ disabled: circle.isMember || requested || joining }} disabled={circle.isMember || requested || joining} onPress={onJoin} style={[styles.joinButton, circle.isMember && styles.joinedButton, requested && styles.requestedButton]}><Text style={[styles.joinButtonText, circle.isMember && styles.joinedButtonText]}>{circle.isMember ? 'Joined' : requested ? 'Requested' : joining ? '…' : 'Join'}</Text></Pressable> : null}
    </View>
  </View>;
}

export function PostCard({ post, onLike, onReply, onOpenCircle, onMore }: { post: CirclePost; onLike: () => void; onReply: () => void; onOpenCircle?: () => void; onMore?: () => void }) {
  return <View style={styles.postCard}>
    <View style={styles.postMeta}><Avatar profile={post.author} size={42} /><View style={{ flex: 1 }}><Text style={styles.postAuthor}>{post.author.displayName}</Text>{onOpenCircle ? <Pressable onPress={onOpenCircle}><Text style={styles.postCircle}>{post.circleName} · {post.createdAt}</Text></Pressable> : <Text style={styles.postCircle}>{post.circleName} · {post.createdAt}</Text>}</View>{onMore ? <Pressable onPress={onMore} hitSlop={12} accessibilityRole="button" accessibilityLabel="Post options"><Text style={styles.moreIcon}>···</Text></Pressable> : null}</View>
    <Text style={styles.postBody}>{post.body}</Text>
    {post.media?.kind === 'video' ? <VideoPost uri={post.media.url} /> : post.media ? <Image source={{ uri: post.media.url }} style={styles.postImage} resizeMode="cover" /> : null}
    <View style={styles.postActions}><Pressable onPress={onLike} style={styles.postAction} accessibilityRole="button" accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'}><Text style={{ fontSize: 17 }}>{post.liked ? '♥' : '♡'}</Text><Text style={styles.postActionLabel}>{post.likes}</Text></Pressable><Pressable onPress={onReply} style={styles.postAction} accessibilityRole="button" accessibilityLabel="Reply to post"><Text style={{ fontSize: 16 }}>◯</Text><Text style={styles.postActionLabel}>Reply</Text></Pressable><Pressable onPress={() => void Share.share({ message: `${post.body}\n\nShared from ${post.circleName} on Circles` })} style={styles.postAction} accessibilityRole="button" accessibilityLabel="Share post"><Text style={{ fontSize: 16 }}>↗</Text><Text style={styles.postActionLabel}>Share</Text></Pressable></View>
  </View>;
}

function VideoPost({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={styles.postImage} contentFit="cover" nativeControls fullscreenOptions={{ enable: true }} />;
}

export function ActionButton({ label, onPress, variant = 'primary', compact = false, disabled = false }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'dark' | 'outline'; compact?: boolean; disabled?: boolean }) {
  const variantStyle = { primary: styles.button_primary, secondary: styles.button_secondary, dark: styles.button_dark, outline: styles.button_outline }[variant];
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.actionButton, variantStyle, compact && styles.actionButtonCompact, disabled && { opacity: 0.45 }]}><Text style={[styles.actionButtonText, (variant === 'secondary' || variant === 'outline') && { color: colors.ink }, compact && { fontSize: 12 }]}>{label}</Text></Pressable>;
}

export function Pill({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.pill, selected && styles.pillSelected]}><Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text></Pressable>;
}

export function EmptyState({ emoji, title, detail, action, onAction }: { emoji: string; title: string; detail: string; action?: string; onAction?: () => void }) {
  return <View style={styles.emptyState}><Text style={{ fontSize: 38 }}>{emoji}</Text><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDetail}>{detail}</Text>{action && onAction ? <ActionButton compact label={action} onPress={onAction} /> : null}</View>;
}

export function formatCount(count: number) { return count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count); }

const styles = StyleSheet.create({
  avatarFrame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, avatarRing: { borderWidth: 2, borderColor: colors.coral, padding: 2 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, brandGlyph: { width: 27, height: 27, borderRadius: 10, backgroundColor: colors.coral, position: 'relative' },
  glyphDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF8EF', top: 5, left: 5 }, glyphDotRight: { left: 14, top: 10 }, glyphDotBottom: { top: 15, left: 5 }, brandText: { color: colors.ink, fontWeight: '800', fontSize: 19, letterSpacing: -0.8 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 8, paddingBottom: 16 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }, eyebrow: { color: colors.coral, fontWeight: '800', fontSize: 10, letterSpacing: 1.4, marginBottom: 5 }, sectionTitle: { color: colors.ink, fontSize: 21, fontWeight: '800', letterSpacing: -0.6 }, actionText: { color: colors.coral, fontWeight: '700', fontSize: 13, paddingBottom: 3 },
  circleTile: { backgroundColor: colors.surface, borderRadius: radii.medium, overflow: 'hidden', marginBottom: 15, borderWidth: 1, borderColor: colors.line }, circleImageWrap: { height: 162, backgroundColor: colors.sage }, circleImage: { width: '100%', height: '100%' }, circlePhotoOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(25,22,21,0.16)' }, privateBadge: { position: 'absolute', top: 13, right: 13, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.88)', paddingHorizontal: 9, paddingVertical: 5 }, privateBadgeText: { fontSize: 9, fontWeight: '900', color: colors.ink, letterSpacing: 1 }, circleImageText: { position: 'absolute', left: 16, right: 16, bottom: 15 }, circleNameOnImage: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 8 }, circleMemberOnImage: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginTop: 3 }, circleTileFooter: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 10 }, circleInterest: { fontSize: 10, color: colors.coral, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }, circleDescription: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4, maxWidth: 210 }, circleMore: { width: 29, alignItems: 'center' }, joinButton: { minWidth: 70, alignItems: 'center', paddingHorizontal: 13, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.coral }, joinedButton: { backgroundColor: colors.sage }, requestedButton: { backgroundColor: colors.butter }, joinButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, joinedButtonText: { color: colors.green },
  postCard: { backgroundColor: colors.surface, borderRadius: radii.medium, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.line }, postMeta: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 }, postAuthor: { color: colors.ink, fontWeight: '800', fontSize: 14 }, postCircle: { color: colors.muted, fontSize: 11, marginTop: 3 }, moreIcon: { fontSize: 25, lineHeight: 20, color: colors.muted, letterSpacing: 1 }, postBody: { color: colors.ink, fontSize: 14, lineHeight: 21, marginBottom: 12 }, postImage: { width: '100%', height: 222, borderRadius: 17, backgroundColor: colors.sage, marginBottom: 12 }, postActions: { flexDirection: 'row', gap: 24 }, postAction: { flexDirection: 'row', alignItems: 'center', gap: 7 }, postActionLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  actionButton: { minHeight: 48, paddingHorizontal: 17, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coral }, actionButtonCompact: { minHeight: 36, paddingHorizontal: 13 }, button_primary: { backgroundColor: colors.coral }, button_secondary: { backgroundColor: colors.coralSoft }, button_dark: { backgroundColor: colors.night }, button_outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line }, actionButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  pill: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, paddingVertical: 9, marginRight: 8, backgroundColor: '#FFFFFF' }, pillSelected: { backgroundColor: colors.night, borderColor: colors.night }, pillText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, pillTextSelected: { color: '#FFFFFF' },
  emptyState: { alignItems: 'center', gap: 9, padding: 28, backgroundColor: '#FFFFFF', borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line }, emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' }, emptyDetail: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 6 },
});
