import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "@/api";
import { useT } from "@/i18n";

export default function RegisterScreen() {
  const t = useT();
  const router = useRouter();
  const [form, setForm] = useState({
    invitationCode: "",
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onRegister() {
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          email: form.email.trim().toLowerCase(),
          phone: form.phone || undefined,
          acceptTerms,
        }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>✓</Text>
        <Text style={styles.subtitle}>{t("pendingApproval")}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace("/login")}
        >
          <Text style={styles.buttonText}>{t("login")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: "#f6f8f7" }} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>{t("register")}</Text>
      <TextInput
        style={styles.input}
        placeholder={t("invitationCode")}
        autoCapitalize="characters"
        value={form.invitationCode}
        onChangeText={(v) => set("invitationCode", v)}
      />
      <TextInput
        style={styles.input}
        placeholder={t("email")}
        autoCapitalize="none"
        keyboardType="email-address"
        value={form.email}
        onChangeText={(v) => set("email", v)}
      />
      <TextInput
        style={styles.input}
        placeholder={t("password")}
        secureTextEntry
        value={form.password}
        onChangeText={(v) => set("password", v)}
      />
      <TextInput
        style={styles.input}
        placeholder={t("firstName")}
        value={form.firstName}
        onChangeText={(v) => set("firstName", v)}
      />
      <TextInput
        style={styles.input}
        placeholder={t("lastName")}
        value={form.lastName}
        onChangeText={(v) => set("lastName", v)}
      />
      <TextInput
        style={styles.input}
        placeholder={t("phone")}
        keyboardType="phone-pad"
        value={form.phone}
        onChangeText={(v) => set("phone", v)}
      />
      <View style={styles.termsRow}>
        <Switch value={acceptTerms} onValueChange={setAcceptTerms} />
        <Text style={styles.termsText}>{t("acceptTerms")}</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.button, (!acceptTerms || busy) && styles.buttonDisabled]}
        onPress={onRegister}
        disabled={!acceptTerms || busy}
      >
        <Text style={styles.buttonText}>{t("register")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 16,
    backgroundColor: "#f6f8f7",
  },
  scroll: { padding: 20, gap: 12, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: "700", color: "#123326" },
  subtitle: { color: "#5a6e64", textAlign: "center" },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d6ded9",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  termsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  termsText: { flex: 1, color: "#374b41" },
  error: { color: "#b3261e" },
  button: {
    backgroundColor: "#17603f",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    minWidth: 200,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontWeight: "600", fontSize: 16 },
});
