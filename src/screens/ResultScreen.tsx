import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { SERVER_URL } from '../config/api';

type ResultNavProp = StackNavigationProp<RootStackParamList, 'Result'>;
type ResultRouteProp = RouteProp<RootStackParamList, 'Result'>;

interface Props {
  navigation: ResultNavProp;
  route: ResultRouteProp;
}

type UploadState = 'uploading' | 'done' | 'error';

interface AnalysisResult {
  frames: string[];
  score: number;
  strengths: string[];
  improvements: string[];
}


export default function ResultScreen({ navigation, route }: Props) {
  const { videoUri, playerName } = route.params;
  const [uploadState, setUploadState] = useState<UploadState>('uploading');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    uploadVideo(videoUri);
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

  async function uploadVideo(uri: string) {
    try {
      const filename = uri.split('/').pop() ?? 'video.mov';
      const formData = new FormData();
      formData.append('video', {
        uri,
        name: filename,
        type: 'video/mp4',
      } as unknown as Blob);

      const response = await fetch(`${SERVER_URL}/api/analyze`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const analysisResult: AnalysisResult = {
        frames: data.frames ?? [],
        score: typeof data.score === 'number' ? data.score : 0,
        strengths: Array.isArray(data.strengths) ? data.strengths : [],
        improvements: Array.isArray(data.improvements) ? data.improvements : [],
      };
      setResult(analysisResult);
      setUploadState('done');
      await saveScore(analysisResult.score);
    } catch (e) {
      console.error('上传或分析失败:', e);
      setUploadState('error');
    }
  }

  const isTopFive = result ? result.score >= 73 : false;

  async function pickAndUpload() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要权限', '请在设置中允许访问相册');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (!picked.canceled && picked.assets[0]) {
      navigation.replace('Result', { videoUri: picked.assets[0].uri, playerName });
    }
  }

  if (uploadState === 'uploading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3F51B5" />
          <Text style={styles.uploadingText}>正在上传视频并分析中…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (uploadState === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={{ fontSize: 40 }}>😢</Text>
          <Text style={[styles.uploadingText, { color: '#c62828', textAlign: 'center' }]}>
            分析失败，请检查网络或重新录像
          </Text>
          <TouchableOpacity style={styles.recordAgainButton} onPress={() => navigation.navigate('Record', { playerName })}>
            <Text style={styles.recordAgainText}>🎥 重新录像</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 顶部烟花 */}
        <Text style={styles.fireworks}>🎆　🎆　🎆</Text>

        {/* 进前五恭喜横幅 */}
        {isTopFive && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>✨ 恭喜进入前五名！✨</Text>
          </View>
        )}

        {/* 评分卡片 */}
        <View style={styles.card}>
          <Text style={styles.scoreLabel}>🏆 总分</Text>
          <Text style={styles.score}>{result?.score ?? '--'}</Text>
          <Text style={styles.scoreSuffix}>分</Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>做得好 👍</Text>
          {result?.strengths.map((s, i) => (
            <Text key={i} style={styles.bullet}>· {s}</Text>
          ))}

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>可以改进 💪</Text>
          {result?.improvements.map((s, i) => (
            <Text key={i} style={styles.bullet}>· {s}</Text>
          ))}

          {result && result.frames.length > 0 && (
            <Text style={styles.framesInfo}>
              已分析 {result.frames.length} 张截图
            </Text>
          )}
        </View>

        {/* 底部彩带 */}
        <Text style={styles.confetti}>🎊　🎉　🎊　🎉　🎊</Text>

        {/* 操作按钮 */}
        <TouchableOpacity
          style={styles.recordAgainButton}
          onPress={() => navigation.navigate('Record', { playerName })}
        >
          <Text style={styles.recordAgainText}>🎥 重新录像</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.uploadAgainButton}
          onPress={pickAndUpload}
        >
          <Text style={styles.uploadAgainText}>📂 重新上传</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.homeButton}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.homeText}>🏠 返回首页</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F0F8FF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  uploadingText: {
    fontSize: 16,
    color: '#555',
  },
  scroll: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  fireworks: {
    fontSize: 32,
    letterSpacing: 4,
  },
  banner: {
    backgroundColor: '#FFF9C4',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFD54F',
  },
  bannerText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#E65100',
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
    gap: 8,
  },
  scoreLabel: {
    fontSize: 16,
    color: '#888',
  },
  score: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#1A237E',
    lineHeight: 80,
  },
  scoreSuffix: {
    fontSize: 20,
    color: '#555',
    marginBottom: 4,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#EEE',
    marginVertical: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  bullet: {
    fontSize: 15,
    color: '#444',
    alignSelf: 'flex-start',
    lineHeight: 24,
  },
  framesInfo: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 8,
  },
  confetti: {
    fontSize: 28,
    letterSpacing: 4,
  },
  recordAgainButton: {
    width: '100%',
    backgroundColor: '#3F51B5',
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
  },
  recordAgainText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  uploadAgainButton: {
    width: '100%',
    backgroundColor: '#00897B',
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
  },
  uploadAgainText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  homeButton: {
    width: '100%',
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#3F51B5',
  },
  homeText: {
    color: '#3F51B5',
    fontSize: 17,
    fontWeight: '600',
  },
});
