import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { SERVER_URL } from '../config/api';
import { getVideoDurationLimitMessage, pickVideoFromLibrary } from '../utils/video';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

interface Props {
  navigation: HomeNavProp;
}

const MAX_BAR_HEIGHT = 160;
const MAX_SCORE = 100;

interface PlayerScore {
  id?: string;
  name: string;
  score: number;
  createdAt?: number;
  rank?: number;
}

export default function HomeScreen({ navigation }: Props) {
  const [leaderboard, setLeaderboard] = useState<PlayerScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [inputName, setInputName] = useState('');
  const [pendingAction, setPendingAction] = useState<'record' | 'upload' | null>(null);
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroTranslateY = useRef(new Animated.Value(18)).current;
  const leaderboardOpacity = useRef(new Animated.Value(0)).current;
  const leaderboardTranslateY = useRef(new Animated.Value(26)).current;
  const actionsOpacity = useRef(new Animated.Value(0)).current;
  const actionsTranslateY = useRef(new Animated.Value(32)).current;
  const barAnimations = useRef<Animated.Value[]>([]);

  useFocusEffect(
    useCallback(() => {
      fetchLeaderboard();
    }, [])
  );

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(heroOpacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(heroTranslateY, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(leaderboardOpacity, {
          toValue: 1,
          duration: 440,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(leaderboardTranslateY, {
          toValue: 0,
          duration: 440,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(actionsOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(actionsTranslateY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [actionsOpacity, actionsTranslateY, heroOpacity, heroTranslateY, leaderboardOpacity, leaderboardTranslateY]);

  useEffect(() => {
    const required = leaderboard.length;
    while (barAnimations.current.length < required) {
      barAnimations.current.push(new Animated.Value(0));
    }

    barAnimations.current.forEach((value, index) => {
      if (index < required) value.setValue(0);
    });

    if (required === 0) return;

    Animated.stagger(
      90,
      leaderboard.map((_, index) =>
        Animated.timing(barAnimations.current[index], {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
      )
    ).start();
  }, [leaderboard]);

  async function fetchLeaderboard() {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/scores`);
      const data = await res.json();
      const scores = (data.scores ?? []) as PlayerScore[];
      while (barAnimations.current.length < scores.length) {
        barAnimations.current.push(new Animated.Value(0));
      }
      setLeaderboard(scores);
    } catch {
      setLeaderboard([]);
    } finally {
      setLoading(false);
    }
  }

  function askName(action: 'record' | 'upload') {
    setInputName('');
    setPendingAction(action);
    setNameModalVisible(true);
  }

  async function onNameConfirmed() {
    const name = inputName.trim();
    if (!name) {
      Alert.alert('Enter a player name');
      return;
    }
    setNameModalVisible(false);

    if (pendingAction === 'record') {
      navigation.navigate('Record', { playerName: name });
    } else {
      await pickAndAnalyzeVideo(name);
    }
  }

  async function pickAndAnalyzeVideo(playerName: string) {
    const picked = await pickVideoFromLibrary();
    if (picked.status === 'permission_denied') {
      Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
      return;
    }

    if (picked.status === 'too_long') {
      Alert.alert('Video too long', getVideoDurationLimitMessage());
      return;
    }

    if (picked.status === 'picked') {
      navigation.navigate('TargetSelect', { videoUri: picked.asset.uri, playerName });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.orbTop} />
      <View style={styles.orbRight} />
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.heroCard,
            { opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] },
          ]}
        >
          <Text style={styles.eyebrow}>Smart training for young players</Text>
          <Text style={styles.title}>PingPong Star</Text>
          <Text style={styles.subtitle}>
            Record or upload a short clip, then tap the player to analyze.
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>10s max</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Top 5 ranks</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>English feedback</Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.leaderboardCard,
            { opacity: leaderboardOpacity, transform: [{ translateY: leaderboardTranslateY }] },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardEyebrow}>All-time ranking</Text>
            <Text style={styles.leaderboardTitle}>Top ranks</Text>
          </View>

          <View style={styles.chartRow}>
            {loading ? (
              <ActivityIndicator size="small" color="#5B8CFF" />
            ) : leaderboard.length === 0 ? (
              <Text style={styles.emptyText}>No scores yet.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chartContent}
              >
                {leaderboard.map((player, index) => {
                  const rank = player.rank ?? index + 1;
                  const barHeight = (player.score / MAX_SCORE) * MAX_BAR_HEIGHT;
                  const barColor =
                    rank === 1 ? '#F7B500' : rank === 2 ? '#7DD3FC' : rank === 3 ? '#A78BFA' : '#5B8CFF';

                  return (
                    <View key={`${player.id ?? ''}-${player.name}-${player.score}-${player.createdAt ?? index}`} style={styles.barColumn}>
                      {rank === 1 ? <Text style={styles.topBadge}>★</Text> : <View style={styles.badgeSpacer} />}
                      <Text style={styles.barScore}>{player.score}</Text>
                      <Animated.View
                        style={[
                          styles.bar,
                          {
                            backgroundColor: barColor,
                            height: barAnimations.current[index].interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, barHeight],
                            }),
                            opacity: barAnimations.current[index].interpolate({
                              inputRange: [0, 0.2, 1],
                              outputRange: [0.4, 0.7, 1],
                            }),
                          },
                        ]}
                      />
                      <Text style={styles.barRank}>#{rank}</Text>
                      <Text style={styles.barName}>{player.name}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.buttonRow,
            { opacity: actionsOpacity, transform: [{ translateY: actionsTranslateY }] },
          ]}
        >
          <View style={styles.actionItem}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => askName('record')}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonIcon}>🎥</Text>
              <Text style={styles.actionTitle}>Record</Text>
              <Text style={styles.actionSubtitle}>10-second limit.</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionItem}>
            <TouchableOpacity
              style={[styles.actionCard, styles.uploadCard]}
              onPress={() => askName('upload')}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonIcon}>📂</Text>
              <Text style={styles.actionTitle}>Upload</Text>
              <Text style={styles.actionSubtitle}>Pick a clip and tap the player.</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <Text style={styles.footerHint}>Fireworks show only when you enter the leaderboard.</Text>
      </View>

      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Player name</Text>
            <Text style={styles.modalSubtitle}>Enter the name to show on this result and the leaderboard.</Text>
            <TextInput
              style={styles.nameInput}
              value={inputName}
              onChangeText={setInputName}
              placeholder="For example: Mia"
              placeholderTextColor="#8FA1CC"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={onNameConfirmed}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setNameModalVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={onNameConfirmed}>
                <Text style={styles.confirmText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#081120',
  },
  orbTop: {
    position: 'absolute',
    top: -60,
    left: -20,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(91, 140, 255, 0.18)',
  },
  orbRight: {
    position: 'absolute',
    top: 120,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(37, 211, 171, 0.12)',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  heroCard: {
    backgroundColor: '#101B30',
    borderRadius: 28,
    padding: 22,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 8,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#7DD3FC',
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#F7FAFF',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#C1CEE8',
    marginBottom: 18,
  },
  heroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statLabel: {
    color: '#E9F1FF',
    fontSize: 12,
    fontWeight: '600',
  },
  leaderboardCard: {
    backgroundColor: '#F7FAFF',
    borderRadius: 28,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
    marginBottom: 18,
  },
  cardHeader: {
    marginBottom: 16,
  },
  cardEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5B8CFF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  leaderboardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#13203A',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: MAX_BAR_HEIGHT + 64,
    paddingTop: 10,
  },
  chartContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 6,
  },
  barColumn: {
    alignItems: 'center',
    width: 52,
  },
  topBadge: {
    fontSize: 14,
    color: '#F7B500',
    marginBottom: 4,
  },
  badgeSpacer: {
    height: 18,
    marginBottom: 4,
  },
  bar: {
    width: 32,
    borderRadius: 10,
  },
  barScore: {
    fontSize: 12,
    color: '#20304C',
    marginBottom: 6,
    fontWeight: '600',
  },
  barRank: {
    fontSize: 13,
    color: '#60708F',
    marginTop: 8,
  },
  barName: {
    fontSize: 11,
    color: '#41516E',
    marginTop: 4,
    maxWidth: 52,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 14,
  },
  actionItem: {
    flex: 1,
  },
  actionCard: {
    minHeight: 168,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: '#5B8CFF',
    shadowColor: '#5B8CFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 6,
  },
  uploadCard: {
    backgroundColor: '#11B89A',
    shadowColor: '#11B89A',
  },
  buttonIcon: {
    fontSize: 34,
    marginBottom: 18,
  },
  actionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  actionSubtitle: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 14,
    color: '#5A6C8C',
    textAlign: 'center',
    paddingVertical: 40,
  },
  footerHint: {
    marginTop: 16,
    fontSize: 13,
    lineHeight: 20,
    color: '#9DB0D1',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 9, 20, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    width: '82%',
    backgroundColor: '#F7FAFF',
    borderRadius: 24,
    padding: 24,
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#10203A',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#687A97',
    textAlign: 'center',
    lineHeight: 20,
  },
  nameInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1DCF2',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#222',
    textAlign: 'center',
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D1DCF2',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelText: {
    fontSize: 16,
    color: '#5A6C8C',
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#5B8CFF',
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
