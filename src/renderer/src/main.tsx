import React from 'react'
import ReactDOM from 'react-dom/client'
import Launcher from './Launcher'
import ProjectWindow from './ProjectWindow'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const windowKind = params.get('window')
const projectId = params.get('id')

function Root(): JSX.Element {
  if (windowKind === 'project' && projectId) return <ProjectWindow projectId={projectId} />
  return <Launcher />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
