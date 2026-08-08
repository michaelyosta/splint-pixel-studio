import { Lock, Star } from 'lucide-react';

export default function AchievementsView({ achievements }) {
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ДОСТИЖЕНИЯ</p><h1>Награды</h1></div></div><div className="achievement-grid">{achievements.map((ach) => <div key={ach.id} className={`achievement ${ach.unlocked ? 'unlocked' : 'locked'}`}>
    <span className="achievement-icon">{ach.unlocked ? <Star size={20} /> : <Lock size={20} />}</span>
    <b>{ach.title}</b>
    <small>{ach.description}</small>
  </div>)}{!achievements.length && <p className="empty-state">Достижения загружаются…</p>}</div></section>;
}
