import React from 'react';
import { Player } from '../types';

interface Props {
  player: Player;
  isActive: boolean;
  totalScore: number;
}

export const PlayerCard: React.FC<Props> = ({ player, isActive }) => {
  return (
    <div 
      className={`flex items-center justify-between p-3 rounded-xl transition-all duration-500
      ${isActive ? 'bg-white shadow-md border-2 border-accent scale-105' : 'opacity-60 grayscale'}`}
    >
      <div className="flex flex-col">
        <span className="font-bold text-xl leading-none">{player.name}</span>
        {isActive && <span className="text-xs text-interaction mt-1">Playing now...</span>}
      </div>
      <div className="text-3xl font-bold font-hand text-ink">
        {player.score}
      </div>
    </div>
  );
};
