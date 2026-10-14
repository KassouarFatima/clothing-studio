import { lazy, Suspense } from 'react'
import Home from './pages/Home'
import Canvas from './canvas'
import Costumizer from './pages/Costumizer'
import ChatBot from './comp/ChatBot'
import { useSnapshot } from 'valtio'
import state from './store'
import { isProcedural } from './config/garments/procedural'

const WearIt = lazy(() => import('./tryon/WearIt'));

function App() {
  const snap = useSnapshot(state);
  return (
    <main className="app transition-all ease-in bg-gray-300">
      {!snap.preview && <Home />}
      <Canvas />
      {!snap.preview && <Costumizer />}
      {!snap.preview && <ChatBot />}
      {snap.wearItOpen && <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-white" role="status">Opening Wear it…</div>}><WearIt onClose={() => state.wearItOpen = false} /></Suspense>}
      {/* Downloaded models have a credits page; garments built in code do not. */}
      {!snap.preview && snap.garment !== 'tshirt' && !isProcedural(snap.garment) && <a className="model-credit" href="/garments/credits.html" target="_blank" rel="noreferrer">3D model credits</a>}
    </main>
  )
}

export default App
