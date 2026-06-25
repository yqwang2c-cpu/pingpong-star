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
        const cacheKey = makeCacheKey(md5, DEFAULT_POINT);
        const cached = await getCachedAnalysis(cacheKey);
        if (cancelled) return;
        if (cached) {
          navigation.replace('Result', {
            playerName,
            result: cached,
            leaderboardPlacement: { qualified: false, rank: null, celebrate: false },
          });
          return;
        }
      }

      prepareSelectionSession(videoUri);
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
    return { qualified: false, rank: null, celebrate: false };
  }

  async function saveScore(score: number): Promise<LeaderboardPlacement> {
    try {
      const response = await fetch(`${SERVER_URL}/api/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName, score }),
      });

      const data = (await response.json()) as {
        leaderboard?: { qualified?: unknown; rank?: unknown };
      };

      if (!response.ok) {
        return getDefaultPlacement();
      }

      const qualified = data.leaderboard?.qualified === true;
      return {
        qualified,
        rank: typeof data.leaderboard?.rank === 'number' ? data.leaderboard.rank : null,
        celebrate: qualified,
      };
    } catch {
      return getDefaultPlacement();
    }
  }

  async function prepareSelectionSession(uri: string) {
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
          throw new Error('The server returned an unreadable preview result.');
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
      Alert.alert('Choose a player first', 'Tap the player you want to analyze in the preview image.');
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
      const leaderboardPlacement = await saveScore(analysisResult.score);
      if (videoMd5) {
        const cacheKey = makeCacheKey(videoMd5, pointToAnalyze);
        await setCachedAnalysis(cacheKey, analysisResult);
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
          <ActivityIndicator size="large" color="#5B8CFF" />
          <Text style={styles.loadingText}>Uploading your clip and creating the player selection preview...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'error' && !sessionPreview) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorEmoji}>😢</Text>
          <Text style={styles.errorText}>{errorMessage || 'Could not create the player selection preview.'}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => prepareSelectionSession(videoUri)}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handlePickAnotherVideo}>
            <Text style={styles.secondaryButtonText}>Choose another video</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <Animated.View
        style={[
          styles.container,
          { opacity: screenOpacity, transform: [{ translateY: screenTranslateY }] },
        ]}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepLabel}>Step 2</Text>
          <Text style={styles.title}>Tap the player to score</Text>
          <Text style={styles.subtitle}>
            Tap the player you want to analyze.
          </Text>

          <Animated.View style={[styles.previewCard, { transform: [{ scale: previewScale }] }]}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Player preview</Text>
              <Text style={styles.previewCaption}>Tap to select</Text>
            </View>
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
              {selectedPoint && (
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
                  />
                </>
              )}
            </Pressable>
          </Animated.View>

          <Text style={styles.tipText}>
            {screenState === 'submitting'
              ? 'Starting analysis...'
              : selectedPoint
                ? 'Starting analysis...'
                : 'Starting analysis... Tap a player to change.'}
          </Text>

          {errorMessage ? <Text style={styles.inlineError}>{errorMessage}</Text> : null}
        </ScrollView>

        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              styles.actionButton,
              (!selectedPoint || screenState === 'submitting') && styles.disabledButton,
            ]}
            onPress={() => handleAnalyze()}
            disabled={!selectedPoint || screenState === 'submitting'}
          >
            {screenState === 'submitting' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Start analysis</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryButton, styles.actionButton]} onPress={handlePickAnotherVideo}>
            <Text style={styles.secondaryButtonText}>Choose another video</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ghostButton, styles.actionButton]}
            onPress={() => navigation.navigate('Record', { playerName })}
          >
            <Text style={styles.ghostButtonText}>Record a new clip</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
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
    right: -20,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(91, 140, 255, 0.16)',
  },
  orbBottom: {
    position: 'absolute',
    bottom: -70,
    left: -30,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(17, 184, 154, 0.12)',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  scrollContent: {
    paddingBottom: 280,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  stepLabel: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(91, 140, 255, 0.16)',
    color: '#9FC0FF',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#F7FAFF',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: '#B6C5DE',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  previewCard: {
    backgroundColor: '#F7FAFF',
    borderRadius: 28,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 6,
  },
  previewHeader: {
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 12,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#13203A',
  },
  previewCaption: {
    fontSize: 13,
    color: '#60708F',
    marginTop: 4,
  },
  previewArea: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: '#DDE7F7',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: 'rgba(255, 94, 125, 0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 5,
  },
  markerPulse: {
    position: 'absolute',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255, 94, 125, 0.22)',
  },
  tipText: {
    fontSize: 15,
    color: '#D8E4FA',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 10,
    lineHeight: 22,
  },
  inlineError: {
    color: '#FFB4B4',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  actionBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 14,
    padding: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(8, 17, 32, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  actionButton: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    marginTop: 0,
  },
  loadingText: {
    fontSize: 16,
    color: '#D8E4FA',
    textAlign: 'center',
    lineHeight: 24,
  },
  errorEmoji: {
    fontSize: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#FFB4B4',
    textAlign: 'center',
    lineHeight: 24,
  },
  primaryButton: {
    backgroundColor: '#5B8CFF',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#5B8CFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 7,
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#11B89A',
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  ghostButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  ghostButtonText: {
    color: '#E8F0FF',
    fontSize: 16,
    fontWeight: '600',
  },
});
