import { useEffect, useState } from 'react';
import {
  loadSettings,
  saveSettings,
} from '../services/settingsService';
import {
  checkHealth,
  clearAccessCode,
  getAccessCode,
  setAccessCode as persistAccessCode,
  type HealthInfo,
} from '../services/generationClient';

interface SettingsViewProps {
  onNavigate: (view: 'home' | 'add' | 'search' | 'settings') => void;
}

export default function SettingsView({ onNavigate }: SettingsViewProps) {
  const [unseenRatio, setUnseenRatio] = useState(0.7);
  const [timeDirection, setTimeDirection] = useState<'oldToNew' | 'newToOld'>(
    'newToOld',
  );
  const [codeInput, setCodeInput] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null | 'checking'>(
    'checking',
  );

  useEffect(() => {
    loadSettings().then((s) => {
      setUnseenRatio(s.unseenRatio);
      setTimeDirection(s.timeDirection);
    });
    setCodeInput(getAccessCode());
    checkHealth().then(setHealth);
  }, []);

  const updateRatio = async (ratio: number) => {
    setUnseenRatio(ratio);
    await saveSettings({ unseenRatio: ratio });
  };

  const updateDirection = async (
    direction: 'oldToNew' | 'newToOld',
  ) => {
    setTimeDirection(direction);
    await saveSettings({ timeDirection: direction });
  };

  const saveCode = () => {
    persistAccessCode(codeInput.trim());
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  return (
    <div className="settings-view">
      <h2>设置</h2>

      <section className="settings-section">
        <h3>随机混合</h3>
        <label className="ratio-label">
          未浏览词 {Math.round(unseenRatio * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(unseenRatio * 100)}
            onChange={(e) => void updateRatio(Number(e.target.value) / 100)}
          />
          已浏览 {Math.round((1 - unseenRatio) * 100)}%
        </label>
      </section>

      <section className="settings-section">
        <h3>时间顺序</h3>
        <div className="mode-controls">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void updateDirection('oldToNew')}
          >
            {timeDirection === 'oldToNew' ? '● 旧→新' : '旧→新'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void updateDirection('newToOld')}
          >
            {timeDirection === 'newToOld' ? '● 新→旧' : '新→旧'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>生成服务</h3>
        <div className="muted">
          {health === 'checking' && '正在检查服务状态…'}
          {health === null && '服务暂不可用，可稍后在「添加」页重试'}
          {health && health !== 'checking' && (
            <>
              服务正常
              {health.ocrConfigured ? '，支持拍照识别' : '，暂不支持拍照识别'}
            </>
          )}
        </div>
        <label className="field">
          <span>共享访问码（保存在本机，方便重复使用）</span>
          <div className="settings-row">
            <input
              className="text-input"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
            />
            <button type="button" className="ghost-btn" onClick={saveCode}>
              {savedFlash ? '已保存' : '保存'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                clearAccessCode();
                setCodeInput('');
              }}
            >
              清除
            </button>
          </div>
        </label>
      </section>

      <section className="settings-section">
        <div className="muted">
          词库只保存在这台设备的浏览器里。清除网站数据或更换设备可能丢失词库，
          第一版没有云同步与备份。
        </div>
        <div className="muted">
          词条释义由 AI 生成，可在卡片编辑中修正。
        </div>
      </section>

      <button
        type="button"
        className="primary-btn"
        onClick={() => onNavigate('home')}
      >
        返回卡片
      </button>
    </div>
  );
}
