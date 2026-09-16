import React, { useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import type {
  AnalysisResult,
  AnalyzeSessionPreview,
  LeaderboardPlacement,
  PersonalStanding,
} from '../types/analysis';
import { SERVER_URL } from '../config/api';
import {
  DEFAULT_POINT,
  getCachedAnalysis,
  getVideoMd5,
  makeCacheKey,
  setCachedAnalysis,
} from '../utils/analysisCache';
import {
  getVideoDurationLimitMessage,
  inferVideoMimeType,
  pickVideoFromLibrary,
} from '../utils/video';
import { colors, fontSize, radius, space } from '../theme';

type TargetSelectNavProp = StackNavigationProp<RootStackParamList, 'TargetSelect'>;
type TargetSelectRouteProp = RouteProp<RootStackParamList, 'TargetSelect'>;

interface Props {
  navigation: TargetSelectNavProp;
  route: TargetSelectRouteProp;
}

type ScreenState = 'preparing' | 'ready' | 'submitting' | 'error';
type SelectedPoint = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getReadableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('Network request failed')) {
      return 'Network request failed. Please make sure this device can reach the server.';
    }
    return error.message;
  }

  return 'Analysis failed. Please try again.';
}

function parseAnalysisResult(data: Record<string, unknown> | null): AnalysisResult {
  return {
    frames: Array.isArray(data?.frames) ? (data.frames as string[]) : [],
    score: typeof data?.score === 'number' ? data.score : 0,
    strengths: Array.isArray(data?.strengths) ? (data.strengths as string[]) : [],
    improvements: Array.isArray(data?.improvements) ? (data.improvements as string[]) : [],
  };
}

function getAnalysisKey(
  data: Record<string, unknown> | null,
  fallbackMd5: string | null,
  point: SelectedPoint
): string | null {
  if (typeof data?.analysisKey === 'string' && data.analysisKey.length > 0) {
    return data.analysisKey;
  }

  return fallbackMd5 ? makeCacheKey(fallbackMd5, point) : null;
}

export default function TargetSelectScreen({ navigation, route }: Props) {
  const { videoUri, playerName } = route.params;
  const [screenState, setScreenState] = useState<ScreenState>('preparing');
  const [sessionPreview, setSessionPreview] = useState<AnalyzeSessionPreview | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const selectedPointRef = useRef<SelectedPoint | null>(null);
  const [videoMd5, setVideoMd5] = useState<string | null>(null);
  const [previewLayout, setPreviewLayout] = useState({ width: 0, height: 0 });
  const [errorMessage, setErrorMessage] = useState('');
  const screenOpacity = useRef(new Animated.Value(0)).current;
  const screenTranslateY = useRef(new Animated.Value(24)).current;
  const previewScale = useRef(new Animated.Value(0.97)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.8)).current;
  const autoAnalyzeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const md5 = await getVideoMd5(videoUri);
      if (cancelled) return;
      setVideoMd5(md5);

      if (md5) {
        const reused = await tryReuseAnalysis(md5, DEFAULT_POINT);
        if (cancelled) return;
        if (reused) {
          await setCachedAnalysis(reused.analysisKey, reused.result);
          const leaderboardPlacement = await saveScore(reused.result.score, reused.analysisKey);
          if (cancelled) return;
          navigation.replace('Result', {
            playerName,
            result: reused.result,
            leaderboardPlacement,
          });
          return;
        }

        const cacheKey = makeCacheKey(md5, DEFAULT_POINT);
        const cached = await getCachedAnalysis(cacheKey);
        if (cancelled) return;
        if (cached) {
          const leaderboardPlacement = await saveScore(cached.score, cacheKey);
          if (cancelled) return;
          navigation.replace('Result', {
            playerName,
            result: cached,
            leaderboardPlacement,
          });
          return;
        }
      }

      prepareSelectionSession(videoUri, md5);
    })();
    return () => {
      cancelled = true;
      if (autoAnalyzeTimeoutRef.current) {
        clearTimeout(autoAnalyzeTimeoutRef.current);
        autoAnalyzeTimeoutRef.current = null;
      }
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
        autoStartTimeoutRef.current = null;
      }
    };
  }, [navigation, playerName, videoUri]);

  useEffect(() => {
    selectedPointRef.current = selectedPoint;
  }, [selectedPoint]);

  useEffect(() => {
    if (screenState !== 'ready') return;

    Animated.parallel([
      Animated.timing(screenOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(screenTranslateY, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(previewScale, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [previewScale, screenOpacity, screenState, screenTranslateY]);

  useEffect(() => {
    if (!selectedPoint) {
      pulseScale.stopAnimation();
      pulseOpacity.stopAnimation();
      pulseScale.setValue(1);
      pulseOpacity.setValue(0.8);
      return;
    }

    const scaleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.6,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    const opacityLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.8,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    scaleLoop.start();
    opacityLoop.start();

    return () => {
      scaleLoop.stop();
      opacityLoop.stop();
      pulseScale.stopAnimation();
      pulseOpacity.stopAnimation();
    };
  }, [pulseOpacity, pulseScale, selectedPoint]);

  function getDefaultPlacement(): LeaderboardPlacement {
    return { qualified: false, rank: null, celebrate: false, personal: null };
  }

  function readPersonalStanding(raw: unknown): PersonalStanding | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Record<string, unknown>;
    const readNumber = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    const personalBestScore = readNumber(source.personalBestScore);
    const personalRank = readNumber(source.personalRank);
    const personalTotal = readNumber(source.personalTotal);
    if (personalBestScore === null || personalRank === null || personalTotal === null) {
      return null;
    }

    return {
      isPersonalBest: source.isPersonalBest === true,
      personalBestScore,
      personalRank,
      personalTotal,
      pointsToBest: readNumber(source.pointsToBest) ?? 0,
    };
  }

  async function saveScore(
    score: number,
    analysisKey?: string | null
  ): Promise<LeaderboardPlacement> {
    try {
      const response = await fetch(`${SERVER_URL}/api/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: playerName,
          score,
          ...(analysisKey ? { analysisKey } : {}),
        }),
      });

      const data = (await response.json()) as {
        reused?: unknown;
        leaderboard?: { qualified?: unknown; rank?: unknown; personal?: unknown };
      };

      if (!response.ok) {
        return getDefaultPlacement();
      }

      const qualified = data.leaderboard?.qualified === true;
      const reused = data.reused === true;
      return {
        qualified,
        rank: typeof data.leaderboard?.rank === 'number' ? data.leaderboard.rank : null,
        celebrate: qualified && !reused,
        personal: readPersonalStanding(data.leaderboard?.personal),
      };
    } catch {
      return getDefaultPlacement();
    }
  }

  async function tryReuseAnalysis(
    videoHash: string,
    point: SelectedPoint
  ): Promise<{ analysisKey: string; result: AnalysisResult } | null> {
    try {
      const response = await fetch(`${SERVER_URL}/api/analyze/reuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoHash,
          x: point.x,
          y: point.y,
        }),
      });

      const data = (await response.json()) as {
        reused?: unknown;
        analysisKey?: unknown;
        result?: Record<string, unknown> | null;
      };

      if (!response.ok || data.reused !== true || typeof data.analysisKey !== 'string') {
        return null;
      }

      return {
        analysisKey: data.analysisKey,
        result: parseAnalysisResult(data.result ?? null),
      };
    } catch {
      return null;
    }
  }

  async function prepareSelectionSession(uri: string, resolvedVideoMd5?: string | null) {
    try {
      setScreenState('preparing');
      setSessionPreview(null);
      setErrorMessage('');
      setSelectedPoint(null);
      selectedPointRef.current = null;
      if (autoAnalyzeTimeoutRef.current) {
        clearTimeout(autoAnalyzeTimeoutRef.current);
        autoAnalyzeTimeoutRef.current = null;
      }
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
        autoStartTimeoutRef.current = null;
      }

      const filename = uri.split('/').pop() ?? 'video.mov';
      const formData = new FormData();
      formData.append('video', {
        uri,
        name: filename,
        type: inferVideoMimeType(filename),
      } as unknown as Blob);
      const uploadVideoMd5 = resolvedVideoMd5 ?? videoMd5;
      if (uploadVideoMd5) {
        formData.append('videoHash', uploadVideoMd5);
      }

      const response = await fetch(`${SERVER_URL}/api/analyze/session`, {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let data: Record<string, unknown> | null = null;

      if (responseText) {
        try {
          data = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          if (!response.ok) {
            throw new Error(responseText);
          }
          throw new Error('The preview response is missing required data.');
        }
      }

      if (!response.ok) {
        const serverError =
          typeof data?.error === 'string' ? data.error : `Server error (${response.status})`;
        throw new Error(serverError);
      }

      if (
        typeof data?.sessionId !== 'string' ||
        typeof data?.previewImage !== 'string' ||
        typeof data?.previewSize !== 'object' ||
        data.previewSize === null
      ) {
        throw new Error('The preview response is missing required data.');
      }

      const previewSize = data.previewSize as Record<string, unknown>;
      const preview: AnalyzeSessionPreview = {
        sessionId: data.sessionId,
        previewImage: data.previewImage,
        previewSize: {
          width: typeof previewSize.width === 'number' ? previewSize.width : 1,
          height: typeof previewSize.height === 'number' ? previewSize.height : 1,
        },
      };

      setSessionPreview(preview);
      setScreenState('ready');

      autoStartTimeoutRef.current = setTimeout(() => {
        if (selectedPointRef.current) return;
        handleAnalyze({ x: 0.5, y: 0.5 });
      }, 650);
    } catch (error) {
      console.error('Failed to prepare player selection preview:', error);
      setSessionPreview(null);
      setErrorMessage(getReadableErrorMessage(error));
      setScreenState('error');
    }
  }

  function handlePreviewPress(event: GestureResponderEvent) {
    if (!previewLayout.width || !previewLayout.height) return;

    if (autoStartTimeoutRef.current) {
      clearTimeout(autoStartTimeoutRef.current);
      autoStartTimeoutRef.current = null;
    }

    const x = clamp(event.nativeEvent.locationX / previewLayout.width, 0, 1);
    const y = clamp(event.nativeEvent.locationY / previewLayout.height, 0, 1);
    const point = { x, y };
    setSelectedPoint(point);
    setErrorMessage('');

    if (screenState === 'ready' && sessionPreview) {
      if (autoAnalyzeTimeoutRef.current) {
        clearTimeout(autoAnalyzeTimeoutRef.current);
      }
      autoAnalyzeTimeoutRef.current = setTimeout(() => {
        handleAnalyze(point);
      }, 220);
    }
  }

  async function handleAnalyze(pointOverride?: SelectedPoint) {
    if (!sessionPreview) return;
    const pointToAnalyze = pointOverride ?? selectedPoint;
    if (!pointToAnalyze) {
      return;
    }

    try {
      setScreenState('submitting');
      setErrorMessage('');

      const response = await fetch(
        `${SERVER_URL}/api/analyze/session/${sessionPreview.sessionId}/select`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pointToAnalyze),
        }
      );

      const responseText = await response.text();
      let data: Record<string, unknown> | null = null;

      if (responseText) {
        try {
          data = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          if (!response.ok) {
            throw new Error(responseText);
          }
          throw new Error('The server returned an unreadable analysis result.');
        }
      }

      if (!response.ok) {
        const serverError =
          typeof data?.error === 'string' ? data.error : `Server error (${response.status})`;
        throw new Error(serverError);
      }

      const analysisResult = parseAnalysisResult(data);
      const analysisKey = getAnalysisKey(data, videoMd5, pointToAnalyze);
      const leaderboardPlacement = await saveScore(analysisResult.score, analysisKey);
      if (analysisKey) {
        await setCachedAnalysis(analysisKey, analysisResult);
      } else if (videoMd5) {
        await setCachedAnalysis(makeCacheKey(videoMd5, pointToAnalyze), analysisResult);
      }
      navigation.replace('Result', {
        playerName,
        result: analysisResult,
        leaderboardPlacement,
      });
    } catch (error) {
      console.error('Targeted analysis failed:', error);
      setErrorMessage(getReadableErrorMessage(error));
      setScreenState('ready');
    }
  }

  async function handlePickAnotherVideo() {
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

  if ((screenState === 'preparing' || !sessionPreview) && screenState !== 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Getting your clip ready...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'error' && !sessionPreview) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <View style={styles.errorBadge} />
          <Text style={styles.errorTitle}>Could not read this clip</Text>
          <Text style={styles.errorText}>
            {errorMessage || 'Please try again or pick a different video.'}
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => prepareSelectionSession(videoUri, videoMd5)}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={handlePickAnotherVideo}>
            <Text style={styles.textButtonText}>Use a different clip</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const statusText =
    screenState === 'submitting'
      ? 'Analyzing the clip...'
      : selectedPoint
        ? 'Player marked. Analyzing...'
        : 'Tap the player in the picture';
  const statusActive = screenState === 'submitting' || Boolean(selectedPoint);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View
          style={[
            styles.container,
            { opacity: screenOpacity, transform: [{ translateY: screenTranslateY }] },
          ]}
        >
          <View style={styles.playerRow}>
            <View style={styles.playerAvatar}>
              <Text style={styles.playerAvatarText}>{playerName.slice(0, 1)}</Text>
            </View>
            <Text style={styles.playerName}>{playerName}</Text>
          </View>

          <Text style={styles.title}>Pick the player</Text>
          <Text style={styles.subtitle}>
            Tap the player you want scored. Analysis starts right away.
          </Text>

          <Animated.View style={[styles.previewCard, { transform: [{ scale: previewScale }] }]}>
            <Pressable
              style={[
                styles.previewArea,
                {
                  aspectRatio:
                    sessionPreview!.previewSize.width / sessionPreview!.previewSize.height,
                },
              ]}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setPreviewLayout({ width, height });
              }}
              onPress={handlePreviewPress}
            >
              <Image
                source={{ uri: sessionPreview!.previewImage }}
                style={styles.previewImage}
                resizeMode="cover"
              />

              {selectedPoint ? (
                <>
                  <Animated.View
                    style={[
                      styles.markerPulse,
                      {
                        left: `${selectedPoint.x * 100}%`,
                        top: `${selectedPoint.y * 100}%`,
                        opacity: pulseOpacity,
                        transform: [{ scale: pulseScale }],
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.marker,
                      {
                        left: `${selectedPoint.x * 100}%`,
                        top: `${selectedPoint.y * 100}%`,
                      },
                    ]}
                  >
                    <View style={styles.markerCore} />
                  </View>
                </>
              ) : null}

              {screenState === 'submitting' ? (
                <View style={styles.previewOverlay}>
                  <ActivityIndicator size="large" color={colors.surface} />
                  <Text style={styles.previewOverlayText}>Analyzing...</Text>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, statusActive && styles.statusDotActive]} />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>

          {errorMessage ? <Text style={styles.inlineError}>{errorMessage}</Text> : null}

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handlePickAnotherVideo}
            disabled={screenState === 'submitting'}
          >
            <Text style={styles.secondaryButtonText}>Use a different clip</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  loadingText: {
    fontSize: fontSize.body,
    color: colors.body,
    textAlign: 'center',
  },
  errorBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: colors.primarySoft,
    marginBottom: space.xs,
  },
  errorTitle: {
    fontSize: fontSize.card,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  errorText: {
    fontSize: fontSize.body,
    color: colors.body,
    textAlign: 'center',
    lineHeight: 21,
  },
  container: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  scrollContent: {
    paddingBottom: space.xl,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  playerAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
  playerAvatarText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.surface,
  },
  playerName: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.primary,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: space.xs,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.body,
    lineHeight: 21,
    marginBottom: space.md,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xlarge,
    padding: space.sm,
  },
  previewArea: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.large,
    backgroundColor: colors.hairline,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    width: 38,
    height: 38,
    marginLeft: -19,
    marginTop: -19,
    borderRadius: 19,
    borderWidth: 2.5,
    borderColor: colors.surface,
    backgroundColor: 'rgba(255,107,44,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerCore: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  markerPulse: {
    position: 'absolute',
    width: 38,
    height: 38,
    marginLeft: -19,
    marginTop: -19,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,107,44,0.22)',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(43,33,25,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  previewOverlayText: {
    color: colors.surface,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
    marginBottom: space.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.hairline,
    marginRight: space.xs,
  },
  statusDotActive: {
    backgroundColor: colors.success,
  },
  statusText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.body,
  },
  inlineError: {
    color: colors.danger,
    textAlign: 'center',
    fontSize: fontSize.caption,
    lineHeight: 19,
    marginBottom: space.sm,
  },
  primaryButton: {
    width: '100%',
    maxWidth: 300,
    height: 50,
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
    height: 48,
    borderRadius: radius.medium,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: space.xs,
  },
  textButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
