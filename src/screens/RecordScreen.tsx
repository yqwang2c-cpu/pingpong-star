import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleStartRecording = useCallback(() => {
    setRecordState('recording');
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    // recordAsync() 的 Promise 在 stopRecording() 被调用后 resolve
    cameraRef.current
      ?.recordAsync({ maxDuration: 60 })
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

  // 权限检查
  if (!cameraPermission || !micPermission) {
    return <View style={styles.centered}><Text>正在检查权限…</Text></View>;
  }

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.permText}>需要摄像头和麦克风权限才能录像 📷</Text>
          <TouchableOpacity
            style={styles.permButton}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={styles.permButtonText}>授权</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* 返回按钮 */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backText}>← 返回首页</Text>
      </TouchableOpacity>

      {/* 摄像头 */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
      />

      {/* 底部控制区 */}
      <View style={styles.controls}>
        {recordState === 'idle' && (
          <TouchableOpacity style={styles.startButton} onPress={handleStartRecording}>
            <View style={styles.redDot} />
            <Text style={styles.startText}>开始录像</Text>
          </TouchableOpacity>
        )}

        {recordState === 'recording' && (
          <>
            <View style={styles.timerRow}>
              <View style={styles.blinkDot} />
              <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
            </View>
            <TouchableOpacity style={styles.stopButton} onPress={handleStopRecording}>
              <Text style={styles.stopIcon}>⏹</Text>
              <Text style={styles.stopText}>停止</Text>
            </TouchableOpacity>
          </>
        )}

        {recordState === 'stopped' && (
          <>
            <Text style={styles.doneText}>✅ 录像完成 {formatTime(elapsed)}</Text>
            <TouchableOpacity style={styles.analyzeButton} onPress={handleStartAnalysis}>
              <Text style={styles.analyzeText}>📊 开始分析</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={() => {
                setVideoUri(null);
                setElapsed(0);
                setRecordState('idle');
              }}
            >
              <Text style={styles.retakeText}>重新录像</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    gap: 16,
  },
  permText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  permButton: {
    backgroundColor: '#3F51B5',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
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
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  backText: {
    color: '#fff',
    fontSize: 14,
  },
  camera: {
    flex: 1,
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 48,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    gap: 12,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E53935',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 32,
    gap: 10,
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
    backgroundColor: '#E53935',
  },
  timerText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 2,
    borderColor: '#fff',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 32,
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
  },
  analyzeButton: {
    backgroundColor: '#43A047',
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 32,
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
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
});
