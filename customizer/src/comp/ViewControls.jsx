import React from 'react';
import { useSnapshot } from 'valtio';
import state, { toggleFlip, rotateShirt, setShirtAngle, toggleAutoRotate } from '../store';

const ViewControls = () => {
  const snap = useSnapshot(state);

  return (
    <div className='fixed bottom-20 right-5 z-20 flex flex-col items-end gap-2'>
      {/* Floating 3D Navigation Controls */}
      <div className='glassmorphism px-3 py-2 rounded-2xl flex items-center gap-2 shadow-xl border border-white/30 backdrop-blur-md'>
        {/* Flip Button */}
        <button
          type='button'
          onClick={toggleFlip}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
            snap.isFlipped
              ? 'bg-indigo-600 text-white shadow-indigo-500/30 ring-2 ring-indigo-400'
              : 'bg-white/80 hover:bg-white text-gray-800'
          }`}
          title='Flip front / back'
        >
          <span className='text-sm'>🔄</span>
          <span>{snap.isFlipped ? 'Back View' : 'Front View'}</span>
        </button>

        <div className='h-5 w-[1px] bg-white/40' />

        {/* Turn Left (-45°) */}
        <button
          type='button'
          onClick={() => rotateShirt(-Math.PI / 4)}
          className='w-7 h-7 flex items-center justify-center rounded-lg bg-white/60 hover:bg-white text-gray-800 text-xs font-bold transition active:scale-95'
          title='Turn left 45°'
        >
          ↶
        </button>

        {/* Turn Right (+45°) */}
        <button
          type='button'
          onClick={() => rotateShirt(Math.PI / 4)}
          className='w-7 h-7 flex items-center justify-center rounded-lg bg-white/60 hover:bg-white text-gray-800 text-xs font-bold transition active:scale-95'
          title='Turn right 45°'
        >
          ↷
        </button>

        {/* Auto Spin Turntable */}
        <button
          type='button'
          onClick={toggleAutoRotate}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
            snap.autoRotate
              ? 'bg-purple-600 text-white ring-2 ring-purple-400 shadow-sm'
              : 'bg-white/60 hover:bg-white text-gray-800'
          }`}
          title='Toggle 360° continuous turntable spin'
        >
          {snap.autoRotate ? '⏸ Spinning' : '🔁 360° Spin'}
        </button>
      </div>

      {/* Quick Perspective Pills */}
      <div className='flex gap-1.5 bg-black/20 backdrop-blur-sm p-1 rounded-xl text-[10px] font-semibold text-white/90'>
        <button
          type='button'
          onClick={() => setShirtAngle(0)}
          className={`px-2 py-0.5 rounded-lg transition ${
            !snap.isFlipped && Math.abs(snap.shirtRotationY % (Math.PI * 2)) < 0.2
              ? 'bg-white text-gray-900 font-bold'
              : 'hover:bg-white/20'
          }`}
        >
          Front
        </button>
        <button
          type='button'
          onClick={() => setShirtAngle(Math.PI / 2)}
          className='px-2 py-0.5 rounded-lg hover:bg-white/20 transition'
        >
          Side
        </button>
        <button
          type='button'
          onClick={() => setShirtAngle(Math.PI)}
          className={`px-2 py-0.5 rounded-lg transition ${
            snap.isFlipped ? 'bg-white text-gray-900 font-bold' : 'hover:bg-white/20'
          }`}
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default ViewControls;
