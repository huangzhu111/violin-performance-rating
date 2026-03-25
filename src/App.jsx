import { useState } from 'react'
import './App.css'

function App() {
  const [view, setView] = useState('projects') // projects, record-ref, record-user, result
  const [projects, setProjects] = useState([])
  const [currentProject, setCurrentProject] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [score, setScore] = useState(null)
  const [errors, setErrors] = useState([])

  const maxRecordingTime = 120 // 2分钟

  const createProject = () => {
    if (!projectName.trim()) return
    const newProject = {
      id: Date.now(),
      name: projectName,
      referenceAudio: null,
      userAudio: null,
      createdAt: new Date().toLocaleString()
    }
    setProjects([...projects, newProject])
    setCurrentProject(newProject)
    setProjectName('')
    setView('record-ref')
  }

  const startRecording = () => {
    setIsRecording(true)
    setRecordingTime(0)
    
    const timer = setInterval(() => {
      setRecordingTime(t => {
        if (t >= maxRecordingTime - 1) {
          stopRecording()
          return t
        }
        return t + 1
      })
    }, 1000)

    // 保存 timer ID 以便停止
    window._recordingTimer = timer
  }

  const stopRecording = () => {
    setIsRecording(false)
    if (window._recordingTimer) {
      clearInterval(window._recordingTimer)
      window._recordingTimer = null
    }
  }

  const saveRecording = (type) => {
    if (!currentProject) return
    
    const updatedProject = {
      ...currentProject,
      [type]: { time: recordingTime, recordedAt: new Date().toLocaleString() }
    }
    
    setCurrentProject(updatedProject)
    setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p))
    
    if (type === 'referenceAudio') {
      setView('record-user')
    } else {
      // 模拟比对分析
      analyzePerformance()
    }
  }

  const analyzePerformance = () => {
    // 模拟分析结果
    const mockScore = {
      total: Math.floor(Math.random() * 30) + 70,
      pitch: Math.floor(Math.random() * 20) + 80,
      rhythm: Math.floor(Math.random() * 25) + 75
    }
    const mockErrors = [
      { time: '0:15', type: 'pitch', note: 'G4', expected: 'G4', actual: 'G#4' },
      { time: '0:32', type: 'rhythm', expected: '0.5s', actual: '0.7s' }
    ]
    setScore(mockScore)
    setErrors(mockErrors)
    setView('result')
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
                  <li key={p.id} onClick={() => { setCurrentProject(p); setView(p.referenceAudio ? 'record-user' : 'record-ref') }}>
                    <span>{p.name}</span>
                    <span className="status">
                      {p.referenceAudio ? '✓' : '○'} 标准音 
                      {' | '}
                      {p.userAudio ? '✓' : '○'} 我的演奏
                    </span>
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
                  <button onClick={() => saveRecording('userAudio')}>保存并分析</button>
                  <button className="secondary" onClick={() => setRecordingTime(0)}>重试</button>
                </div>
              )}
              
              {currentProject.userAudio && (
                <p className="saved">✓ 我的演奏已保存 ({currentProject.userAudio.time}秒)</p>
              )}
            </div>
            
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
                <h3>发现的问题:</h3>
                <ul>
                  {errors.map((e, i) => (
                    <li key={i}>
                      <span className="time">{e.time}</span>
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
              <button onClick={() => { setCurrentProject({...currentProject, userAudio: null}); setView('record-user') }}>
                重新录制
              </button>
              <button className="secondary" onClick={() => setView('projects')}>
                返回项目列表
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
