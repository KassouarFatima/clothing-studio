import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSnapshot } from 'valtio'
import config from '../config/config'
import state from '../store'
import CustomButtom from '../comp/CustomButtom'
import { reader } from '../config/helpers'
import { EditorTabs, FilterTabs, DecalTypes } from '../config/constants'
import { fadeAnimation, slideAnimation } from '../config/motion'
import AIPicker from '../comp/AIPicker'
import ColorPicker from '../comp/ColorPicker'
import FilePiker from '../comp/FilePiker'
import TextPicker from '../comp/TextPicker'
import DesignHistoryDropdown from '../comp/DesignHistoryDropdown'
import Tab from '../comp/Tab'
import GarmentSelector from '../comp/GarmentSelector'
import { getFabricDirection, getFabricTrimColor } from '../config/fullDesign'
import { promptSeed } from '../config/designSeed'
import { toggleFlip } from '../store'
import { addDesignToHistory, getDesignHistory } from '../config/designHistory'

const Costumizer = () => {
  const snap = useSnapshot(state);
  const [file, setFile] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generatingImg, setGeneratingImg] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [activeEditorTab, setActiveEditorTab] = useState('');
  const generationRequest = useRef(null);

  useEffect(() => () => generationRequest.current?.abort(), []);

  // A design suggestion coming from the chat assistant opens the AI tab with
  // the description already filled in.
  useEffect(() => {
    const suggestion = snap.pendingDesignPrompt;
    if (!suggestion) return;
    setPrompt(suggestion);
    setActiveEditorTab('aipicker');
    state.activeEditorTab = 'aipicker';
    state.pendingDesignPrompt = '';
  }, [snap.pendingDesignPrompt]);

  const handleSubmit = async () => {
    if (generationRequest.current) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setGenerationError('Describe the full-shirt design you want.');
      return;
    }
    const controller = new AbortController();
    generationRequest.current = controller;
    state.generatingGarment = state.garment;
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    setGeneratingImg(true);
    setGenerationError('');
    try {
      const response = await fetch(config[import.meta.env.DEV ? 'development' : 'production'].backendUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          mode: 'full',
          style: getFabricDirection(trimmedPrompt),
          garment: state.garment,
          // Same prompt → same seed → same design, instead of a new random
          // image on every click.
          seed: promptSeed(trimmedPrompt),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.message === 'string' ? data.message : `Generation failed (${response.status}). Please try again.`);
      }
      const mimeType = data?.mimeType ?? 'image/png';
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
        || typeof data?.photo !== 'string' || !data.photo.length
        || data.photo.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.photo)) {
        throw new Error('The server returned an invalid image. Please try again.');
      }
      const imageUrl = `data:${mimeType};base64,${data.photo}`;
      const generatedImage = new Image();
      generatedImage.src = imageUrl;
      try { await generatedImage.decode(); } catch {
        throw new Error('The generated image could not be opened. Please try again.');
      }
      if (controller.signal.aborted) throw new DOMException('Generation timed out', 'AbortError');
      state.patternScale = 1;
      state.patternRotation = 0;
      state.patternOffsetX = 0;
      state.patternOffsetY = 0;
      state.trimColor = getFabricTrimColor(generatedImage);
      state.useTrim = true;
      handleDecals('full', imageUrl);
      addDesignToHistory({ title: trimmedPrompt, fullDecal: imageUrl, trimColor: state.trimColor });
      setActiveEditorTab('');
      state.activeEditorTab = '';
    } catch (error) {
      setGenerationError(controller.signal.aborted
        ? 'Generation took longer than 3 minutes. The free Space may be busy. Please try again shortly.'
        : error instanceof TypeError
          ? 'Could not reach the generation server. Check your connection and make sure the backend is running.'
          : error.message || 'Generation failed. Please try again.');
    } finally {
      clearTimeout(timeoutId);
      generationRequest.current = null;
      state.generatingGarment = null;
      setGeneratingImg(false);
    }
  };

  const handleDecals = (type, result) => {
    const decalType = DecalTypes[type];
    state[decalType.stateProperty] = result;
    if (type === 'full') {
      state.isFullTexture = true;
      state.isLogoTexture = false;
    } else {
      state.isLogoTexture = true;
    }
  };

  const handleActiveFilterTab = tabName => {
    if (tabName === 'logoShirt') state.isLogoTexture = !state.isLogoTexture;
    if (tabName === 'stylishShirt') state.isFullTexture = !state.isFullTexture;
    if (tabName === 'textShirt') state.isTextTexture = !state.isTextTexture;
  };

  const handleEditorTabClick = tabName => {
    const next = activeEditorTab === tabName ? '' : tabName;
    setActiveEditorTab(next);
    state.activeEditorTab = next;
  };

  const readFile = type => {
    if (!file) return;
    reader(file).then(result => {
      if (type === 'logo') {
        state.removeLogoBackground = false;
        state.logoScale = 0.15;
        state.logoPosition = [0, 0.04, 0.15];
      } else {
        state.useTrim = false;
      }
      handleDecals(type, result);
      if (type === 'full') {
        setActiveEditorTab('');
        state.activeEditorTab = '';
      }
    }).catch(() => setGenerationError('The selected image could not be read.'));
  };

  const generateTabContent = () => {
    switch (activeEditorTab) {
      case 'colorpicker': return <ColorPicker />;
      case 'filepicker': return <FilePiker file={file} setFile={setFile} readFile={readFile} supportsLogo={snap.garment === 'tshirt'} />;
      case 'aipicker': return <AIPicker prompt={prompt} setPrompt={setPrompt} generatingImg={generatingImg} generationError={generationError} handleSubmit={handleSubmit} />;
      case 'textpicker': return <TextPicker />;
      default: return null;
    }
  };

  // clothing-studio: finish and hand the design back to the Atelier virtual
  // world (the buyer part that sent the customer here). The finished design is
  // saved in this site's History too, and the image travels through the local
  // backend (the two sites run on different ports, so browser storage is not
  // shared). This tab returns: close it — the world regains focus, imports the
  // design and hangs it in the shop window — or navigate to the street if
  // closing is blocked.
  const finishToAtelier = async () => {
    // The image shown on the shirt: the full texture in full-texture mode, the logo otherwise.
    const pickImage = (item) => [
      item.isFullTexture ? item.fullDecal : '',
      item.isLogoTexture ? item.logoDecal : '',
      item.fullDecal,
    ].find((image) => typeof image === 'string' && image.startsWith('data:image/'));
    addDesignToHistory({ title: 'Finished in “Let’sDo it.”' }); // saved in this site too
    // Hand the WHOLE design history to the Atelier (server to server through the
    // local backend): every design the customer made hangs on the boutique walls,
    // not only the last one. The backend publishes them oldest first (the newest
    // takes the shop window) and skips what its key already knows, so finishing
    // again never duplicates anything.
    const designs = getDesignHistory()
      .map((item) => ({ design: pickImage(item), key: item.id, title: item.title, allOver: !!item.isFullTexture }))
      .filter((item) => item.design)
      .slice(0, 25)
      .reverse(); // oldest first, so the newest is published last
    if (designs.length) {
      try {
        await fetch('http://localhost:8080/api/v1/handoff/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ designs }),
        });
      } catch { /* still return to the studio even if the handoff is unavailable */ }
    }
    window.close();
    setTimeout(() => { window.location.href = 'http://localhost:8792/street.html'; }, 400);
  };

  return (
    <AnimatePresence>
      {!snap.intro && (
        <>
          <div className='garment-selector-editor'><GarmentSelector /></div>
          <motion.div key='custom' className='absolute top-0 left-0 z-10' {...slideAnimation('left')}>
            <div className='flex items-center min-h-screen'>
              <div className='editortabs-container tabs'>
                {EditorTabs
                  .filter(tab => snap.garment === 'tshirt' || tab.name !== 'textpicker')
                  .map(tab => (
                  <Tab
                    key={tab.name}
                    tab={tab}
                    isActiveTab={activeEditorTab === tab.name}
                    handleClick={() => handleEditorTabClick(tab.name)}
                  />
                ))}
                {generateTabContent()}
              </div>
            </div>
          </motion.div>
          <motion.div className='absolute z-10 top-5 right-5 flex flex-col items-end gap-2' {...fadeAnimation}>
            <div className='flex gap-2'>
              <CustomButtom
                type='filled'
                title={snap.isFlipped ? '🔄 Front View' : '🔄 Flip to Back'}
                handleClick={toggleFlip}
                customStyles='w-fit px-4 py-2.5 font-bold text-sm whitespace-nowrap'
              />
              <CustomButtom type='filled' title='Wear it' handleClick={() => state.wearItOpen = true} disabled={generatingImg} customStyles='w-fit px-4 py-2.5 font-bold text-sm whitespace-nowrap' />
              <CustomButtom type='filled' title='🎁 Give to customer' handleClick={finishToAtelier} disabled={generatingImg} customStyles='w-fit px-4 py-2.5 font-bold text-sm whitespace-nowrap' />
              <CustomButtom type='filled' title='Go Back' handleClick={() => state.intro = true} customStyles='w-fit px-4 py-2.5 font-bold text-sm whitespace-nowrap' />
            </div>
            <DesignHistoryDropdown />
          </motion.div>
          <motion.div className='filtertabs-container' {...slideAnimation('up')}>
            {FilterTabs.filter(tab => snap.garment === 'tshirt' || (tab.name !== 'logoShirt' && tab.name !== 'textShirt')).map(tab => (
              <Tab
                key={tab.name}
                tab={tab}
                isFilterTab
                isActiveTab={
                  tab.name === 'logoShirt'
                    ? snap.isLogoTexture
                    : tab.name === 'stylishShirt'
                    ? snap.isFullTexture
                    : snap.isTextTexture
                }
                handleClick={() => handleActiveFilterTab(tab.name)}
              />
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default Costumizer;
