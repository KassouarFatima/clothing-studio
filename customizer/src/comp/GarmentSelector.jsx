import { useSnapshot } from 'valtio';
import state, { selectGarment } from '../store';
import { GARMENTS } from '../config/garments/catalog';
import { getContrastingColor } from '../config/helpers';

export default function GarmentSelector() {
  const snap = useSnapshot(state);
  // Inside Wear it a garment is placed on the body found in your photo, so
  // anything marked untrackable stays out of that selector without changing
  // the designer's full list. Nothing is excluded today: the backpack now
  // fits the shoulders like a top.
  const garments = snap.wearItOpen
    ? GARMENTS.filter(garment => garment.trackable !== false)
    : GARMENTS;
  return <div className="garment-selector" role="group" aria-label="Choose your garment">
    {garments.map(garment => <button type="button" key={garment.id}
      aria-pressed={snap.garment === garment.id}
      disabled={Boolean(snap.generatingGarment)}
      onClick={() => selectGarment(garment.id)}
      style={snap.garment === garment.id ? { backgroundColor: snap.color, color: getContrastingColor(snap.color) } : undefined}>
      {garment.label}
    </button>)}
  </div>;
}
