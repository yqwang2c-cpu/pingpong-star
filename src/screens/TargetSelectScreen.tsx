import React, { useEffect, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import type { AnalysisResult, AnalyzeSessionPreview } from '../types/analysis';
import { SERVER_URL } from '../config/api';
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
      return '网络请求失败，请确认手机网络正常且可以访问服务器';
    }
    return error.message;
  }

  return '分析失败，请稍后重试';
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
  const [previewLayout, setPreviewLayout] = useState({ width: 0, height: 0 });
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    prepareSelectionSession(videoUri);
  }, [videoUri]);

  async function saveScore(score: number) {
    try {
      await fetch(`${SERVER_URL}/api/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName, score }),
      });
    } catch {
      // 离线时忽略，不影响结果展示
    }
  }

  async function prepareSelectionSession(uri: string) {
    try {
      setScreenState('preparing');
      setSessionPreview(null);
      setErrorMessage('');
      setSelectedPoint(null);

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
          throw new Error('服务器返回了无法识别的预览结果');
        }
      }

      if (!response.ok) {
        const serverError =
          typeof data?.error === 'string' ? data.error : `服务器返回错误（${response.status}）`;
        throw new Error(serverError);
      }

      if (
        typeof data?.sessionId !== 'string' ||
        typeof data?.previewImage !== 'string' ||
        typeof data?.previewSize !== 'object' ||
        data.previewSize === null
      ) {
        throw new Error('服务器返回的选人预览数据不完整');
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
    } catch (error) {
      console.error('准备选人预览失败:', error);
      setSessionPreview(null);
      setErrorMessage(getReadableErrorMessage(error));
      setScreenState('error');
    }
  }

  function handlePreviewPress(event: GestureResponderEvent) {
    if (!previewLayout.width || !previewLayout.height) return;

    const x = clamp(event.nativeEvent.locationX / previewLayout.width, 0, 1);
    const y = clamp(event.nativeEvent.locationY / previewLayout.height, 0, 1);
    setSelectedPoint({ x, y });
    setErrorMessage('');
  }

  async function handleAnalyze() {
    if (!sessionPreview) return;
    if (!selectedPoint) {
      Alert.alert('请先点击要评分的球员');
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
          body: JSON.stringify(selectedPoint),
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
          throw new Error('服务器返回了无法识别的分析结果');
        }
      }

      if (!response.ok) {
        const serverError =
          typeof data?.error === 'string' ? data.error : `服务器返回错误（${response.status}）`;
        throw new Error(serverError);
      }

      const analysisResult = parseAnalysisResult(data);
      await saveScore(analysisResult.score);
      navigation.replace('Result', { playerName, result: analysisResult });
    } catch (error) {
      console.error('定向分析失败:', error);
      setErrorMessage(getReadableErrorMessage(error));
      setScreenState('ready');
    }
  }

  async function handlePickAnotherVideo() {
    const picked = await pickVideoFromLibrary();
    if (picked.status === 'permission_denied') {
      Alert.alert('需要权限', '请在设置中允许访问相册');
      return;
    }

    if (picked.status === 'too_long') {
      Alert.alert('视频太长', getVideoDurationLimitMessage());
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
          <ActivityIndicator size="large" color="#3F51B5" />
          <Text style={styles.loadingText}>正在上传视频并生成选人预览…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'error' && !sessionPreview) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorEmoji}>😢</Text>
          <Text style={styles.errorText}>{errorMessage || '生成选人预览失败，请稍后重试'}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => prepareSelectionSession(videoUri)}>
            <Text style={styles.primaryButtonText}>重新尝试</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handlePickAnotherVideo}>
            <Text style={styles.secondaryButtonText}>重新选视频</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>点选要评分的球员</Text>
        <Text style={styles.subtitle}>
          如果画面里有多人，请点击你想评分的那一位。系统会围绕这个位置进行分析。
        </Text>

        <View style={styles.previewCard}>
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
              <View
                style={[
                  styles.marker,
                  {
                    left: `${selectedPoint.x * 100}%`,
                    top: `${selectedPoint.y * 100}%`,
                  },
                ]}
              />
            )}
          </Pressable>
        </View>

        <Text style={styles.tipText}>
          {selectedPoint
            ? '已选中目标人物，可以开始评分'
            : '请点击画面中的目标球员'}
        </Text>

        {errorMessage ? <Text style={styles.inlineError}>{errorMessage}</Text> : null}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!selectedPoint || screenState === 'submitting') && styles.disabledButton,
          ]}
          onPress={handleAnalyze}
          disabled={!selectedPoint || screenState === 'submitting'}
        >
          {screenState === 'submitting' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>开始评分</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={handlePickAnotherVideo}>
          <Text style={styles.secondaryButtonText}>重新选视频</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ghostButton}
          onPress={() => navigation.navigate('Record', { playerName })}
        >
          <Text style={styles.ghostButtonText}>重新录像</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F0F8FF',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1A237E',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: '#566',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  previewArea: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#DDE7F7',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  tipText: {
    fontSize: 15,
    color: '#445',
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  inlineError: {
    color: '#c62828',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  loadingText: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
  },
  errorEmoji: {
    fontSize: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#c62828',
    textAlign: 'center',
    lineHeight: 24,
  },
  primaryButton: {
    marginTop: 10,
    backgroundColor: '#3F51B5',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
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
    marginTop: 12,
    backgroundColor: '#00897B',
    borderRadius: 30,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  ghostButton: {
    marginTop: 12,
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#3F51B5',
    backgroundColor: '#fff',
  },
  ghostButtonText: {
    color: '#3F51B5',
    fontSize: 16,
    fontWeight: '600',
  },
});
