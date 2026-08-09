import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../src/api/session';
import { useTheme } from '../src/theme/ThemeProvider';

/** Aiguillage : session restaurée ou non. */
export default function Index() {
  const { status } = useSession();
  const t = useTheme();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.energy} />
      </View>
    );
  }
  return <Redirect href={status === 'signed-in' ? '/(tabs)' : '/login'} />;
}
