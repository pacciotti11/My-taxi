import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";
import { useAuth } from "@/auth";
import { useT } from "@/i18n";

function Icon({ glyph }: { glyph: string }) {
  return <Text style={{ fontSize: 18 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const t = useT();
  const { me, loading } = useAuth();
  if (!loading && !me) return <Redirect href="/login" />;
  const isDriver = me?.roles.includes("DRIVER") ?? false;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#17603f",
        headerTitleStyle: { fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("home"),
          tabBarIcon: () => <Icon glyph="🧭" />,
        }}
      />
      <Tabs.Screen
        name="driver"
        options={{
          title: t("driver"),
          href: isDriver ? undefined : null,
          tabBarIcon: () => <Icon glyph="🚗" />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: t("history"),
          tabBarIcon: () => <Icon glyph="🕘" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("profile"),
          tabBarIcon: () => <Icon glyph="👤" />,
        }}
      />
    </Tabs>
  );
}
