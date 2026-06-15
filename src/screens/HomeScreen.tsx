import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { SERVER_URL } from '../config/api';
import { pickVideoFromLibrary } from '../utils/video';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

interface Props {
  navigation: HomeNavProp;
}

const MAX_BAR_HEIGHT = 160;
const MAX_SCORE = 100;

interface PlayerScore {
  name: string;
  score: number;
}

export default function HomeScreen({ navigation }: Props) {
  const [leaderboard, setLeaderboard] = useState<PlayerScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [inputName, setInputName] = useState('');
  const [pendingAction, setPendingAction] = useState<'record' | 'upload' | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchLeaderboard();
    }, [])
  );

  async function fetchLeaderboard() {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/scores`);
      const data = await res.json();
      setLeaderboard(data.scores ?? []);
    } catch {
      setLeaderboard([]);
    } finally {
      setLoading(false);
    }
  }

  function askName(action: 'record' | 'upload') {
    setInputName('');
    setPendingAction(action);
    setNameModalVisible(true);
  }

  async function onNameConfirmed() {
    const name = inputName.trim();
    if (!name) {
      Alert.alert('请输入姓名');
      return;
    }
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
      Alert.alert('需要权限', '请在设置中允许访问相册');
      return;
    }

    if (picked.status === 'picked') {
      navigation.navigate('TargetSelect', { videoUri: picked.asset.uri, playerName });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>乒乓之星 🏓</Text>

        {/* 排行榜 */}
        <View style={styles.leaderboardCard}>
          <Text style={styles.leaderboardTitle}>本周排行榜 Top 5</Text>

          <View style={styles.chartRow}>
            {loading ? (
              <ActivityIndicator size="small" color="#3F51B5" />
            ) : leaderboard.length === 0 ? (
              <Text style={styles.emptyText}>快去录一段视频，成为第一名！🏅</Text>
            ) : (
              leaderboard.map((player, index) => {
                const barHeight = (player.score / MAX_SCORE) * MAX_BAR_HEIGHT;
                return (
                  <View key={index} style={styles.barColumn}>
                    <Text style={styles.barScore}>{player.score}</Text>
                    <View style={[styles.bar, { height: barHeight }]} />
                    <Text style={styles.barRank}>{index + 1}</Text>
                    <Text style={styles.barName}>{player.name}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* 操作按钮行 */}
        <View style={styles.buttonRow}>
          <View style={styles.actionItem}>
            <TouchableOpacity
              style={styles.cameraButton}
              onPress={() => askName('record')}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonIcon}>🎥</Text>
            </TouchableOpacity>
            <Text style={styles.buttonHint}>录像</Text>
          </View>

          <View style={styles.actionItem}>
            <TouchableOpacity
              style={[styles.cameraButton, styles.uploadButton]}
              onPress={() => askName('upload')}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonIcon}>📂</Text>
            </TouchableOpacity>
            <Text style={styles.buttonHint}>上传录像</Text>
          </View>
        </View>
      </View>

      {/* 姓名输入弹窗 */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>球员姓名</Text>
            <Text style={styles.modalSubtitle}>请输入本次录像的球员名字</Text>
            <TextInput
              style={styles.nameInput}
              value={inputName}
              onChangeText={setInputName}
              placeholder="例如：王言一"
              placeholderTextColor="#bbb"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={onNameConfirmed}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setNameModalVisible(false)}
              >
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={onNameConfirmed}>
                <Text style={styles.confirmText}>确定</Text>
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
    backgroundColor: '#F0F8FF',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1A237E',
    marginBottom: 24,
  },
  leaderboardCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 32,
  },
  leaderboardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    textAlign: 'center',
    marginBottom: 16,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: MAX_BAR_HEIGHT + 56,
    paddingTop: 8,
  },
  barColumn: {
    alignItems: 'center',
    width: 48,
  },
  bar: {
    width: 32,
    borderRadius: 4,
    backgroundColor: '#3F51B5',
  },
  barScore: {
    fontSize: 11,
    color: '#333',
    marginBottom: 4,
    fontWeight: '600',
  },
  barRank: {
    fontSize: 13,
    color: '#888',
    marginTop: 6,
  },
  barName: {
    fontSize: 11,
    color: '#555',
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 40,
    alignItems: 'flex-start',
  },
  actionItem: {
    alignItems: 'center',
    gap: 10,
  },
  cameraButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#3F51B5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3F51B5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  uploadButton: {
    backgroundColor: '#00897B',
    shadowColor: '#00897B',
  },
  buttonIcon: {
    fontSize: 36,
  },
  buttonHint: {
    fontSize: 13,
    color: '#888',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    width: '82%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A237E',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  nameInput: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#C5CAE9',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    color: '#222',
    textAlign: 'center',
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C5CAE9',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: '#888',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#3F51B5',
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
