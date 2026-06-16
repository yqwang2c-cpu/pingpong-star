import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { getVideoDurationLimitMessage, pickVideoFromLibrary } from '../utils/video';

type ResultNavProp = StackNavigationProp<RootStackParamList, 'Result'>;
type ResultRouteProp = RouteProp<RootStackParamList, 'Result'>;

interface Props {
  navigation: ResultNavProp;
  route: ResultRouteProp;
}

const FIREWORK_PARTICLES = Array.from({ length: 14 }, (_, index) => {
  const burstIndex = index % 7;
  const burstSide = index < 7 ? 'left' : 'right';
  const angle = (burstIndex / 7) * Math.PI * 2 - Math.PI / 2;
  const radius = 54 + burstIndex * 8;

  return {
    key: `particle-${index}`,
    burstSide,
    angle,
    radius,
    color: ['#F7B500', '#FF5E7D', '#7DD3FC', '#A78BFA', '#11B89A'][index % 5],
    icon: index % 3 === 0 ? '✦' : '•',
    delay: burstIndex * 110,
  };
});

function FireworksOverlay({ active }: { active: boolean }) {
  const progressValues = useRef(FIREWORK_PARTICLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    progressValues.forEach((value) => value.stopAnimation());

    if (!active) {
      progressValues.forEach((value) => value.setValue(0));
      return;
    }

    const animations = progressValues.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(FIREWORK_PARTICLES[index].delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 1250,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(380),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      )
    );

    animations.forEach((animation) => animation.start());

    return () => {
      animations.forEach((animation) => animation.stop());
      progressValues.forEach((value) => value.stopAnimation());
    };
  }, [active, progressValues]);

  if (!active) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.fireworksOverlay}>
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
  const didEnterLeaderboard = leaderboardPlacement.qualified;
  const strengths = useMemo(
    () => (result.strengths.length > 0 ? result.strengths : ['No clear strengths yet.']),
    [result.strengths]
  );
  const improvements = useMemo(
    () =>
      result.improvements.length > 0
        ? result.improvements
        : ['Keep practicing and upload another clip for more detailed coaching.'],
    [result.improvements]
  );

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
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <FireworksOverlay active={didEnterLeaderboard} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>Analysis complete</Text>
          <Text style={styles.playerName}>{playerName}</Text>
          <Text style={styles.heroTitle}>
            {didEnterLeaderboard ? 'Fireworks! This score entered the Top 5.' : 'Great effort. Keep building consistency.'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {didEnterLeaderboard && leaderboardPlacement.rank
              ? `Live leaderboard rank: #${leaderboardPlacement.rank}`
              : 'This result was saved. Upload another clip anytime for a fresh analysis.'}
          </Text>
          <View style={styles.scoreRing}>
            <Text style={styles.scoreLabel}>Overall score</Text>
            <Text style={styles.score}>{result.score}</Text>
            <Text style={styles.scoreSuffix}>/ 100</Text>
          </View>
          {result.frames.length > 0 ? (
            <Text style={styles.framesInfo}>Analyzed {result.frames.length} extracted frames</Text>
          ) : null}
        </View>

        {didEnterLeaderboard && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              New leaderboard entry {leaderboardPlacement.rank ? `#${leaderboardPlacement.rank}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.feedbackCard}>
          <Text style={styles.sectionTitle}>What went well</Text>
          {strengths.map((item, index) => (
            <Text key={index} style={styles.bullet}>• {item}</Text>
          ))}
        </View>

        <View style={styles.feedbackCard}>
          <Text style={styles.sectionTitle}>What to improve next</Text>
          {improvements.map((item, index) => (
            <Text key={index} style={styles.bullet}>• {item}</Text>
          ))}
        </View>

        <TouchableOpacity
          style={styles.recordAgainButton}
          onPress={() => navigation.navigate('Record', { playerName })}
        >
          <Text style={styles.recordAgainText}>Record a new clip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.uploadAgainButton}
          onPress={pickAndUpload}
        >
          <Text style={styles.uploadAgainText}>Upload another video</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.homeButton}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.homeText}>Back to home</Text>
        </TouchableOpacity>
      </ScrollView>
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
    top: -70,
    left: -20,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(91, 140, 255, 0.18)',
  },
  orbBottom: {
    position: 'absolute',
    bottom: -90,
    right: -20,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(17, 184, 154, 0.12)',
  },
  fireworksOverlay: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    height: 220,
  },
  fireworkParticle: {
    position: 'absolute',
    top: 126,
    fontSize: 22,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#101B30',
    borderRadius: 30,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 8,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#7DD3FC',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  playerName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    color: '#F7FAFF',
    fontWeight: '700',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: '#BFD0EB',
    marginBottom: 20,
  },
  scoreRing: {
    width: 190,
    height: 190,
    borderRadius: 95,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7FAFF',
    marginBottom: 12,
    borderWidth: 8,
    borderColor: 'rgba(91, 140, 255, 0.18)',
  },
  scoreLabel: {
    fontSize: 14,
    color: '#556785',
  },
  score: {
    fontSize: 74,
    fontWeight: '800',
    color: '#10203A',
    lineHeight: 82,
  },
  scoreSuffix: {
    fontSize: 18,
    color: '#60708F',
  },
  framesInfo: {
    fontSize: 12,
    color: '#8EA2C6',
  },
  banner: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: 'rgba(247, 181, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(247, 181, 0, 0.38)',
  },
  bannerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFE7A0',
    textAlign: 'center',
  },
  feedbackCard: {
    backgroundColor: '#F7FAFF',
    borderRadius: 24,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#13203A',
    marginBottom: 10,
  },
  bullet: {
    fontSize: 15,
    color: '#40506B',
    lineHeight: 24,
    marginBottom: 8,
  },
  recordAgainButton: {
    backgroundColor: '#5B8CFF',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    shadowColor: '#5B8CFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 7,
  },
  recordAgainText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  uploadAgainButton: {
    backgroundColor: '#11B89A',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
  uploadAgainText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  homeButton: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  homeText: {
    color: '#E8F0FF',
    fontSize: 17,
    fontWeight: '600',
  },
});
