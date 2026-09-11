import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { OrderStatus } from '@/lib/admin';

/**
 * One colour per status, and the same colour everywhere the status appears.
 * A manager scanning a list reads the colour before the word.
 */
const TONE: Record<OrderStatus, string> = {
  new: '#c8490f',
  paid: '#1c7a4a',
  packing: '#8a6a4f',
  shipped: '#2b3138',
  delivered: '#1c7a4a',
  cancelled: '#b3261e',
};

export function StatusChip({ status }: { status: OrderStatus }) {
  return (
    <View style={[styles.chip, { backgroundColor: TONE[status] }]}>
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  text: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
