import { useState, useEffect } from 'react'
import { openDB } from 'idb'
import { AudioProcessor } from './utils/audio_processor'
import { FeatureExtractor } from './utils/feature_extractor'
import { SpiceExtractor } from './utils/spice_extractor'
import { DTWAligner } from './utils/dtw_aligner'
import { ErrorDetector } from './utils/error_detector'
import { Scorer } from './utils/scorer'
import './App.css'

// 初始化 IndexedDB
const initDB = async () => {
  return openDB('violin-rating-db', 1, {
    upgrade(db) {
      // 项目存储
      if (!db.objectStoreNames.contains('projects')) {
        const projectStore = db.createObjectStore('projects', { keyPath: 'id' })
        projectStore.createIndex('name', 'name')
      }
      // 演奏记录存储
      if (!db.objectStoreNames.contains('performances')) {
        const perfStore = db.createObjectStore('performances', { keyPath: 'id', autoIncrement: true })
        perfStore.createIndex('projectId', 'projectId')
      }
    }
  })
}

function App() {
  const [view, setView] = useState('projects')
  const [projects, setProjects] = useState([])
  const [currentProject, setCurrentProject] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [score, setScore] = useState(null)
  const [errors, setErrors] = useState([])
  const [performances, setPerformances] = useState([])
  const [db, setDb] = useState(null)
  const [currentAudioBlob, setCurrentAudioBlob] = useState(null)
  const [referenceAudioBlob, setReferenceAudioBlob] = useState(null)
  const [playingErrorIndex, setPlayingErrorIndex] = useState(null)
  const [playMode, setPlayMode] = useState('user') // 'user' 或 'reference'
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(true)
  const [modelError, setModelError] = useState(null)
  const [spiceExtractor, setSpiceExtractor] = useState(null)

  const maxRecordingTime = 120

  // 频率转音符名
  const getNoteFromFrequency = (frequency) => {
    if (!frequency || frequency <= 0) return null
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const a4 = 440
    const semitones = 12 * Math.log2(frequency / a4)
    const noteNum = Math.round(semitones) + 69
    const note = notes[noteNum % 12]
    const octave = Math.floor(noteNum / 12) - 1
    return `${note}${octave}`
  }

  // 播放音频片段（前后5秒）
  const playErrorSegment = (error) => {
    const blob = playMode === 'reference' ? referenceAudioBlob : currentAudioBlob
    if (!blob) {
      alert(playMode === 'reference' ? '请先录制标准音！' : '请先录制您的演奏！')
      return
    }
    
    // 解析时间 (e.g., "0:15" -> 15)
    const timeParts = error.time.split(':')
    const errorTime = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1])
    
    const audio = new Audio(URL.createObjectURL(blob))
    
    // 从错误时间前5秒开始播放
    const startTime = Math.max(0, errorTime - 5)
    audio.currentTime = startTime
    
    audio.play()
    setPlayingErrorIndex(error.time)
    
    // 播放10秒后停止（前后5秒 = 10秒）
    setTimeout(() => {
      audio.pause()
      setPlayingErrorIndex(null)
    }, 10000)
  }

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      const database = await initDB()
      setDb(database)
      
      const allProjects = await database.getAll('projects')
      setProjects(allProjects)
    }
    loadData()
  }, [])

  // 初始化并加载 SPICE 模型
  useEffect(() => {
    const initSpice = async () => {
      try {
        const extractor = new SpiceExtractor();
        setSpiceExtractor(extractor);
        await extractor.loadModel();
        setIsModelLoading(false);
      } catch (err) {
        console.error('SPICE 模型加载失败:', err);
        setModelError(err.message);
        setIsModelLoading(false);
      }
    };
    initSpice();
  }, []);

  // 获取项目演奏历史
  const loadPerformances = async (projectId) => {
    if (!db) return
    const allPerfs = await db.getAll('performances')
    const projectPerfs = allPerfs.filter(p => p.projectId === projectId)
    setPerformances(projectPerfs)
  }

  const createProject = async () => {
    if (!projectName.trim()) return
    const newProject = {
      id: Date.now(),
      name: projectName,
      referenceAudio: null,
      createdAt: new Date().toLocaleString()
    }
    
    await db.put('projects', newProject)
    setProjects([...projects, newProject])
    setCurrentProject(newProject)
    setProjectName('')
    setView('record-ref')
  }

  const startRecording = async () => {
    setIsRecording(true)
    setRecordingTime(0)
    setCurrentAudioBlob(null)
    window._audioChunks = []
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      window._mediaRecorder = mediaRecorder
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          window._audioChunks.push(e.data)
        }
      }
      
      mediaRecorder.start(100) // 每 100ms 收集一次数据
    } catch (err) {
      console.error('无法访问麦克风:', err)
    }
    
    const timer = setInterval(() => {
      setRecordingTime(t => {
        if (t >= maxRecordingTime - 1) {
          stopRecording()
          return t
        }
        return t + 1
      })
    }, 1000)

    window._recordingTimer = timer
  }

  const stopRecording = () => {
    setIsRecording(false)
    if (window._recordingTimer) {
      clearInterval(window._recordingTimer)
      window._recordingTimer = null
    }
    
    if (window._mediaRecorder && window._mediaRecorder.state === 'recording') {
      window._mediaRecorder.stop()
      window._mediaRecorder.onstop = () => {
        if (window._audioChunks && window._audioChunks.length > 0) {
          const blob = new Blob(window._audioChunks, { type: 'audio/webm' })
          setCurrentAudioBlob(blob)
        }
      }
    }
  }

  const saveRecording = async (type) => {
    if (!currentProject) return
    
    const updatedProject = {
      ...currentProject,
      [type]: { time: recordingTime, recordedAt: new Date().toLocaleString() }
    }
    
    await db.put('projects', updatedProject)
    setCurrentProject(updatedProject)
    setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p))
    
    if (type === 'referenceAudio') {
      setReferenceAudioBlob(currentAudioBlob)
      setView('record-user')
    } else {
      // 实际分析 - 检查项目中是否有标准音记录
      if (!currentProject || !currentProject.referenceAudio) {
        alert('请先录制标准音！')
        return
      }
      
      if (isModelLoading) {
        alert('模型加载中，请稍后再试！')
        return
      }
      
      setIsAnalyzing(true)
      
      try {
        const audioProcessor = new AudioProcessor()
        const featureExtractor = new FeatureExtractor()
        
        // 解码音频
        const userAudioBuffer = await audioProcessor.loadAudioFromBlob(currentAudioBlob)
        const refAudioBuffer = await audioProcessor.loadAudioFromBlob(referenceAudioBlob)
        
        // 优先使用 SPICE 模型提取音高，失败则回退到 autocorrelation
        let userPitch, refPitch;
        const getNote = spiceExtractor && spiceExtractor.isModelLoaded()
          ? (f) => spiceExtractor.getNoteFromFrequency(f)
          : (f) => featureExtractor.getNoteFromFrequency(f);
        
        try {
          if (spiceExtractor && spiceExtractor.isModelLoaded()) {
            userPitch = await spiceExtractor.extractPitch(userAudioBuffer);
            refPitch = await spiceExtractor.extractPitch(refAudioBuffer);
          } else {
            throw new Error('SPICE model not loaded');
          }
        } catch (spiceErr) {
          console.warn('SPICE 提取失败，回退到 autocorrelation:', spiceErr.message);
          userPitch = await featureExtractor.extractPitch(userAudioBuffer);
          refPitch = await featureExtractor.extractPitch(refAudioBuffer);
        }
        
        if (refPitch.length === 0 || userPitch.length === 0) {
          alert('无法提取音高，请确保录音清晰！')
          return
        }
        
        // 错误检测 - 简化版，直接比对音高
        const errors = []
        
        if (refPitch.length > 0 && userPitch.length > 0) {
          // 简单的逐点比对
          const minLen = Math.min(refPitch.length, userPitch.length)
          for (let i = 0; i < minLen; i++) {
            const refFreq = refPitch[i].frequency
            const userFreq = userPitch[i].frequency
            const refTime = refPitch[i].time
            
            if (refFreq && userFreq) {
              // 计算半音偏差
              const semitones = 12 * Math.log2(userFreq / refFreq)
              const absSemitones = Math.abs(semitones)
              
              // 如果偏差超过0.5个半音，记为错误
              if (absSemitones > 0.5) {
                errors.push({
                  time: `${Math.floor(refTime / 60)}:${Math.floor(refTime % 60).toString().padStart(2, '0')}`,
                  type: 'pitch',
                  severity: absSemitones > 2 ? 'high' : (absSemitones > 1 ? 'medium' : 'low'),
                  note: getNote(refFreq),
                  expected: getNote(refFreq),
                  actual: getNote(userFreq)
                })
              }
            }
          }
        }
        
        // 如果没有检测到错误，给出高分
        // 不再强制添加示例错误
        
        // 评分 - 分开 pitch 和 rhythm 错误
        const pitchErrorsOnly = errors.filter(e => e.type === 'pitch')
        const rhythmErrorsOnly = errors.filter(e => e.type === 'rhythm')
        
        const scorer = new Scorer()
        const finalScore = scorer.calculateScore(pitchErrorsOnly, rhythmErrorsOnly, {
          duration: recordingTime,
          totalNotes: errors.length
        })
        
        setScore(finalScore)
        setErrors(errors)
        
        // 保存演奏记录
        const performance = {
          projectId: currentProject.id,
          projectName: currentProject.name,
          score: finalScore,
          errors: errors,
          recordedAt: new Date().toLocaleString(),
          duration: recordingTime
        }
        
        await db.put('performances', performance)
        await loadPerformances(currentProject.id)
        
        setView('result')
      } catch (err) {
        console.error('分析失败:', err); console.log('refPitch:', refPitch ? refPitch.length : 'null'); console.log('userPitch:', userPitch ? userPitch.length : 'null')
        alert('分析失败，请重新录制！错误: ' + err.message)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  // 计算错误统计
  const getErrorStats = () => {
    const stats = {}
    performances.forEach(p => {
      p.errors.forEach(e => {
        const key = e.type === 'pitch' ? e.note : 'rhythm'
        stats[key] = (stats[key] || 0) + 1
      })
    })
    return Object.entries(stats).sort((a, b) => b[1] - a[1])
  }

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="app">
      <header>
        <h1>🎻 Violin Rating</h1>
      </header>

      <main>
        {/* 项目列表 */}
        {view === 'projects' && (
          <section className="card">
            <h2>我的项目</h2>
            <div className="input-group">
              <input
                type="text"
                placeholder="输入项目名称"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <button onClick={createProject}>创建项目</button>
            </div>
            
            {projects.length === 0 ? (
              <p className="empty">暂无项目，创建一个开始练习吧！</p>
            ) : (
              <ul className="project-list">
                {projects.map(p => (
                  <li key={p.id}>
                    <div className="project-item" onClick={async () => { 
                      setCurrentProject(p); 
                      await loadPerformances(p.id); 
                      // 如果有保存的标准音，加载它
                      if (p.referenceAudio) {
                        // 从 IndexedDB 加载标准音 Blob
                        // 这里暂时不重新加载 Blob，只检查是否存在
                      }
                      setView(p.referenceAudio ? 'record-user' : 'record-ref') 
                    }}>
                      <span className="project-name">{p.name}</span>
                      <span className="status">
                        {p.referenceAudio ? '✓' : '○'} 标准音 
                        {' | '}
                        {performances.length > 0 ? `✓ ${performances.length}次练习` : '○ 我的演奏'}
                      </span>
                    </div>
                    <button 
                      className="delete-btn"
                      onClick={async () => {
                        if (confirm(`确定要删除项目"${p.name}"吗？`)) {
                          await db.delete('projects', p.id)
                          // 删除相关演奏记录
                          const allPerfs = await db.getAll('performances')
                          for (const perf of allPerfs) {
                            if (perf.projectId === p.id) {
                              await db.delete('performances', perf.id)
                            }
                          }
                          setProjects(projects.filter(proj => proj.id !== p.id))
                          if (currentProject?.id === p.id) {
                            setCurrentProject(null)
                          }
                        }
                      }}
                    >
                      🗑️
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* 录制标准音 */}
        {view === 'record-ref' && currentProject && (
          <section className="card">
            <h2>录制标准音: {currentProject.name}</h2>
            <p className="tip">请播放或演唱曲目作为标准参考</p>
            
            <div className="recorder">
              <div className="timer">{formatTime(recordingTime)} / {formatTime(maxRecordingTime)}</div>
              
              {!isRecording && !currentProject.referenceAudio && (
                <button className="record-btn" onClick={startRecording}>
                  ⏺ 开始录制
                </button>
              )}
              
              {isRecording && (
                <button className="stop-btn" onClick={stopRecording}>
                  ⏹ 停止
                </button>
              )}
              
              {!isRecording && recordingTime > 0 && !currentProject.referenceAudio && (
                <div className="actions">
                  <button onClick={() => saveRecording('referenceAudio')}>保存</button>
                  <button className="secondary" onClick={() => setRecordingTime(0)}>重试</button>
                </div>
              )}
              
              {currentProject.referenceAudio && (
                <p className="saved">✓ 标准音已保存 ({currentProject.referenceAudio.time}秒)</p>
              )}
            </div>
            
            <button className="back" onClick={() => setView('projects')}>← 返回项目列表</button>
          </section>
        )}

        {/* 录制我的演奏 */}
        {view === 'record-user' && currentProject && (
          <section className="card">
            <h2>录制我的演奏: {currentProject.name}</h2>
            <p className="tip">请用小提琴演奏同一曲目</p>
            
            {isModelLoading && (
              <p className="tip" style={{color: '#f59e0b'}}>🔄 加载模型中，请稍候...</p>
            )}
            
            {modelError && (
              <p className="tip" style={{color: '#ef4444'}}>⚠️ 模型加载失败: {modelError} (将使用备用算法)</p>
            )}
            
            <div className="recorder">
              <div className="timer">{formatTime(recordingTime)} / {formatTime(maxRecordingTime)}</div>
              
              {!isRecording && !currentProject.userAudio && (
                <button className="record-btn" onClick={startRecording}>
                  ⏺ 开始录制
                </button>
              )}
              
              {isRecording && (
                <button className="stop-btn" onClick={stopRecording}>
                  ⏹ 停止
                </button>
              )}
              
              {!isRecording && recordingTime > 0 && !currentProject.userAudio && (
                <div className="actions">
                  <button onClick={() => saveRecording('userAudio')} disabled={isAnalyzing || isModelLoading}>
                    {isAnalyzing ? '分析中...' : isModelLoading ? '加载模型中...' : '保存并分析'}
                  </button>
                  <button className="secondary" onClick={() => setRecordingTime(0)} disabled={isAnalyzing}>重试</button>
                </div>
              )}
              
              {currentProject.userAudio && (
                <>
                  <p className="saved">✓ 我的演奏已保存 ({currentProject.userAudio.time}秒)</p>
                  <button className="secondary" onClick={() => { setCurrentProject({...currentProject, userAudio: null}); setRecordingTime(0) }}>
                    重新录制
                  </button>
                </>
              )}
            </div>
            
            <button className="back" onClick={async () => { await loadPerformances(currentProject.id); setView('history') }}>
              📊 查看历史记录
            </button>
            <button className="back" onClick={() => setView('projects')}>← 返回项目列表</button>
          </section>
        )}

        {/* 分析结果 */}
        {view === 'result' && score && (
          <section className="card">
            <h2>演奏评分结果</h2>
            
            <div className="score-board">
              <div className="total-score">{score.total}</div>
              <div className="score-label">总分</div>
            </div>
            
            <div className="score-details">
              <div className="score-item">
                <span>音高</span>
                <span className="value">{score.pitch}</span>
              </div>
              <div className="score-item">
                <span>节奏</span>
                <span className="value">{score.rhythm}</span>
              </div>
            </div>
            
            {errors.length > 0 && (
              <div className="errors">
                <div className="play-mode-toggle">
                  <button 
                    className={playMode === 'user' ? 'active' : ''}
                    onClick={() => setPlayMode('user')}
                  >
                    🎻 听我的演奏
                  </button>
                  <button 
                    className={playMode === 'reference' ? 'active' : ''}
                    onClick={() => setPlayMode('reference')}
                  >
                    🎼 听标准演奏
                  </button>
                </div>
                
                <h3>发现的问题 (点击播放):</h3>
                <ul>
                  {errors.map((e, i) => (
                    <li key={i}>
                      <button 
                        className="play-error-btn"
                        onClick={() => playErrorSegment(e)}
                        disabled={playingErrorIndex === e.time}
                      >
                        {playingErrorIndex === e.time ? '🔊 播放中...' : '▶'} {e.time}
                      </button>
                      <span className="type">{e.type === 'pitch' ? '音高' : '节奏'}</span>
                      {e.type === 'pitch' 
                        ? ` ${e.expected} → ${e.actual}`
                        : ` ${e.expected} → ${e.actual}`
                      }
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="actions">
              <button onClick={() => { setScore(null); setErrors([]); setRecordingTime(0); setView('record-user') }}>
                重新录制
              </button>
              <button className="secondary" onClick={() => setView('history')}>
                查看历史
              </button>
            </div>
          </section>
        )}

        {/* 历史记录 */}
        {view === 'history' && currentProject && (
          <section className="card">
            <h2>历史记录: {currentProject.name}</h2>
            
            {/* 错误统计 */}
            {performances.length > 0 && (
              <div className="error-stats">
                <h3>📈 错误统计</h3>
                <div className="stats-grid">
                  {getErrorStats().slice(0, 6).map(([key, count]) => (
                    <div key={key} className="stat-item">
                      <span className="stat-key">{key}</span>
                      <span className="stat-count">{count}次</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {performances.length === 0 ? (
              <p className="empty">暂无演奏记录</p>
            ) : (
              <ul className="history-list">
                {performances.slice().reverse().map((p, i) => (
                  <li key={i} className="history-item">
                    <div className="history-header">
                      <span className="history-date">{p.recordedAt}</span>
                      <span className="history-score">{p.score.total}分</span>
                    </div>
                    <div className="history-details">
                      <span>音高: {p.score.pitch}</span>
                      <span>节奏: {p.score.rhythm}</span>
                    </div>
                    {p.errors.length > 0 && (
                      <div className="history-errors">
                        {p.errors.map((e, j) => (
                          <span key={j} className="error-tag">
                            {e.type === 'pitch' ? e.note : '节奏'} {e.type === 'pitch' ? e.actual : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            
            <button className="back" onClick={() => setView('record-user')}>
              ← 继续练习
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
