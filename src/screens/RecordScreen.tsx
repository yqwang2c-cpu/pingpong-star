import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { MAX_VIDEO_DURATION_SECONDS } from '../utils/video';

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
          <Text style={styles.permissionIcon}>🎥</Text>
          <Text style={styles.permTitle}>Camera access is required</Text>
          <Text style={styles.permText}>
            Please allow both camera and microphone permissions so the app can record a full practice clip.
          </Text>
          <TouchableOpacity
            style={styles.permButton}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={styles.permButtonText}>Grant access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backText}>← Home</Text>
      </TouchableOpacity>

      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
      />

      <Animated.View
        style={[
          styles.topPanel,
          { opacity: topPanelOpacity, transform: [{ translateY: topPanelTranslateY }] },
        ]}
      >
        <Text style={styles.playerChip}>Player: {playerName}</Text>
        <Text style={styles.recordTitle}>Record a clean rally clip</Text>
        <Text style={styles.recordSubtitle}>
          Keep the full body visible and stay within the 10-second limit for the best analysis.
        </Text>
      </Animated.View>

      <Animated.View
        style={[
          styles.controls,
          { opacity: panelOpacity, transform: [{ translateY: panelTranslateY }] },
        ]}
      >
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: `${Math.min(100, (elapsed / MAX_VIDEO_DURATION_SECONDS) * 100)}%`,
                opacity: recordState === 'idle' ? 0.4 : 1,
              },
            ]}
          />
        </View>
        {recordState === 'idle' && (
          <>
            <Text style={styles.controlHint}>Ready when you are</Text>
            <Animated.View style={{ transform: [{ scale: recordPulse }] }}>
              <TouchableOpacity style={styles.startButton} onPress={handleStartRecording}>
                <View style={styles.redDot} />
                <Text style={styles.startText}>Start recording</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}

        {recordState === 'recording' && (
          <>
            <View style={styles.timerRow}>
              <Animated.View style={[styles.blinkDot, { opacity: liveOpacity }]} />
              <Text style={styles.timerText}>
                {formatTime(elapsed)} / 00:10
              </Text>
            </View>
            <Text style={styles.liveHint}>Recording in progress</Text>
            <Animated.View style={{ transform: [{ scale: recordPulse }] }}>
              <TouchableOpacity style={styles.stopButton} onPress={handleStopRecording}>
                <Text style={styles.stopIcon}>⏹</Text>
                <Text style={styles.stopText}>Stop</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}

        {recordState === 'stopped' && (
          <>
            <Text style={styles.doneText}>Clip saved: {formatTime(elapsed)} / 00:10</Text>
            <TouchableOpacity style={styles.analyzeButton} onPress={handleStartAnalysis}>
              <Text style={styles.analyzeText}>Analyze this clip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={() => {
                setVideoUri(null);
                setElapsed(0);
                setRecordState('idle');
              }}
            >
              <Text style={styles.retakeText}>Record again</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#04070D',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#07111E',
    gap: 14,
    paddingHorizontal: 28,
  },
  loadingText: {
    color: '#E8F0FF',
    fontSize: 16,
  },
  permissionIcon: {
    fontSize: 42,
  },
  permTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  permText: {
    fontSize: 16,
    color: '#B8C7E0',
    textAlign: 'center',
    lineHeight: 24,
  },
  permButton: {
    marginTop: 4,
    backgroundColor: '#5B8CFF',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
  },
  permButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    position: 'absolute',
    top: 56,
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(7, 17, 30, 0.72)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  backText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
  },
  topPanel: {
    position: 'absolute',
    top: 112,
    left: 20,
    right: 20,
    zIndex: 5,
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(7, 17, 30, 0.64)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  playerChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(91, 140, 255, 0.18)',
    color: '#DCE7FF',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
  },
  recordTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  recordSubtitle: {
    color: '#C6D2E8',
    fontSize: 14,
    lineHeight: 21,
  },
  controls: {
    position: 'absolute',
    bottom: 18,
    left: 16,
    right: 16,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 24,
    backgroundColor: 'rgba(7, 17, 30, 0.78)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    gap: 12,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 2,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#11B89A',
  },
  controlHint: {
    color: '#BFD0EB',
    fontSize: 14,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF5E7D',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 999,
    gap: 10,
    shadowColor: '#FF5E7D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
  },
  redDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  startText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blinkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF5E7D',
  },
  timerText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  liveHint: {
    color: '#BFD0EB',
    fontSize: 13,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 999,
    gap: 8,
  },
  stopIcon: {
    fontSize: 20,
    color: '#fff',
  },
  stopText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  doneText: {
    color: '#fff',
    fontSize: 15,
    marginBottom: 4,
    fontWeight: '600',
  },
  analyzeButton: {
    backgroundColor: '#11B89A',
    paddingHorizontal: 36,
    paddingVertical: 15,
    borderRadius: 999,
    minWidth: 220,
    alignItems: 'center',
  },
  analyzeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  retakeButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retakeText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    fontWeight: '600',
  },
});
