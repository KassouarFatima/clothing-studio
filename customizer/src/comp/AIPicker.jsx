import React from 'react';
import CustomButtom from './CustomButtom';

const AIPicker = ({ prompt, setPrompt, generatingImg, generationError, handleSubmit }) => {
  return (
    <div
      className='aipicker-container'
      style={{ height: 'auto', minHeight: 220, maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto' }}
    >
      <div className='flex items-center mb-1'>
        <label className='text-xs font-bold uppercase text-gray-700 flex items-center gap-1.5'>
          <span className='w-2 h-2 rounded-full bg-indigo-500 animate-pulse' />
          AI Fabric Designer
        </label>
      </div>

      <textarea
        className='aipicker-textarea'
        aria-label='Describe your garment design'
        placeholder='Describe your pattern (e.g. geometric racing stripes, botanical foliage)...'
        rows={5}
        maxLength={1500}
        value={prompt}
        disabled={generatingImg}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {generationError && (
        <p id='generation-error' role='alert' className='text-xs text-red-900 break-words'>
          {generationError}
        </p>
      )}

      {generatingImg && (
        <p role='status' className='text-xs text-indigo-800 font-medium flex items-center gap-1.5'>
          <span className='w-2 h-2 rounded-full bg-indigo-600 animate-ping' />
          <span>Generating design with AI...</span>
        </p>
      )}

      {!generatingImg && (
        <p className='text-[10px] text-gray-500 leading-snug'>
          Tip: the same description always produces the same design — change a word for a new variation.
        </p>
      )}

      <div className='flex flex-wrap gap-3 pt-1'>
        <CustomButtom
          type={generatingImg ? 'outline' : 'filled'}
          title={generatingImg ? 'Asking AI...' : 'AI Full Pattern'}
          handleClick={() => handleSubmit()}
          customStyles='text-xs flex-1'
          disabled={generatingImg}
        />
      </div>
    </div>
  );
};

export default AIPicker;
