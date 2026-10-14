export const GARMENTS = [
  { id: 'tshirt', label: 'T-shirt', color: '#EFBD48' },
  { id: 'dress', label: 'Dress', color: '#b86672' },
  { id: 'suit', label: 'Suit', color: '#65738a' },
  { id: 'hoodie', label: 'Hoodie', color: '#99ad9d' },
  { id: 'pants', label: 'Pants', color: '#3e4a63' },
  { id: 'jacket', label: 'Jacket', color: '#8a6d52' },
  { id: 'hat', label: 'Cap', color: '#4f8a76' },
  { id: 'bag', label: 'Backpack', color: '#a67b4f' },
];

export const isGarment = id => GARMENTS.some(garment => garment.id === id);
export const getGarment = id => GARMENTS.find(garment => garment.id === id) || GARMENTS[0];
