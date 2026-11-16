import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { Socket } from "socket.io-client";
import { api } from "@/api";
import { MapPlaceholder } from "@/components/MapPlaceholder";
import { formatMoney, useT } from "@/i18n";
import { getSocket } from "@/socket";

interface Estimate {
  estimateId: string;
  currency: string;
  totalMinor: number;
  estimatedDistanceM: number;
  estimatedDurationS: number;
}

interface RideDetail {
  id: string;
  status: string;
  currency: string;
  estimatedFareMinor: number | null;
  finalFareMinor: number | null;
  pickupAddress: string;
  dropoffAddress: string;
  driver: {
    user: { firstName: string; lastName: string; phone: string | null };
    ratingAvg: string;
  } | null;
  vehicle: {
    make: string;
    model: string;
    color: string;
    registrationNumber: string;
  } | null;
}

interface ActiveRideSummary {
  id: string;
  status: string;
}

const ACTIVE_STATUSES = new Set([
  "REQUESTED",
  "SEARCHING",
  "OFFERED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
]);

export default function PassengerHome() {
  const t = useT();
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [ride, setRide] = useState<RideDetail | null>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Resume an active ride after app restart.
  useEffect(() => {
    void (async () => {
      try {
        const rides = await api<ActiveRideSummary[]>("/v1/rides");
        const active = rides.find((r) => ACTIVE_STATUSES.has(r.status));
        if (active) await loadRide(active.id);
      } catch {
        /* list may be empty */
      }
    })();
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    })();
    return () => {
      socketRef.current?.off("ride:status");
      socketRef.current?.off("driver:location");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRide = useCallback(async (rideId: string) => {
    const detail = await api<RideDetail>(`/v1/rides/${rideId}`);
    setRide(detail);
    const socket = await getSocket();
    socketRef.current = socket;
    socket.emit("ride:subscribe", { rideId });
    socket.off("ride:status");
    socket.on("ride:status", (event: { rideId: string; status: string }) => {
      if (event.rideId !== rideId) return;
      void api<RideDetail>(`/v1/rides/${rideId}`).then(setRide);
    });
    socket.off("driver:location");
    socket.on(
      "driver:location",
      (event: { rideId: string; lat: number; lng: number }) => {
        if (event.rideId === rideId) setDriverPos({ lat: event.lat, lng: event.lng });
      },
    );
  }, []);

  async function onEstimate() {
    if (!coords) {
      Alert.alert(t("error"), "Location unavailable; enable permissions.");
      return;
    }
    setBusy(true);
    try {
      // Dropoff geocoding arrives with the maps provider integration; the
      // stub uses an offset from the pickup to exercise the full flow.
      const dropoff = { lat: coords.lat - 0.013, lng: coords.lng - 0.003 };
      const est = await api<Estimate>("/v1/rides/estimate", {
        method: "POST",
        body: JSON.stringify({ pickup: coords, dropoff }),
      });
      setEstimate(est);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRequest() {
    if (!coords || !estimate) return;
    setBusy(true);
    try {
      const dropoff = { lat: coords.lat - 0.013, lng: coords.lng - 0.003 };
      const created = await api<{ id: string }>("/v1/rides", {
        method: "POST",
        body: JSON.stringify({
          pickup: coords,
          pickupAddress: pickupAddress || "Current location",
          dropoff,
          dropoffAddress: dropoffAddress || "Destination",
          estimateId: estimate.estimateId,
        }),
      });
      setEstimate(null);
      await loadRide(created.id);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!ride) return;
    try {
      await api(`/v1/rides/${ride.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setRide(null);
      setDriverPos(null);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  }

  async function onRetryPayment() {
    if (!ride) return;
    try {
      await api(`/v1/rides/${ride.id}/retry-payment`, { method: "POST" });
      await loadRide(ride.id);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  }

  // ---- Render by ride state ----

  if (ride && ACTIVE_STATUSES.has(ride.status)) {
    const statusText =
      ride.status === "SEARCHING" || ride.status === "REQUESTED" || ride.status === "OFFERED"
        ? t("searching")
        : ride.status === "DRIVER_ARRIVED"
          ? t("driverArrived")
          : ride.status === "IN_PROGRESS" || ride.status === "PAYMENT_PENDING"
            ? t("inProgress")
            : ride.status === "PAYMENT_FAILED"
              ? t("retryPayment")
              : t("driverAssigned");
    const cancellable = ["REQUESTED", "SEARCHING", "OFFERED", "ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(ride.status);
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <MapPlaceholder label={statusText} driverPosition={driverPos} />
        <View style={styles.card}>
          <Text style={styles.statusTitle}>{statusText}</Text>
          {["SEARCHING", "REQUESTED", "OFFERED"].includes(ride.status) && (
            <ActivityIndicator style={{ marginVertical: 8 }} />
          )}
          <Text style={styles.row}>
            {ride.pickupAddress} → {ride.dropoffAddress}
          </Text>
          {ride.driver && (
            <Text style={styles.row}>
              👤 {ride.driver.user.firstName} {ride.driver.user.lastName} · ⭐{" "}
              {Number(ride.driver.ratingAvg).toFixed(1)}
            </Text>
          )}
          {ride.vehicle && (
            <Text style={styles.row}>
              🚗 {ride.vehicle.color} {ride.vehicle.make} {ride.vehicle.model} ·{" "}
              {ride.vehicle.registrationNumber}
            </Text>
          )}
          <Text style={styles.row}>
            {t("estimatedFare")}:{" "}
            {formatMoney(ride.estimatedFareMinor, ride.currency)}
          </Text>
          {ride.status === "PAYMENT_FAILED" && (
            <TouchableOpacity style={styles.button} onPress={onRetryPayment}>
              <Text style={styles.buttonText}>{t("retryPayment")}</Text>
            </TouchableOpacity>
          )}
          {cancellable && (
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>{t("cancel")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  }

  if (ride && ride.status === "COMPLETED") {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.statusTitle}>{t("completed")} ✓</Text>
          <Text style={styles.row}>
            {t("finalFare")}: {formatMoney(ride.finalFareMinor, ride.currency)}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => {
              setRide(null);
              setDriverPos(null);
            }}
          >
            <Text style={styles.buttonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <MapPlaceholder label={t("whereTo")} />
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder={t("pickup")}
          value={pickupAddress}
          onChangeText={setPickupAddress}
        />
        <TextInput
          style={styles.input}
          placeholder={t("dropoff")}
          value={dropoffAddress}
          onChangeText={setDropoffAddress}
        />
        {estimate ? (
          <>
            <Text style={styles.fare}>
              {t("estimatedFare")}:{" "}
              {formatMoney(estimate.totalMinor, estimate.currency)} ·{" "}
              {(estimate.estimatedDistanceM / 1000).toFixed(1)} km ·{" "}
              {Math.round(estimate.estimatedDurationS / 60)} min
            </Text>
            <TouchableOpacity
              style={[styles.button, busy && styles.disabled]}
              onPress={onRequest}
              disabled={busy}
            >
              <Text style={styles.buttonText}>{t("requestRide")}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.button, busy && styles.disabled]}
            onPress={onEstimate}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{t("getEstimate")}</Text>
          </TouchableOpacity>
        )}
      </View>
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
  input: {
    borderWidth: 1,
    borderColor: "#d6ded9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  fare: { fontSize: 15, fontWeight: "600", color: "#123326" },
  statusTitle: { fontSize: 18, fontWeight: "700", color: "#123326" },
  row: { color: "#374b41", fontSize: 15 },
  button: {
    backgroundColor: "#17603f",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: "white", fontWeight: "600" },
  cancelButton: { alignItems: "center", paddingVertical: 10 },
  cancelText: { color: "#b3261e" },
});
