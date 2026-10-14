import React, { useState, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import state from '../store';
import {
  getDesignHistory,
  saveDesignHistory,
  addDesignToHistory,
  applyHistoryDesign,
} from '../config/designHistory';

const DesignHistoryDropdown = () => {
  const snap = useSnapshot(state);
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState(() => getDesignHistory());

  // Listen for history updates
  useEffect(() => {
    const handleStorage = () => setHistory(getDesignHistory());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleSelect = (item) => {
    applyHistoryDesign(item);
  };

  const handleSaveCurrent = () => {
    const title = prompt('Name this design:', `Design ${history.length + 1}`);
    if (title === null) return;
    const updated = addDesignToHistory({ title: title.trim() || 'Custom T-Shirt' });
    setHistory(updated);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    const remaining = history.filter((item) => item.id !== id);
    setHistory(remaining);
    saveDesignHistory(remaining);
  };

  return (
    <div className='relative flex flex-col items-end'>
      {/* History Trigger Button directly under the top-right buttons */}
      <button
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/80 hover:bg-white text-gray-800 border border-white/60 shadow-md backdrop-blur-md transition-all active:scale-95'
      >
        <span>🕒</span>
        <span>History ({history.length})</span>
        <span className='text-[10px] text-gray-500 font-bold'>
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className='mt-2 w-[270px] glassmorphism p-3 rounded-xl shadow-2xl flex flex-col gap-2 border border-white/50 backdrop-blur-lg animate-in fade-in zoom-in-95 duration-150 z-30'>
          {/* Header */}
          <div className='flex items-center justify-between pb-1.5 border-b border-white/20'>
            <span className='text-xs font-bold text-gray-900 flex items-center gap-1'>
              <span>👕</span>
              <span>Saved T-Shirts</span>
            </span>
            <button
              type='button'
              onClick={handleSaveCurrent}
              className='px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition'
              title='Save current 3D shirt to history'
            >
              + Save Current
            </button>
          </div>

          {/* History List */}
          <div className='max-h-[260px] overflow-y-auto pr-0.5 custom-scrollbar flex flex-col gap-1.5'>
            {history.length === 0 ? (
              <p className='text-center text-xs text-gray-500 py-4'>
                No saved designs yet.
              </p>
            ) : (
              history.map((item) => {
                const previewSrc = item.fullDecal || item.logoDecal;
                const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className='group p-1.5 rounded-lg bg-white/60 hover:bg-white border border-white/60 hover:border-indigo-300 shadow-xs cursor-pointer transition flex items-center justify-between gap-2'
                    title='Click to load onto 3D t-shirt'
                  >
                    <div className='flex items-center gap-2 min-w-0'>
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={item.title}
                          className='w-9 h-9 rounded object-cover border border-white shadow-xs shrink-0 bg-white'
                        />
                      ) : (
                        <div
                          style={{ backgroundColor: item.color || '#333' }}
                          className='w-9 h-9 rounded border border-white shadow-xs shrink-0 flex items-center justify-center text-white text-xs'
                        >
                          👕
                        </div>
                      )}

                      <div className='min-w-0'>
                        <div className='text-[11px] font-bold text-gray-900 truncate group-hover:text-indigo-600 transition'>
                          {item.title}
                        </div>
                        <div className='text-[9px] text-gray-500 flex items-center gap-1'>
                          <span>{timeStr}</span>
                          <span>•</span>
                          <span className='capitalize font-medium text-gray-600'>{item.garment || 'tshirt'}</span>
                        </div>
                      </div>
                    </div>

                    <div className='flex items-center gap-1 shrink-0'>
                      <button
                        type='button'
                        onClick={(e) => handleDelete(item.id, e)}
                        className='p-1 text-gray-400 hover:text-red-600 text-xs rounded transition'
                        title='Delete from history'
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignHistoryDropdown;
