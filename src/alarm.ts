// 喂奶超时闹钟:逻辑与 iOS FeedingAlarmController 一致。
// WebAudio 合成 523.25Hz + 659.25Hz 柔和钟声,音量从 0.16 渐增到 0.9,每 2.4 秒响一次并震动;
// 手动停止后延后 1 小时,有更新的喂奶记录则重新计算。

export interface AlarmState {
  isActive: boolean;
  title: string;
  message: string;
  nextReminderDate: number | null;
}

type Listener = (state: AlarmState) => void;

const MIN_VOLUME = 0.16;
const MAX_VOLUME = 0.9;
const VOLUME_STEP = 0.08;
const STOP_GRACE_MS = 600;
const SNOOZE_MS = 60 * 60 * 1000;

class FeedingAlarmController {
  private state: AlarmState = { isActive: false, title: "", message: "", nextReminderDate: null };
  private listeners = new Set<Listener>();

  private reminderTimer: number | null = null;
  private alarmTimer: number | null = null;
  private audioContext: AudioContext | null = null;
  private chimeBuffer: AudioBuffer | null = null;
  private volume = MIN_VOLUME;
  private alarmStartedAt: number | null = null;
  private activeShouldSnooze = false;
  private activeFeedingDate: number | null = null;
  private latestEnabled = false;
  private latestDelayMinutes = 180;
  private latestFeedingDate: number | null = null;
  private snoozedFeedingDate: number | null = null;
  private snoozedUntil: number | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): AlarmState {
    return this.state;
  }

  private setState(patch: Partial<AlarmState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  update(enabled: boolean, delayMinutes: number, latestFeedingDate: number | null) {
    this.latestEnabled = enabled;
    this.latestDelayMinutes = delayMinutes;
    this.latestFeedingDate = latestFeedingDate;

    if (this.reminderTimer != null) {
      window.clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }

    if (!enabled || latestFeedingDate == null) {
      this.snoozedFeedingDate = null;
      this.snoozedUntil = null;
      this.setState({ nextReminderDate: null });
      this.stopAlarm();
      return;
    }

    if (this.snoozedFeedingDate != null && latestFeedingDate > this.snoozedFeedingDate) {
      this.snoozedFeedingDate = null;
      this.snoozedUntil = null;
    }

    this.scheduleReminder();
  }

  startTestAlarm() {
    this.startAlarm("喂奶闹钟测试", "这是持续闹钟测试，点击停止闹钟后结束。", false, null);
  }

  stopAlarm() {
    if (this.alarmTimer != null) {
      window.clearInterval(this.alarmTimer);
      this.alarmTimer = null;
    }
    this.alarmStartedAt = null;
    this.activeShouldSnooze = false;
    this.activeFeedingDate = null;
    this.volume = MIN_VOLUME;
    this.setState({ isActive: false, title: "", message: "" });
  }

  stopAlarmAfterUserInteraction() {
    if (!this.state.isActive) return;
    if (this.alarmStartedAt == null) {
      this.stopAlarm();
      return;
    }
    if (Date.now() - this.alarmStartedAt < STOP_GRACE_MS) return;

    const shouldSnooze = this.activeShouldSnooze;
    const feedingDate = this.activeFeedingDate;
    this.stopAlarm();

    if (shouldSnooze && feedingDate != null) {
      this.snoozedFeedingDate = feedingDate;
      this.snoozedUntil = Date.now() + SNOOZE_MS;
      this.scheduleReminder();
    }
  }

  private scheduleReminder() {
    if (this.reminderTimer != null) {
      window.clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }

    if (!this.latestEnabled || this.latestFeedingDate == null) {
      this.setState({ nextReminderDate: null });
      return;
    }

    const normalFireDate = this.latestFeedingDate + this.latestDelayMinutes * 60_000;
    let fireDate: number;

    if (
      this.snoozedFeedingDate != null &&
      this.snoozedUntil != null &&
      this.latestFeedingDate <= this.snoozedFeedingDate
    ) {
      fireDate = Math.max(normalFireDate, this.snoozedUntil);
    } else {
      this.snoozedFeedingDate = null;
      this.snoozedUntil = null;
      fireDate = normalFireDate;
    }

    this.setState({ nextReminderDate: fireDate });
    const delayMillis = Math.max(fireDate - Date.now(), 1000);

    this.reminderTimer = window.setTimeout(() => {
      this.snoozedFeedingDate = null;
      this.snoozedUntil = null;
      this.setState({ nextReminderDate: null });
      const hours = Math.floor(this.latestDelayMinutes / 60);
      const minutes = this.latestDelayMinutes % 60;
      const delayText =
        hours > 0 && minutes > 0 ? `${hours}小时${minutes}分钟` : hours > 0 ? `${hours}小时` : `${minutes}分钟`;
      this.startAlarm("该喂奶了", `距离上次喂奶已经超过 ${delayText}。`, true, this.latestFeedingDate);
    }, delayMillis);
  }

  private startAlarm(title: string, message: string, shouldSnooze: boolean, feedingDate: number | null) {
    if (this.alarmTimer != null) {
      window.clearInterval(this.alarmTimer);
    }
    this.alarmStartedAt = Date.now();
    this.activeShouldSnooze = shouldSnooze;
    this.activeFeedingDate = feedingDate;
    this.volume = MIN_VOLUME;
    this.setState({ isActive: true, title, message });

    this.playPulse();
    this.alarmTimer = window.setInterval(() => this.playPulse(), 2400);
  }

  private playPulse() {
    this.playChime();
    navigator.vibrate?.(500);
    this.volume = Math.min(this.volume + VOLUME_STEP, MAX_VOLUME);
  }

  private ensureAudio(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }
    if (!this.chimeBuffer) {
      this.chimeBuffer = this.makeChimeBuffer(this.audioContext);
    }
    return this.audioContext;
  }

  private playChime() {
    try {
      const context = this.ensureAudio();
      const source = context.createBufferSource();
      source.buffer = this.chimeBuffer;
      const gain = context.createGain();
      gain.gain.value = this.volume;
      source.connect(gain);
      gain.connect(context.destination);
      source.start();
    } catch {
      // 浏览器可能在无用户交互时拒绝播放,忽略
    }
  }

  private makeChimeBuffer(context: AudioContext): AudioBuffer {
    const sampleRate = context.sampleRate;
    const duration = 1.0;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, sampleRate);
    const channel = buffer.getChannelData(0);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      const fadeIn = Math.min(time / 0.08, 1);
      const fadeOut = Math.min((duration - time) / 0.35, 1);
      const envelope = Math.max(Math.min(fadeIn, fadeOut), 0);
      const primaryTone = Math.sin(2 * Math.PI * 523.25 * time);
      const softOvertone = Math.sin(2 * Math.PI * 659.25 * time) * 0.35;
      channel[frame] = (primaryTone + softOvertone) * envelope * 0.45;
    }

    return buffer;
  }
}

export const feedingAlarm = new FeedingAlarmController();
