import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

import { Body, Display, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { makeStyles, spacing, useTheme } from "@/src/theme";

const VERSION = "2026-06-01";

const TERMS: { heading: string; body: string }[] = [
  { heading: "1. Who can use Circles", body: "You must be at least 13 years old to create an account. If you are under 18, you confirm that a parent or guardian is aware you use Circles. Some regions set a higher minimum age; where local law requires, you confirm you meet it." },
  { heading: "2. Your account", body: "Keep your login details secure and let us know of any unauthorised use. You are responsible for activity on your account. You may delete your account at any time from Profile → Delete account." },
  { heading: "3. Community guidelines", body: "Be kind. Do not post illegal content, harassment, hate, threats, sexual content involving minors, or spam. We may remove content or suspend accounts that break these rules, and you will be told the reason and may appeal." },
  { heading: "4. Content you share", body: "You keep ownership of what you post. By posting, you grant Circles a licence to display it within the app so the service can function. Do not post content you do not have the right to share." },
  { heading: "5. Coins and gifts", body: "Coins are a virtual item with no cash value and are non-refundable except where required by law. Coin purchases in this version are simulated." },
  { heading: "6. Ending these terms", body: "You can stop using Circles at any time. We may suspend or end access if you break these terms or where required by law." },
  { heading: "7. Contact", body: "Questions about these terms can be sent to support@circles.app." },
];

const PRIVACY: { heading: string; body: string }[] = [
  { heading: "1. What we collect", body: "Account details (name, email, date of birth), the content you create (posts, comments, messages, photos), your interests and circle memberships, and basic usage needed to run the service." },
  { heading: "2. Why we use it", body: "To provide and secure the service, show you relevant circles and content, keep the community safe, and meet legal obligations. We do not sell your personal data, and we do not run targeted advertising." },
  { heading: "3. Children and teens", body: "You must be 13+ to use Circles. Where local law requires parental consent for minors, we honour those requirements. Accounts belonging to minors use higher-privacy defaults." },
  { heading: "4. Your rights", body: "You can access and download your data (Profile → Download my data) and permanently delete your account and personal content (Profile → Delete account). Depending on where you live, you may have additional rights such as correction or objection." },
  { heading: "5. Sharing", body: "We share data only with service providers that help us operate Circles (for example, secure file storage), and with authorities where legally required, including to protect people from serious harm." },
  { heading: "6. Keeping data", body: "We keep your data while your account is active. When you delete your account, your personal content is removed. Some records may be retained where the law requires." },
  { heading: "7. Contact", body: "Privacy questions can be sent to privacy@circles.app." },
];

export default function LegalDoc() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const isPrivacy = doc === "privacy";
  const sections = isPrivacy ? PRIVACY : TERMS;
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service";

  return (
    <View style={styles.root}>
      <ScreenHeader title={title} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        <Overline>Version {VERSION}</Overline>
        <Body size={13} color={colors.muted} style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
          This is a plain-language summary provided in the app. It is not a substitute for legal advice.
        </Body>
        {sections.map((s) => (
          <View key={s.heading} style={{ marginBottom: spacing.lg }}>
            <Display size={16} weight="semibold" style={{ marginBottom: spacing.xs }}>{s.heading}</Display>
            <Body size={14} color={colors.onSurfaceSecondary}>{s.body}</Body>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
}));
