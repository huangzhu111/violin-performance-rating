// SPICE Pitch Extractor - 基于 TensorFlow.js SPICE 模型的音高检测
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-cpu';

const SPICE_MODEL_URL = 'https://tfhub.dev/google/spice/2';
const UNCERTAINTY_THRESHOLD = 0.1;
// SPICE 输出 pitch 范围 [0,1] 对应 30Hz - 1300Hz
const MIN_FREQ = 30;
const MAX_FREQ = 1300;

let model = null;
let modelLoading = false;
let modelLoadCallbacks = [];

export class SpiceExtractor {
  constructor() {
    this.sampleRate = 44100;
    this.windowSize = 512; // SPICE 期望的帧大小
  }

  /**
   * 加载 SPICE 模型（单例模式）
   */
  async loadModel() {
    if (model) return model;
    if (modelLoading) {
      return new Promise((resolve) => {
        modelLoadCallbacks.push(resolve);
      });
    }

    modelLoading = true;
    try {
      await tf.ready();
      // 使用 @tensorflow-models/spice 从 tf.hub 加载
      const spiceModel = await tf.loadGraphModel(SPICE_MODEL_URL, { fromTFHub: true });
      model = spiceModel;
      modelLoadCallbacks.forEach(cb => cb(model));
      modelLoadCallbacks = [];
      return model;
    } catch (err) {
      modelLoading = false;
      modelLoadCallbacks.forEach(cb => cb(null));
      modelLoadCallbacks = [];
      throw new Error('SPICE 模型加载失败: ' + err.message);
    }
  }

  /**
   * 检查模型是否已加载
   */
  isModelLoaded() {
    return model !== null;
  }

  /**
   * 获取模型加载状态
   * @returns {'loading' | 'ready' | 'error'}
   */
  getModelStatus() {
    if (model) return 'ready';
    if (modelLoading) return 'loading';
    return 'error';
  }

  /**
   * 从 AudioBuffer 提取音高
   * @param {AudioBuffer} audioBuffer
   * @param {number} hopSize - 帧移（采样点数）
   * @returns {Promise<Array<{time: number, frequency: number, note: string}>>}
   */
  async extractPitch(audioBuffer, hopSize = 512) {
    if (!model) {
      throw new Error('SPICE 模型未加载，请先调用 loadModel()');
    }

    const channelData = audioBuffer.getChannelData(0);
    const results = [];

    // 分帧处理
    for (let i = 0; i < channelData.length - this.windowSize; i += hopSize) {
      const frame = channelData.slice(i, i + this.windowSize);

      // 转换为 SPICE 期望的格式: Int16Array
      const int16Frame = this.float32ToInt16(frame);

      // 调整为 512 采样点（如有需要补零）
      const paddedFrame = new Int16Array(this.windowSize);
      paddedFrame.set(int16Frame.slice(0, Math.min(int16Frame.length, this.windowSize)));

      // 转换为 tf.Tensor [1, 512]
      const inputTensor = tf.tensor2d(paddedFrame, [1, this.windowSize]);

      // 运行推理
      const outputs = await model.executeAsync(inputTensor);
      inputTensor.dispose();

      // outputs[0]: pitch (0-1), outputs[1]: uncertainty (0-1)
      const pitch = (await outputs[0].data())[0];
      const uncertainty = (await outputs[1].data())[0];

      outputs.forEach(o => o.dispose());

      // 过滤不确定性过高的结果
      if (uncertainty < UNCERTAINTY_THRESHOLD && pitch > 0) {
        // 将归一化 pitch 转换为实际频率
        // SPICE 使用对数 scale: freq = 2^(pitch * log2(MAX_FREQ/MIN_FREQ)) * MIN_FREQ
        const log2Scale = Math.log2(MAX_FREQ / MIN_FREQ);
        const frequency = MIN_FREQ * Math.pow(2, pitch * log2Scale);

        // 过滤不合理频率（小提琴范围约 196Hz - 3136Hz）
        if (frequency > 150 && frequency < 4000) {
          results.push({
            time: i / this.sampleRate,
            frequency: frequency,
            note: this.getNoteFromFrequency(frequency)
          });
        }
      }
    }

    return results;
  }

  /**
   * 将 float32 AudioBuffer 数据转换为 Int16
   */
  float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // 限制范围到 [-1, 1]
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return int16;
  }

  /**
   * 将频率转换为音符名称
   * @param {number} frequency - 频率 (Hz)
   * @returns {string} - 音符名，如 'A4', 'C#5'
   */
  getNoteFromFrequency(frequency) {
    if (!frequency || frequency <= 0) return null;

    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const a4 = 440;
    const semitones = 12 * Math.log2(frequency / a4);
    const noteNum = Math.round(semitones) + 69;

    const note = notes[noteNum % 12];
    const octave = Math.floor(noteNum / 12) - 1;

    return `${note}${octave}`;
  }

  /**
   * 清理资源
   */
  dispose() {
    if (model) {
      model.dispose();
      model = null;
    }
  }
}

export default SpiceExtractor;
