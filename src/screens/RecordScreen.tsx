import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Animated,
  Easing,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { MAX_VIDEO_DURATION_SECONDS } from '../utils/video';
import { colors, fontSize, radius, space } from '../theme';

type RecordNavProp = StackNavigationProp<RootStackParamList, 'Record'>;
type RecordRouteProp = RouteProp<RootStackParamList, 'Record'>;

interface Props {
  navigation: RecordNavProp;
  route: RecordRouteProp;
}

type RecordState = 'idle' | 'recording' | 'stopped';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordScreen({ navigation, route }: Props) {
  const { playerName } = route.params;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordPulse = useRef(new Animated.Value(1)).current;
  const liveOpacity = useRef(new Animated.Value(1)).current;
  const panelOpacity = useRef(new Animated.Value(0)).current;
  const panelTranslateY = useRef(new Animated.Value(28)).current;
  const topPanelOpacity = useRef(new Animated.Value(0)).current;
  const topPanelTranslateY = useRef(new Animated.Value(-18)).current;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(panelOpacity, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(panelTranslateY, {
        toValue: 0,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(topPanelOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(topPanelTranslateY, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [panelOpacity, panelTranslateY, topPanelOpacity, topPanelTranslateY]);

  useEffect(() => {
    if (recordState !== 'recording') {
      recordPulse.stopAnimation();
      liveOpacity.stopAnimation();
      recordPulse.setValue(1);
      liveOpacity.setValue(1);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(recordPulse, {
          toValue: 1.08,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(recordPulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    const opacityLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(liveOpacity, {
          toValue: 0.35,
          duration: 620,
          useNativeDriver: true,
        }),
        Animated.timing(liveOpacity, {
          toValue: 1,
          duration: 620,
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    opacityLoop.start();

    return () => {
      pulseLoop.stop();
      opacityLoop.stop();
      recordPulse.stopAnimation();
      liveOpacity.stopAnimation();
      recordPulse.setValue(1);
      liveOpacity.setValue(1);
    };
  }, [liveOpacity, recordPulse, recordState]);

  const handleStartRecording = useCallback(() => {
    setRecordState('recording');
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    // recordAsync() resolves after stopRecording() is called or the max duration is reached.
    cameraRef.current
      ?.recordAsync({ maxDuration: MAX_VIDEO_DURATION_SECONDS })
      .then(result => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (result) {
          setVideoUri(result.uri);
          setRecordState('stopped');
        }
      })
      .catch(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        setRecordState('idle');
      });
  }, []);

  const handleStopRecording = useCallback(() => {
    cameraRef.current?.stopRecording();
  }, []);

  const handleStartAnalysis = useCallback(() => {
    if (!videoUri) return;
    navigation.navigate('TargetSelect', { videoUri, playerName });
  }, [playerName, videoUri, navigation]);

  if (!cameraPermission || !micPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Checking permissions...</Text>
      </View>
    );
  }

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <View style={styles.permissionBadge} />
          <Text style={styles.permTitle}>Camera access is required</Text>
          <Text style={styles.permText}>
            Please allow both camera and microphone permissions so the app can record a full
            practice clip.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={styles.primaryButtonText}>Grant access</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={() => navigation.goBack()}>
            <Text style={styles.textButtonText}>Back home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const remainingHint =
    recordState === 'recording'
      ? 'Tap to stop'
      : recordState === 'stopped'
        ? 'Saved. Ready to analyze.'
        : 'Keep the whole body in frame';

  return (
    <SafeAreaView style={styles.safe}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" mode="video" />

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        activeOpacity={0.85}
      >
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <Animated.View
        style={[
          styles.topPanel,
          { opacity: topPanelOpacity, transform: [{ translateY: topPanelTranslateY }] },
        ]}
      >
        <View style={styles.playerPill}>
          <View style={styles.playerAvatar}>
            <Text style={styles.playerAvatarText}>{playerName.slice(0, 1)}</Text>
          </View>
          <Text style={styles.playerName}>{playerName}</Text>
        </View>
        <Text style={styles.recordTitle}>Record a clean rally</Text>
      </Animated.View>

      <Animated.View
        style={[
          styles.controls,
          { opacity: panelOpacity, transform: [{ translateY: panelTranslateY }] },
        ]}
      >
        <View style={styles.timerRow}>
          {recordState === 'recording' ? (
            <Animated.View style={[styles.liveDot, { opacity: liveOpacity }]} />
          ) : null}
          <Text style={styles.timerText}>
            {formatTime(elapsed)} / {formatTime(MAX_VIDEO_DURATION_SECONDS)}
          </Text>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.min(100, (elapsed / MAX_VIDEO_DURATION_SECONDS) * 100)}%`,
                opacity: recordState === 'idle' ? 0.45 : 1,
              },
            ]}
          />
        </View>

        {recordState === 'idle' || recordState === 'recording' ? (
          <Animated.View style={{ transform: [{ scale: recordPulse }] }}>
            <TouchableOpacity
              style={styles.recordRing}
              onPress={recordState === 'recording' ? handleStopRecording : handleStartRecording}
              activeOpacity={0.9}
            >
              <View
                style={[
                  styles.recordButton,
                  recordState === 'recording' && styles.recordButtonActive,
                ]}
              >
                <View style={styles.recordButtonInner} />
              </View>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        <Text style={styles.controlHint}>{remainingHint}</Text>

        {recordState === 'stopped' ? (
          <View style={styles.stoppedActions}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleStartAnalysis}>
              <Text style={styles.primaryButtonText}>Analyze this clip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.textButton}
              onPress={() => {
                setVideoUri(null);
                setElapsed(0);
                setRecordState('idle');
              }}
            >
              <Text style={styles.textButtonText}>Record again</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.camera,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  loadingText: {
    fontSize: fontSize.body,
    color: colors.body,
  },
  permissionBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: colors.primarySoft,
    marginBottom: space.xs,
  },
  permTitle: {
    fontSize: fontSize.card,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  permText: {
    fontSize: fontSize.body,
    color: colors.body,
    textAlign: 'center',
    lineHeight: 21,
  },
  camera: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 56,
    left: space.md,
    zIndex: 10,
    backgroundColor: 'rgba(15,36,23,0.62)',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  backText: {
    color: colors.onCamera,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  topPanel: {
    position: 'absolute',
    top: 104,
    left: space.md,
    right: space.md,
    zIndex: 5,
    borderRadius: radius.large,
    padding: space.md,
    backgroundColor: 'rgba(15,36,23,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  playerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,107,44,0.28)',
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 4,
    paddingRight: space.sm,
    marginBottom: space.xs,
  },
  playerAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
  playerAvatarText: {
    fontSize: fontSize.micro,
    fontWeight: '700',
    color: colors.surface,
  },
  playerName: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.onCamera,
  },
  recordTitle: {
    color: colors.onCamera,
    fontSize: fontSize.card,
    fontWeight: '700',
  },
  controls: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: 36,
    alignItems: 'center',
    gap: space.sm,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  timerText: {
    color: colors.onCamera,
    fontSize: fontSize.body,
    fontWeight: '700',
    letterSpacing: 1,
  },
  progressTrack: {
    width: 168,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  recordRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 7,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  recordButton: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: {
    backgroundColor: colors.danger,
  },
  recordButtonInner: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  controlHint: {
    fontSize: fontSize.caption,
    color: 'rgba(255,255,255,0.78)',
  },
  stoppedActions: {
    width: '100%',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
  primaryButton: {
    width: '100%',
    maxWidth: 320,
    height: 52,
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
  textButton: {
    paddingVertical: space.xs,
  },
  textButtonText: {
    color: colors.primarySoft,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
