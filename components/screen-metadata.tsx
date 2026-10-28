import Head from "expo-router/head";
import { documentTitle } from "@/lib/route-title";

export function ScreenMetadata({ title }: { title: string }) {
  return (
    <Head>
      <title>{documentTitle(title)}</title>
    </Head>
  );
}
