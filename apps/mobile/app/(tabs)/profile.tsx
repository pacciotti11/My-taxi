import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { setLocale, useT } from "@/i18n";

interface Method {
  id: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
}

export default function ProfileScreen() {
  const t = useT();
  const router = useRouter();
  const { me, logout } = useAuth();
  const [methods, setMethods] = useState<Method[]>([]);

  const load = useCallback(async () => {
    try {
      setMethods(await api<Method[]>("/v1/payments/methods"));
    } catch {
      /* not an active member yet */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function addSandboxCard() {
    // Real card entry goes through the provider's hosted sheet (Stripe
    // PaymentSheet) in production; sandbox mode registers a test token.
    try {
      await api("/v1/payments/methods", {
        method: "POST",
        body: JSON.stringify({
          token: `sandbox_pm_ok_${Date.now()}`,
          brand: "visa",
          last4: "4242",
        }),
      });
      await load();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>
          {me?.firstName} {me?.lastName}
        </Text>
        <Text style={styles.muted}>{me?.email}</Text>
        <Text style={styles.muted}>
          {me?.memberships[0]?.community.name} ·{" "}
          {me?.memberships[0]?.status}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("paymentMethods")}</Text>
        {methods.map((m) => (
          <Text key={m.id} style={styles.row}>
            💳 {m.brand ?? "card"} •••• {m.last4 ?? "????"}
            {m.isDefault ? "  ✓" : ""}
          </Text>
        ))}
        <TouchableOpacity style={styles.buttonOutline} onPress={addSandboxCard}>
          <Text style={styles.buttonOutlineText}>{t("addCard")} (test)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <TouchableOpacity onPress={() => setLocale("bg")}>
            <Text style={styles.lang}>🇧🇬 Български</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setLocale("en")}>
            <Text style={styles.lang}>🇬🇧 English</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={styles.logout}
        onPress={() => {
          void logout().then(() => router.replace("/login"));
        }}
      >
        <Text style={styles.logoutText}>{t("logout")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#e3e9e5",
  },
  name: { fontSize: 20, fontWeight: "700", color: "#123326" },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#123326" },
  muted: { color: "#5a6e64" },
  row: { color: "#374b41", fontSize: 15 },
  rowBetween: { flexDirection: "row", justifyContent: "space-around" },
  lang: { fontSize: 15, color: "#17603f" },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "#17603f",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  buttonOutlineText: { color: "#17603f", fontWeight: "600" },
  logout: { alignItems: "center", paddingVertical: 12 },
  logoutText: { color: "#b3261e", fontWeight: "600" },
});
