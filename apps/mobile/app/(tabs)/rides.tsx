import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "@/api";
import { formatMoney, useT } from "@/i18n";

interface RideRow {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  currency: string;
  estimatedFareMinor: number | null;
  finalFareMinor: number | null;
  requestedAt: string;
}

export default function RidesScreen() {
  const t = useT();
  const [rides, setRides] = useState<RideRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setRides(await api<RideRow[]>("/v1/rides"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={rides}
      keyExtractor={(r) => r.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load()} />
      }
      ListEmptyComponent={
        <Text style={styles.muted}>{t("history")}: —</Text>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.date}>
              {new Date(item.requestedAt).toLocaleString()}
            </Text>
            <Text style={styles.status}>{item.status}</Text>
          </View>
          <Text style={styles.route}>
            {item.pickupAddress} → {item.dropoffAddress}
          </Text>
          <Text style={styles.fare}>
            {formatMoney(item.finalFareMinor ?? item.estimatedFareMinor, item.currency)}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: "white",
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#e3e9e5",
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between" },
  date: { color: "#5a6e64", fontSize: 13 },
  status: { color: "#17603f", fontSize: 12, fontWeight: "600" },
  route: { color: "#1c2a23", fontSize: 15 },
  fare: { fontWeight: "700", color: "#123326" },
  muted: { color: "#5a6e64", textAlign: "center", marginTop: 40 },
});
