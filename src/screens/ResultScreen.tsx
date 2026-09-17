import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { getVideoDurationLimitMessage, pickVideoFromLibrary } from '../utils/video';
import { colors, fontSize, radius, space } from '../theme';

type ResultNavProp = StackNavigationProp<RootStackParamList, 'Result'>;
type ResultRouteProp = RouteProp<RootStackParamList, 'Result'>;

interface Props {
  navigation: ResultNavProp;
  route: ResultRouteProp;
}

const FIREWORK_PARTICLES = Array.from({ length: 24 }, (_, index) => {
  const burstIndex = index % 12;
  const burstSide = index < 12 ? 'left' : 'right';
  const angle = (burstIndex / 12) * Math.PI * 2 - Math.PI / 2;
  const radius = 78 + burstIndex * 10;

  return {
    key: `particle-${index}`,
    burstSide,
    angle,
    radius,
    color: [colors.gold, '#FF5E7D', colors.primarySoft, '#A78BFA', '#7DD3FC'][index % 5],
    icon: index % 4 === 0 ? '✦' : index % 4 === 1 ? '✺' : '•',
    delay: burstIndex * 70,
  };
});

function FireworksOverlay({ active }: { active: boolean }) {
  const progressValues = useRef(FIREWORK_PARTICLES.map(() => new Animated.Value(0))).current;
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progressValues.forEach((value) => value.stopAnimation());
    flash.stopAnimation();

    if (!active) {
      progressValues.forEach((value) => value.setValue(0));
      flash.setValue(0);
      return;
    }

    const animations = progressValues.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(FIREWORK_PARTICLES[index].delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 1100,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(260),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      )
    );

    const flashLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flash, {
          toValue: 0,
          duration: 520,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(620),
      ])
    );

    animations.forEach((animation) => animation.start());
    flashLoop.start();

    return () => {
      animations.forEach((animation) => animation.stop());
      progressValues.forEach((value) => value.stopAnimation());
      flashLoop.stop();
      flash.stopAnimation();
    };
  }, [active, flash, progressValues]);

  if (!active) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.fireworksOverlay}>
      <Animated.View
        style={[
          styles.fireworksFlash,
          {
            opacity: flash.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.85],
            }),
            transform: [
              { translateX: -140 },
              { scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) },
            ],
          },
        ]}
      />
      {FIREWORK_PARTICLES.map((particle, index) => {
        const progress = progressValues[index];
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.cos(particle.angle) * particle.radius],
        });
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(particle.angle) * particle.radius - 58],
        });
        const scale = progress.interpolate({
          inputRange: [0, 0.18, 0.7, 1],
          outputRange: [0.2, 1, 1.12, 0.8],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 0.1, 0.82, 1],
          outputRange: [0, 1, 1, 0],
        });

        return (
          <Animated.Text
            key={particle.key}
            style={[
              styles.fireworkParticle,
              {
                left: particle.burstSide === 'left' ? '20%' : '74%',
                color: particle.color,
                opacity,
                transform: [{ translateX }, { translateY }, { scale }],
              },
            ]}
          >
            {particle.icon}
          </Animated.Text>
        );
      })}
    </View>
  );
}

export default function ResultScreen({ navigation, route }: Props) {
  const { playerName, result, leaderboardPlacement } = route.params;
  const didEnterLeaderboard = leaderboardPlacement.qualified && leaderboardPlacement.celebrate !== false;
  const personal = leaderboardPlacement.personal ?? null;
  const hasPreviousClips = personal !== null && personal.personalTotal > 1;
  // Only claim a place on the board when the result screen and the home board
  // quote the same number, so a lower clip never borrows the player's old rank.
  const showPersonalBestBadge = !leaderboardPlacement.rank && hasPreviousClips && personal?.isPersonalBest === true;
  const showProgressCard = !leaderboardPlacement.rank && hasPreviousClips && personal?.isPersonalBest === false;
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroTranslateY = useRef(new Animated.Value(20)).current;
  const scorePulse = useRef(new Animated.Value(1)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const feedbackTranslateY = useRef(new Animated.Value(26)).current;
  const actionsOpacity = useRef(new Animated.Value(0)).current;
  const actionsTranslateY = useRef(new Animated.Value(26)).current;
  const scoreCounter = useRef(new Animated.Value(0)).current;
  const [displayScore, setDisplayScore] = React.useState(0);

  const strengths = useMemo(
    () => (result.strengths.length > 0 ? result.strengths : ['Keep it up. Another clip will tell us more.']),
    [result.strengths]
  );
  const improvements = useMemo(
    () =>
      result.improvements.length > 0
        ? result.improvements
        : ['Record another rally for more detailed coaching.'],
    [result.improvements]
  );

  useEffect(() => {
    const scoreListener = scoreCounter.addListener(({ value }) => {
      setDisplayScore(Math.round(value));
    });

    Animated.sequence([
      Animated.parallel([
        Animated.timing(heroOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(heroTranslateY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scoreCounter, {
          toValue: result.score,
          duration: 1100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
      Animated.parallel([
        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(feedbackTranslateY, {
          toValue: 0,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(actionsOpacity, {
          toValue: 1,
          duration: 340,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(actionsTranslateY, {
          toValue: 0,
          duration: 340,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scorePulse, {
          toValue: didEnterLeaderboard ? 1.05 : 1.02,
          duration: didEnterLeaderboard ? 850 : 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scorePulse, {
          toValue: 1,
          duration: didEnterLeaderboard ? 850 : 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    return () => {
      scoreCounter.removeListener(scoreListener);
      pulseLoop.stop();
      scorePulse.stopAnimation();
    };
  }, [
    actionsOpacity,
    actionsTranslateY,
    didEnterLeaderboard,
    feedbackOpacity,
    feedbackTranslateY,
    heroOpacity,
    heroTranslateY,
    result.score,
    scoreCounter,
    scorePulse,
  ]);

  async function pickAndUpload() {
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
      navigation.replace('TargetSelect', { videoUri: picked.asset.uri, playerName });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View
          style={[
            styles.heroCard,
            { opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] },
          ]}
        >
          <Text style={styles.heroEyebrow}>ANALYSIS COMPLETE</Text>
          <Text style={styles.playerName}>
            {leaderboardPlacement.rank
              ? `Nice work, ${playerName}`
              : showPersonalBestBadge
                ? `Personal best, ${playerName}`
                : `Great effort, ${playerName}`}
          </Text>

          <Animated.View style={[styles.scoreDiscWrapper, { transform: [{ scale: scorePulse }] }]}>
            <View style={styles.scoreDisc}>
              <Text style={styles.score}>{displayScore}</Text>
              <Text style={styles.scoreSuffix}>out of 100</Text>
            </View>
          </Animated.View>

          {leaderboardPlacement.rank ? (
            <View style={styles.medalRow}>
              <View style={styles.medalPill}>
                <View style={styles.medalDot} />
                <Text style={styles.medalText}>#{leaderboardPlacement.rank} on the board</Text>
              </View>
            </View>
          ) : null}

          {showPersonalBestBadge ? (
            <View style={styles.medalRow}>
              <View style={[styles.medalPill, styles.bestPill]}>
                <View style={[styles.medalDot, styles.bestDot]} />
                <Text style={[styles.medalText, styles.bestText]}>Personal best so far</Text>
              </View>
            </View>
          ) : null}

          {showProgressCard && personal ? (
            <View style={styles.progressCard}>
              <Text style={styles.progressTitle}>YOUR PROGRESS</Text>

              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>Best score</Text>
                <Text style={styles.progressValue}>{personal.personalBestScore}</Text>
              </View>

              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>This clip</Text>
                <Text style={styles.progressValue}>
                  #{personal.personalRank} of {personal.personalTotal}
                </Text>
              </View>

              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>To your best</Text>
                <Text style={[styles.progressValue, styles.progressGap]}>
                  {personal.pointsToBest} pts to go
                </Text>
              </View>
            </View>
          ) : null}
        </Animated.View>

        <Animated.View
          style={[
            styles.feedbackGroup,
            { opacity: feedbackOpacity, transform: [{ translateY: feedbackTranslateY }] },
          ]}
        >
          <View style={styles.feedbackCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.checkBadge}>
                <View style={styles.checkMark} />
              </View>
              <Text style={styles.sectionTitle}>What went well</Text>
            </View>
            {strengths.map((item, index) => (
              <Text key={index} style={styles.bullet}>
                {item}
              </Text>
            ))}
          </View>

          <View style={[styles.feedbackCard, styles.feedbackCardFocus]}>
            <View style={styles.sectionHeader}>
              <View style={styles.focusBadge}>
                <Text style={styles.focusBadgeText}>!</Text>
              </View>
              <Text style={styles.sectionTitle}>Next focus</Text>
            </View>
            {improvements.map((item, index) => (
              <Text key={index} style={styles.bullet}>
                {item}
              </Text>
            ))}
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.actionsGroup,
            { opacity: actionsOpacity, transform: [{ translateY: actionsTranslateY }] },
          ]}
        >
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Record', { playerName })}
          >
            <Text style={styles.primaryButtonText}>Record another clip</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={pickAndUpload}>
            <Text style={styles.secondaryButtonText}>Upload a saved video</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.textButton}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={styles.textButtonText}>Back home</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
      <FireworksOverlay active={didEnterLeaderboard} />
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
    alignItems: 'center',
    marginBottom: space.md,
  },
  heroEyebrow: {
    fontSize: fontSize.label,
    fontWeight: '700',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: space.xs,
  },
  playerName: {
    fontSize: fontSize.card,
    fontWeight: '700',
    color: colors.surface,
    textAlign: 'center',
    marginBottom: space.md,
  },
  scoreDiscWrapper: {
    marginBottom: space.sm,
  },
  scoreDisc: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.primary,
    lineHeight: 58,
  },
  scoreSuffix: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.muted,
  },
  medalRow: {
    flexDirection: 'row',
  },
  medalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  medalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7A4A00',
    marginRight: space.xs,
  },
  medalText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: '#4A2A00',
  },
  bestPill: {
    backgroundColor: colors.successTint,
  },
  bestDot: {
    backgroundColor: colors.success,
  },
  bestText: {
    color: colors.success,
  },
  progressCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.large,
    padding: space.md,
    marginTop: space.sm,
  },
  progressTitle: {
    fontSize: fontSize.label,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: space.sm,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  progressLabel: {
    fontSize: fontSize.body,
    color: 'rgba(255,255,255,0.82)',
  },
  progressValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.surface,
  },
  progressGap: {
    color: colors.primaryTint,
  },
  feedbackGroup: {
    marginBottom: space.md,
  },
  feedbackCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xlarge,
    padding: space.md,
    marginBottom: space.xs,
  },
  feedbackCardFocus: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primarySoft,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.successTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
  checkMark: {
    width: 10,
    height: 6,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.success,
    transform: [{ rotate: '-45deg' }],
    marginTop: -2,
  },
  focusBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
  focusBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.primary,
  },
  sectionTitle: {
    fontSize: fontSize.card,
    fontWeight: '700',
    color: colors.ink,
  },
  bullet: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.body,
    marginBottom: space.xs,
  },
  actionsGroup: {
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: radius.medium,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  secondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: radius.medium,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: space.sm,
  },
  textButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  fireworksOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 20,
  },
  fireworksFlash: {
    position: 'absolute',
    top: 40,
    left: '50%',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255,197,61,0.32)',
  },
  fireworkParticle: {
    position: 'absolute',
    top: 152,
    fontSize: 30,
    fontWeight: '700',
  },
});
