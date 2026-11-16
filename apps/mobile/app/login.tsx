import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "@/auth";
import { useT } from "@/i18n";

export default function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin() {
    setBusy(true);
    setError(null);
    try {
      const me = await login(email.trim().toLowerCase(), password);
      const status = me.memberships[0]?.status;
      if (status === "PENDING_APPROVAL") {
        setError(t("pendingApproval"));
        return;
      }
      router.replace("/(tabs)/home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>{t("welcome")}</Text>
        <Text style={styles.subtitle}>{t("welcomeSub")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("email")}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder={t("password")}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={onLogin}
          disabled={busy}
        >
          <Text style={styles.buttonText}>{t("login")}</Text>
        </TouchableOpacity>
        <Link href="/register" style={styles.link}>
          {t("register")}
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#f6f8f7",
  },
  card: { gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#123326" },
  subtitle: { color: "#5a6e64", marginBottom: 12 },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d6ded9",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: "#b3261e" },
  button: {
    backgroundColor: "#17603f",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontWeight: "600", fontSize: 16 },
  link: { textAlign: "center", color: "#17603f", marginTop: 12 },
});
