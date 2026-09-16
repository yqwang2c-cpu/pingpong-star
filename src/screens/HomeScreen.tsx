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
import {
  colors,
  fontSize,
  MAX_SCORE,
  radius,
  rankColor,
  rankTextColor,
  space,
} from '../theme';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

interface Props {
  navigation: HomeNavProp;
}

interface PlayerScore {
  id?: string;
  name: string;
  score: number;
  createdAt?: number;
  rank?: number;
}

const NAME_CHARACTERS = /[^A-Za-z '\-]/g;

function toCapitals(raw: string): string {
  return raw.replace(NAME_CHARACTERS, '').toUpperCase();
}

export default function HomeScreen({ navigation }: Props) {
  const [leaderboard, setLeaderboard] = useState<PlayerScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [givenName, setGivenName] = useState('');
  const [activeField, setActiveField] = useState<'family' | 'given' | null>(null);
  const [pendingAction, setPendingAction] = useState<'record' | 'upload' | null>(null);

  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroTranslateY = useRef(new Animated.Value(18)).current;
  const actionsOpacity = useRef(new Animated.Value(0)).current;
  const actionsTranslateY = useRef(new Animated.Value(26)).current;
  const boardOpacity = useRef(new Animated.Value(0)).current;
  const boardTranslateY = useRef(new Animated.Value(26)).current;
  const rowAnimations = useRef<Animated.Value[]>([]);

  const trimmedFamily = familyName.trim();
  const trimmedGiven = givenName.trim();
  const fullName = [trimmedFamily, trimmedGiven].filter(Boolean).join(' ');
  const initials = [trimmedFamily[0], trimmedGiven[0]].filter(Boolean).join('');
  const canContinue = trimmedFamily.length > 0 && trimmedGiven.length > 0;

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
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(heroTranslateY, {
          toValue: 0,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(actionsOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(actionsTranslateY, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(boardOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(boardTranslateY, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [
    actionsOpacity,
    actionsTranslateY,
    boardOpacity,
    boardTranslateY,
    heroOpacity,
    heroTranslateY,
  ]);

  useEffect(() => {
    const required = leaderboard.length;
    while (rowAnimations.current.length < required) {
      rowAnimations.current.push(new Animated.Value(0));
    }

    rowAnimations.current.forEach((value, index) => {
      if (index < required) value.setValue(0);
    });

    if (required === 0) return;

    Animated.stagger(
      80,
      leaderboard.map((_, index) =>
        Animated.timing(rowAnimations.current[index], {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
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
      while (rowAnimations.current.length < scores.length) {
        rowAnimations.current.push(new Animated.Value(0));
      }
      setLeaderboard(scores);
    } catch {
      setLeaderboard([]);
    } finally {
      setLoading(false);
    }
  }

  function askName(action: 'record' | 'upload') {
    setFamilyName('');
    setGivenName('');
    setActiveField(null);
    setPendingAction(action);
    setNameModalVisible(true);
  }

  function closeNameModal() {
    setNameModalVisible(false);
    setPendingAction(null);
  }

  async function onNameConfirmed() {
    if (!canContinue) {
      Alert.alert('Both fields are needed', 'Please fill in the family name and the given name.');
      return;
    }

    const name = fullName;
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.heroCard,
            { opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] },
          ]}
        >
          <Text style={styles.heroEyebrow}>PINGPONG STAR</Text>
          <Text style={styles.heroTitle}>Ready to play?</Text>
          <Text style={styles.heroSubtitle}>
            Record a 10-second rally and see how the shot scores.
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.actionGroup,
            { opacity: actionsOpacity, transform: [{ translateY: actionsTranslateY }] },
          ]}
        >
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => askName('record')}
            activeOpacity={0.85}
          >
            <View style={styles.primaryBadge}>
              <View style={styles.primaryBadgeDot} />
            </View>
            <Text style={styles.primaryButtonText}>Record a clip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => askName('upload')}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryButtonText}>Upload from gallery</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View
          style={[
            styles.boardCard,
            { opacity: boardOpacity, transform: [{ translateY: boardTranslateY }] },
          ]}
        >
          <View style={styles.boardHeader}>
            <Text style={styles.boardTitle}>Top players</Text>
            <Text style={styles.boardMeta}>top 5</Text>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.boardSpinner} />
          ) : leaderboard.length === 0 ? (
            <Text style={styles.emptyText}>No scores yet. Record the first clip.</Text>
          ) : (
            leaderboard.map((player, index) => {
              const rank = player.rank ?? index + 1;
              const progress = rowAnimations.current[index];

              return (
                <Animated.View
                  key={`${player.id ?? ''}-${player.name}-${player.score}-${player.createdAt ?? index}`}
                  style={[
                    styles.rankRow,
                    {
                      opacity: progress,
                      transform: [
                        {
                          translateY: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [14, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View
                    style={[styles.rankBadge, { backgroundColor: rankColor(rank) }]}
                  >
                    <Text style={[styles.rankBadgeText, { color: rankTextColor(rank) }]}>
                      {rank}
                    </Text>
                  </View>
                  <Text style={styles.rankName} numberOfLines={1}>
                    {player.name}
                  </Text>
                  <View style={styles.rankTrack}>
                    <View
                      style={[
                        styles.rankFill,
                        {
                          width: `${Math.round((player.score / MAX_SCORE) * 100)}%`,
                          backgroundColor: rank === 1 ? colors.primary : colors.primarySoft,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.rankScore}>{player.score}</Text>
                </Animated.View>
              );
            })
          )}
        </Animated.View>
      </ScrollView>

      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeNameModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Who is playing?</Text>
            <Text style={styles.modalSubtitle}>Names are saved in capitals</Text>

            <Text style={styles.fieldLabel}>FAMILY NAME</Text>
            <TextInput
              style={[styles.fieldInput, activeField === 'family' && styles.fieldInputActive]}
              value={familyName}
              onChangeText={(text) => setFamilyName(toCapitals(text))}
              onFocus={() => setActiveField('family')}
              onBlur={() => setActiveField(null)}
              placeholder="WANG"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              autoFocus
              maxLength={24}
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>GIVEN NAME</Text>
            <TextInput
              style={[styles.fieldInput, activeField === 'given' && styles.fieldInputActive]}
              value={givenName}
              onChangeText={(text) => setGivenName(toCapitals(text))}
              onFocus={() => setActiveField('given')}
              onBlur={() => setActiveField(null)}
              placeholder="YANYI"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              maxLength={24}
              returnKeyType="done"
              onSubmitEditing={onNameConfirmed}
            />

            {canContinue ? (
              <View style={styles.previewRow}>
                <View style={styles.previewAvatar}>
                  <Text style={styles.previewAvatarText}>{initials}</Text>
                </View>
                <View>
                  <Text style={styles.previewLabel}>Will show as</Text>
                  <Text style={styles.previewName}>{fullName}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={closeNameModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalStart, !canContinue && styles.modalStartDisabled]}
                onPress={onNameConfirmed}
                activeOpacity={0.85}
              >
                <Text style={styles.modalStartText}>Start</Text>
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
    backgroundColor: colors.canvas,
  },
  scroll: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.xlarge,
    padding: space.lg,
    marginBottom: space.md,
  },
  heroEyebrow: {
    fontSize: fontSize.label,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: space.xs,
  },
  heroTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.surface,
    marginBottom: space.xs,
  },
  heroSubtitle: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.88)',
  },
  actionGroup: {
    marginBottom: space.md,
  },
  primaryButton: {
    height: 58,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  primaryBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  primaryBadgeDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
    color: colors.surface,
  },
  secondaryButton: {
    height: 48,
    borderRadius: radius.medium,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  secondaryButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.primary,
  },
  boardCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xlarge,
    padding: space.md,
  },
  boardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  boardTitle: {
    fontSize: fontSize.card,
    fontWeight: '700',
    color: colors.ink,
  },
  boardMeta: {
    fontSize: fontSize.label,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.primary,
  },
  boardSpinner: {
    marginVertical: space.xl,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  rankBadgeText: {
    fontSize: fontSize.micro,
    fontWeight: '700',
  },
  rankName: {
    width: 84,
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.ink,
  },
  rankTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.hairline,
    overflow: 'hidden',
    marginRight: space.sm,
  },
  rankFill: {
    height: 8,
    borderRadius: 4,
  },
  rankScore: {
    width: 28,
    textAlign: 'right',
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.ink,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(43,33,25,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xlarge,
    padding: space.lg,
  },
  modalTitle: {
    fontSize: fontSize.card,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: fontSize.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: space.lg,
  },
  fieldLabel: {
    fontSize: fontSize.label,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.muted,
    marginBottom: space.xs,
  },
  fieldInput: {
    height: 46,
    borderRadius: radius.small,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: space.sm,
    fontSize: fontSize.body,
    letterSpacing: 1,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: space.sm,
  },
  fieldInputActive: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderRadius: radius.small,
    padding: space.sm,
    marginTop: space.xs,
  },
  previewAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  previewAvatarText: {
    fontSize: fontSize.micro,
    fontWeight: '700',
    color: colors.surface,
  },
  previewLabel: {
    fontSize: fontSize.label,
    color: colors.muted,
  },
  previewName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.ink,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.md,
  },
  modalCancel: {
    flex: 1,
    height: 46,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.body,
  },
  modalStart: {
    flex: 1,
    height: 46,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalStartDisabled: {
    backgroundColor: colors.primarySoft,
  },
  modalStartText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.surface,
  },
});
