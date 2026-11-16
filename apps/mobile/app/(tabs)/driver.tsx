import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { formatMoney, useT } from "@/i18n";
import { getSocket } from "@/socket";

interface Offer {
  id: string;
  rideId: string;
  expiresAt: string;
  ride: {
    id: string;
    pickupAddress: string;
    dropoffAddress: string;
    estimatedFareMinor: number | null;
    currency: string;
  };
}

interface ActiveRide {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
}

interface Earnings {
  currency: string;
  balanceMinor: number;
}

const DRIVER_ACTIVE = new Set([
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "PAYMENT_PENDING",
]);

export default function DriverScreen() {
  const t = useT();
  const { me, reload } = useAuth();
  const [online, setOnline] = useState(me?.driverProfile?.isOnline ?? false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [offerList, rides, earn] = await Promise.all([
        api<Offer[]>("/v1/rides/offers"),
        api<ActiveRide[]>("/v1/rides"),
        api<Earnings>("/v1/drivers/earnings"),
      ]);
      setOffers(offerList);
      setActiveRide(rides.find((r) => DRIVER_ACTIVE.has(r.status)) ?? null);
      setEarnings(earn);
    } catch {
      /* driver profile may not exist yet */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      const socket = await getSocket();
      socket.off("ride:offer");
      socket.on("ride:offer", () => void refresh());
    })();
  }, [refresh]);

  // Stream GPS while online (foreground; background tracking needs a dev build).
  useEffect(() => {
    void (async () => {
      if (online && !locationSub.current) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        locationSub.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 },
          (pos) => {
            void getSocket().then((socket) =>
              socket.emit("location:update", {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracyM: pos.coords.accuracy ?? undefined,
                speedMps: pos.coords.speed ?? undefined,
                recordedAt: new Date(pos.timestamp).toISOString(),
              }),
            );
          },
        );
      } else if (!online && locationSub.current) {
        locationSub.current.remove();
        locationSub.current = null;
      }
    })();
    return () => {
      locationSub.current?.remove();
      locationSub.current = null;
    };
  }, [online]);

  async function toggleOnline(value: boolean) {
    try {
      await api("/v1/drivers/availability", {
        method: "POST",
        body: JSON.stringify({ online: value }),
      });
      setOnline(value);
      await reload();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  }

  async function respond(rideId: string, action: "accept" | "reject") {
    try {
      await api(`/v1/rides/${rideId}/${action}`, { method: "POST" });
      await refresh();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
      await refresh();
    }
  }

  async function rideAction(action: "arrived" | "start" | "complete") {
    if (!activeRide) return;
    try {
      await api(`/v1/rides/${activeRide.id}/${action}`, { method: "POST" });
      await refresh();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  }

  if (!me?.driverProfile) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>
          Driver profile not set up yet. Contact your community administrator.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>
            {online ? t("online") : t("offline")}
          </Text>
          <Switch value={online} onValueChange={toggleOnline} />
        </View>
        {earnings && (
          <Text style={styles.muted}>
            {t("balance")}: {formatMoney(earnings.balanceMinor, earnings.currency)}
          </Text>
        )}
      </View>

      {activeRide ? (
        <View style={styles.card}>
          <Text style={styles.title}>{activeRide.status}</Text>
          <Text style={styles.row}>
            {activeRide.pickupAddress} → {activeRide.dropoffAddress}
          </Text>
          {activeRide.status === "DRIVER_ARRIVING" && (
            <TouchableOpacity style={styles.button} onPress={() => rideAction("arrived")}>
              <Text style={styles.buttonText}>{t("arrived")}</Text>
            </TouchableOpacity>
          )}
          {activeRide.status === "DRIVER_ARRIVED" && (
            <TouchableOpacity style={styles.button} onPress={() => rideAction("start")}>
              <Text style={styles.buttonText}>{t("startRide")}</Text>
            </TouchableOpacity>
          )}
          {activeRide.status === "IN_PROGRESS" && (
            <TouchableOpacity style={styles.button} onPress={() => rideAction("complete")}>
              <Text style={styles.buttonText}>{t("completeRide")}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.title}>{t("offers")}</Text>
          {offers.length === 0 && <Text style={styles.muted}>—</Text>}
          {offers.map((offer) => (
            <View key={offer.id} style={styles.offer}>
              <Text style={styles.row}>
                {offer.ride.pickupAddress} → {offer.ride.dropoffAddress}
              </Text>
              <Text style={styles.fare}>
                {formatMoney(offer.ride.estimatedFareMinor, offer.ride.currency)}
              </Text>
              <View style={styles.rowBetween}>
                <TouchableOpacity
                  style={[styles.button, styles.flex]}
                  onPress={() => respond(offer.rideId, "accept")}
                >
                  <Text style={styles.buttonText}>{t("accept")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectButton, styles.flex]}
                  onPress={() => respond(offer.rideId, "reject")}
                >
                  <Text style={styles.rejectText}>{t("reject")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#e3e9e5",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#123326" },
  row: { color: "#374b41", fontSize: 15 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  muted: { color: "#5a6e64" },
  fare: { fontWeight: "700", color: "#123326" },
  offer: {
    borderTopWidth: 1,
    borderTopColor: "#eef2ef",
    paddingTop: 10,
    gap: 8,
  },
  button: {
    backgroundColor: "#17603f",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  rejectButton: {
    backgroundColor: "#fbeaea",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  rejectText: { color: "#b3261e", fontWeight: "600" },
  buttonText: { color: "white", fontWeight: "600" },
  flex: { flex: 1 },
});
