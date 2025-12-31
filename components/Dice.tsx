import React, { useMemo } from 'react';
import { DieFace, DieState } from '../types';

interface Props {
  die: DieState;
  rolling: boolean;
  index: number;
}

export const Dice: React.FC<Props> = ({ die, rolling, index }) => {
  // Random organic shape
  const borderRadius = useMemo(() => {
    const r = () => Math.floor(Math.random() * 15 + 20); // High curve
    return `${r()}% ${r()}% ${r()}% ${r()}% / ${r()}% ${r()}% ${r()}% ${r()}%`;
  }, []);

  // Slight rotation for natural look
  const rotation = useMemo(() => Math.random() * 6 - 3, []);

  const getFaceContent = (face: DieFace) => {
    // Map faces to unicode or just text with special styling
    // Using text for the sketchbook feel
    return face;
  };

  const getColor = () => {
    if (die.isHeld) return 'bg-gray-200 text-gray-400 border-gray-300'; // Banked
    if (die.isScoring) return 'bg-interaction text-white border-interaction'; // Scoring (Hot)
    return 'bg-white text-ink border-ink'; // Neutral
  };

  return (
    <div 
      className={`relative flex items-center justify-center w-16 h-16 md:w-20 md:h-20 text-3xl md:text-4xl font-bold border-2 shadow-sm transition-all duration-300
        ${getColor()}
        ${rolling && !die.isHeld ? 'animate-shake' : ''}
      `}
      style={{ 
        borderRadius, 
        transform: `rotate(${rotation}deg)`,
        animationDelay: `${index * 0.05}s`
      }}
    >
      {/* Hand-drawn inner border effect */}
      <div 
        className="absolute inset-1 border border-current opacity-20 pointer-events-none rounded-[inherit]"
      />
      {getFaceContent(die.value)}
      
      {die.isHeld && (
        <div className="absolute -top-2 -right-2 text-xs bg-gray-400 text-white px-2 py-0.5 rounded-full" style={{ borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px'}}>
          Saved
        </div>
      )}
    </div>
  );
};
