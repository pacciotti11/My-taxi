import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Placeholder for the native map. The real implementation drops in
 * react-native-maps (Google/Apple) via an Expo development build — Expo Go
 * cannot provide production GPS + maps. The surrounding screens only depend
 * on this component's props, so the swap is local.
 */
export function MapPlaceholder({
  label,
  driverPosition,
}: {
  label: string;
  driverPosition?: { lat: number; lng: number } | null;
}) {
  return (
    <View style={styles.map}>
      <Text style={styles.label}>{label}</Text>
      {driverPosition && (
        <Text style={styles.coords}>
          🚗 {driverPosition.lat.toFixed(5)}, {driverPosition.lng.toFixed(5)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 220,
    borderRadius: 16,
    backgroundColor: "#e5efe9",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: { color: "#4b6358", fontSize: 13 },
  coords: { color: "#17603f", fontVariant: ["tabular-nums"] },
});
