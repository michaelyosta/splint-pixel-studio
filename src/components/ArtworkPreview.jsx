import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';

export default function ArtworkPreview({ src, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className="post-image post-image-fallback"><ImagePlus size={28} /><span>Превью восстанавливается</span></div>;
  return <img className="post-image" loading="lazy" src={src} alt={alt} onError={() => setFailed(true)} />;
}
