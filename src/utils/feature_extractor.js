// Feature Extractor - 音高特征提取
// 提取音频的音高、节奏等特征

export class FeatureExtractor {
  constructor() {
    this.sampleRate = 44100
  }

  // 提取音高曲线 (pitch contour)
  async extractPitch(audioBuffer, frameSize = 2048, hopSize = 512) {
    const channelData = audioBuffer.getChannelData(0)
    const pitches = []
    
    for (let i = 0; i < channelData.length - frameSize; i += hopSize) {
      const frame = channelData.slice(i, i + frameSize)
      const frequency = this.autocorrelationPitch(frame)
      
      if (frequency > 50 && frequency < 5000) { // 合理的频率范围
        pitches.push({
          time: i / this.sampleRate,
          frequency: frequency,
          note: this.getNoteFromFrequency(frequency)
        })
      }
    }
    
    return pitches
  }

  // 自相关音高检测
  autocorrelationPitch(frame) {
    const n = frame.length
    const correlation = new Array(n).fill(0)
    
    // 计算自相关
    for (let lag = 0; lag < n; lag++) {
      for (let i = 0; i < n - lag; i++) {
        correlation[lag] += frame[i] * frame[i + lag]
      }
    }
    
    // 找到峰值（忽略开始部分和低频部分）
    let maxCorrelation = 0
    let maxLag = 0
    
    const minLag = Math.floor(this.sampleRate / 5000) // 最高频率约 5000Hz
    const maxLag = Math.floor(this.sampleRate / 50)  // 最低频率约 50Hz
    
    for (let lag = minLag; lag < maxLag; lag++) {
      if (correlation[lag] > maxCorrelation) {
        maxCorrelation = correlation[lag]
        maxLag = lag
      }
    }
    
    // 抛物线插值提高精度
    if (maxLag > 0 && maxLag < n - 1) {
      const y1 = correlation[maxLag - 1]
      const y2 = correlation[maxLag]
      const y3 = correlation[maxLag + 1]
      const refinedLag = maxLag + (y1 - y3) / (2 * (y1 - 2 * y2 + y3))
      return this.sampleRate / refinedLag
    }
    
    return maxLag > 0 ? this.sampleRate / maxLag : 0
  }

  // 频率转音符名
  getNoteFromFrequency(frequency) {
    if (!frequency || frequency <= 0) return null
    
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const a4 = 440
    const semitones = 12 * Math.log2(frequency / a4)
    const noteNum = Math.round(semitones) + 69
    
    const note = notes[noteNum % 12]
    const octave = Math.floor(noteNum / 12) - 1
    
    return `${note}${octave}`
  }

  // 检测音符起始点 (onset detection)
  detectOnsets(audioBuffer, threshold = 0.1) {
    const channelData = audioBuffer.getChannelData(0)
    const onsets = []
    
    // 计算短时能量
    const frameSize = 1024
    const energies = []
    
    for (let i = 0; i < channelData.length - frameSize; i += frameSize / 2) {
      let energy = 0
      for (let j = 0; j < frameSize; j++) {
        energy += channelData[i + j] * channelData[i + j]
      }
      energies.push({ time: i / this.sampleRate, energy: Math.sqrt(energy / frameSize) })
    }
    
    // 找到能量突变的点
    for (let i = 1; i < energies.length; i++) {
      const diff = energies[i].energy - energies[i - 1].energy
      if (diff > threshold) {
        onsets.push(energies[i].time)
      }
    }
    
    return onsets
  }

  // 估算 BPM
  estimateBPM(audioBuffer) {
    const onsets = this.detectOnsets(audioBuffer)
    if (onsets.length < 4) return 120 // 默认值
    
    // 计算平均音符间隔
    let totalInterval = 0
    let count = 0
    
    for (let i = 1; i < Math.min(onsets.length, 20); i++) {
      totalInterval += onsets[i] - onsets[i - 1]
      count++
    }
    
    const avgInterval = totalInterval / count
    const bpm = 60 / avgInterval
    
    // 限制在合理范围
    return Math.max(40, Math.min(200, Math.round(bpm)))
  }
}

export default FeatureExtractor
