# Violin Performance Rating System - 技术文档

## 项目概述

一个基于 AI 的小提琴演奏评分系统，纯前端实现，通过对比标准演奏录音与用户录音，自动检测错误并打分。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         系统架构                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌──────────────┐     ┌──────────────────────────────────────┐   │
│   │   手机网页    │     │         技术栈                        │   │
│   │  (Vercel)    │     │  • 前端: React + Vite                │   │
│   └──────┬───────┘     │  • 音频: Web Audio API               │   │
│          │             │  • 音高: TensorFlow.js SPICE         │   │
│          │             │  • 存储: IndexedDB                   │   │
│          ▼             └──────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │                      前端处理流程                        │    │
│   │  ┌─────────┐   ┌──────────────┐   ┌─────────────────┐   │    │
│   │  │ 录音    │ → │ SPICE 音高   │ → │ 错误检测 + 评分  │   │    │
│   │  │ Media   │   │ 提取         │   │                 │   │    │
│   │  │ Recorder│   │              │   │                 │   │    │
│   │  └─────────┘   └──────────────┘   └─────────────────┘   │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 技术选型

| 组件 | 工具 | 说明 |
|------|------|------|
| 前端框架 | React + Vite | 响应式网页，移动端优先 |
| 音频录制 | Web Audio API (MediaRecorder) | 浏览器原生，最长 120 秒 |
| 音高检测 | TensorFlow.js SPICE | Google 官方预训练模型，抗噪音 |
| 本地存储 | IndexedDB | 永久保存项目和演奏记录 |
| 部署 | Vercel | 免费托管，GitHub 自动部署 |

## 核心算法：SPICE 模型

### 什么是 SPICE？

SPICE (Self-Supervised Pitch Estimation) 是 Google 训练的深度学习模型，专门用于从音频中提取音高。

**优点**：
- 抗噪音能力强
- 专为浏览器设计
- 免费使用

**使用方法**：
```javascript
// 1. 加载模型
const model = await tf.loadGraphModel('https://tfhub.dev/google/spice/2')

// 2. 准备音频（归一化）
const audio = ... // 音频数据

// 3. 运行预测
const output = model.signatures['serving_default'](tf.constant(audio))
const pitch = output['pitch']        // 0-1 的音高值
const uncertainty = output['uncertainty'] // 置信度

// 4. 过滤和转换
// uncertainty < 0.1 的结果才是可靠的
// pitch 转换为实际频率
```

## 模块设计

### 1. 音频处理模块 (audio_processor.js)

- 浏览器录音（MediaRecorder）
- 音频解码（Web Audio API）
- 格式转换（WAV）

### 2. SPICE 音高提取 (spice_extractor.js)

- 加载 TensorFlow.js 模型
- 音频预处理（归一化、裁剪）
- 运行 SPICE 预测
- 结果过滤（uncertainty < 0.1）
- 频率转换

### 3. 错误检测模块 (error_detector.js)

- 逐点比对音高偏差
- 计算半音差
- 阈值判断（> 0.5 半音 = 错误）

### 4. 评分模块 (scorer.js)

- 音高分 = 100 - 错误数 × 5
- 节奏分 = 100 - 错误数 × 10
- 总分 = 音高分 × 60% + 节奏分 × 40%

### 5. 可视化模块 (visualizer.js)

- 音高曲线对比图
- 错误位置标注

## 实现步骤

### Phase 1: SPICE 集成 ✅

- [x] 安装 @tensorflow/tfjs
- [ ] 创建 spice_extractor.js
- [ ] 加载和运行 SPICE 模型
- [ ] 测试音高提取

### Phase 2: 错误检测

- [ ] 比对标准音和用户音高
- [ ] 计算半音偏差
- [ ] 标记错误位置

### Phase 3: UI 完善

- [ ] 加载模型时显示进度
- [ ] 错误可视化
- [ ] 历史记录统计

## 目录结构

```
Violin_performance_rating/
├── src/
│   ├── components/
│   │   ├── Recorder.jsx         # 录音组件
│   │   ├── ScoreBoard.jsx       # 分数显示
│   │   └── ErrorList.jsx        # 错误列表
│   ├── utils/
│   │   ├── audio_processor.js   # 音频处理
│   │   ├── spice_extractor.js   # SPICE 音高提取 ⬅️ 新增
│   │   ├── error_detector.js    # 错误检测
│   │   └── scorer.js            # 评分
│   ├── hooks/
│   │   └── useRecorder.js       # 录音 Hook
│   ├── App.jsx                  # 主应用
│   └── App.css                  # 样式
├── package.json
└── vite.config.js
```

## 参考资源

- [TensorFlow SPICE](https://www.tensorflow.org/hub/tutorials/spice)
- [SPICE GitHub](https://github.com/farmaker47/Pitch_Estimator)
- [TensorFlow.js](https://www.tensorflow.org/js)

---

_Last updated: 2026-03-25_
