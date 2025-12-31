import React, { useState } from 'react';
import { WobblyButton } from './WobblyButton';

interface Props {
  onStart: (names: string[]) => void;
}

export const SetupScreen: React.FC<Props> = ({ onStart }) => {
  const [names, setNames] = useState<string[]>(['Player 1', 'Player 2']);

  const addPlayer = () => {
    if (names.length < 6) {
      setNames([...names, `Player ${names.length + 1}`]);
    }
  };

  const removePlayer = (index: number) => {
    if (names.length > 1) {
      setNames(names.filter((_, i) => i !== index));
    }
  };

  const updateName = (index: number, val: string) => {
    const newNames = [...names];
    newNames[index] = val;
    setNames(newNames);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto p-6 space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h1 className="text-6xl font-hand text-ink mb-2">5000</h1>
        <p className="text-xl text-gray-500 font-hand">A sketchbook dice game.</p>
      </div>

      <div className="w-full space-y-4">
        {names.map((name, idx) => (
          <div key={idx} className="flex items-center space-x-2">
            <div className="w-8 h-8 flex items-center justify-center bg-accent rounded-full text-ink font-bold shadow-sm">
              {idx + 1}
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => updateName(idx, e.target.value)}
              className="flex-1 bg-transparent border-b-2 border-gray-200 focus:border-interaction outline-none px-2 py-1 font-hand text-xl text-ink transition-colors"
              placeholder="Enter name..."
            />
            {names.length > 1 && (
              <button 
                onClick={() => removePlayer(idx)}
                className="text-danger opacity-50 hover:opacity-100 text-xl px-2"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col space-y-3 w-full pt-4">
        {names.length < 6 && (
          <WobblyButton variant="ghost" onClick={addPlayer}>
            + Add Player
          </WobblyButton>
        )}
        <WobblyButton onClick={() => onStart(names)}>
          Start Game
        </WobblyButton>
      </div>
    </div>
  );
};
