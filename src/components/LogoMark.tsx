import { Aperture } from 'lucide-react';

export function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <div className="brand-mark"><Aperture size={compact ? 17 : 19} strokeWidth={2.5} /></div>
      {!compact && <span className="brand-name">Aper<span>Glyph</span></span>}
    </div>
  );
}
