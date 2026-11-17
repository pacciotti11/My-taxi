import { Link, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { clearTokens } from "@/api";
import { useAuth } from "@/auth";
import { useT } from "@/i18n";
import {
  getApiUrl,
  SERVER_OVERRIDE_ALLOWED,
  setApiUrl,
  TUNNEL_HEADERS,
} from "@/server";
import { closeSocket } from "@/socket";

function ServerSettings() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void getApiUrl().then(setUrl);
  }, []);

  async function saveAndTest() {
    setStatus("Проверка…");
    try {
      await setApiUrl(url);
      // Tokens issued by another server are meaningless here.
      await clearTokens();
      closeSocket();
      const base = await getApiUrl();
      setUrl(base);
      const res = await fetch(`${base}/v1/health`, { headers: TUNNEL_HEADERS });
      const body = (await res.json()) as { status?: string };
      setStatus(body.status === "ok" ? "✓ Сървърът отговаря" : `Отговор: ${res.status}`);
    } catch (e) {
      setStatus(`✗ ${(e as Error).message}`);
    }
  }

  if (!SERVER_OVERRIDE_ALLOWED) return null;
  return (
    <View style={styles.serverBox}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)}>
        <Text style={styles.serverToggle}>
          ⚙︎ Сървър (тестов билд){open ? "" : `: ${url}`}
        </Text>
      </TouchableOpacity>
      {open && (
        <>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://xxxx.ngrok-free.app"
          />
          <TouchableOpacity style={styles.serverButton} onPress={saveAndTest}>
            <Text style={styles.serverButtonText}>Запази и провери</Text>
          </TouchableOpacity>
          {status && <Text style={styles.serverStatus}>{status}</Text>}
        </>
      )}
    </View>
  );
}

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
        <ServerSettings />
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
  serverBox: {
    marginTop: 24,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#e3e9e5",
    paddingTop: 12,
  },
  serverToggle: { color: "#5a6e64", fontSize: 13, textAlign: "center" },
  serverButton: {
    borderWidth: 1,
    borderColor: "#17603f",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  serverButtonText: { color: "#17603f", fontWeight: "600" },
  serverStatus: { color: "#374b41", fontSize: 13, textAlign: "center" },
});
