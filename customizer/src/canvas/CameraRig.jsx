import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { easing } from 'maath'
import state from '../store'
import { useSnapshot } from 'valtio'

const CameraRig = ({ children }) => {
  const group = useRef()
  const snap = useSnapshot(state)
  useFrame((scene, delta) => {
    const isBreakpoint = window.innerWidth <= 1260
    const isMobile = window.innerWidth <= 600
    let targetPosition = [-0.4, 0, 2]
    if (snap.intro) {
      if (isBreakpoint) targetPosition = [0, 0, 2]
      if (isMobile) targetPosition = [0, 0.2, 2.5]
    } else {
      targetPosition = isMobile ? [0, 0, 2.5] : [0, 0, 2]
    }
    easing.damp3(scene.camera.position, targetPosition, 0.25, delta)
    if (snap.isDraggingText || snap.isDraggingLogo) {
      easing.dampE(group.current.rotation, [0, 0, 0], 0.1, delta)
    } else {
      easing.dampE(group.current.rotation, [scene.pointer.y / 10, -scene.pointer.x / 5, 0], 0.25, delta)
    }
  })
  return <group ref={group}>{children}</group>
}

export default CameraRig
